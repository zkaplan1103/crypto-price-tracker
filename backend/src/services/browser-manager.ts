import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { createLogger } from '../utils/logger';
import { circuitBreaker } from '../utils/circuit-breaker';

const logger = createLogger('browser-manager');

interface BrowserInstance {
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, Page>;
  refCount: number;
}

class BrowserManager {
  private static instance: BrowserManager;
  private browsers: Map<string, BrowserInstance> = new Map();
  private maxPagesPerBrowser = 5;
  private cleanupTimeout: Map<string, NodeJS.Timeout> = new Map();

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getPageForTicker(ticker: string): Promise<Page> {
    const browserId = this.getBrowserIdForTicker(ticker);
    
    // Check circuit breaker for browser operations (not ticker validation)
    if (!circuitBreaker.canExecute(`browser-${browserId}`)) {
      const error = new Error(`Browser circuit breaker is open for ${browserId}`);
      logger.error('Browser circuit breaker preventing operation', { browserId, ticker });
      throw error;
    }

    let browserInstance = this.browsers.get(browserId);

    if (!browserInstance) {
      browserInstance = await this.createBrowserInstance(browserId);
      this.browsers.set(browserId, browserInstance);
    } else {
      this.cancelCleanup(browserId);
    }

    // existing page is still valid
    if (browserInstance.pages.has(ticker)) {
      const existingPage = browserInstance.pages.get(ticker)!;
      try {
        await existingPage.evaluate(() => document.title);
        logger.info('Reusing existing page', { ticker, browserId });
        return existingPage;
      } catch (error) {
        logger.warn('Existing page is closed, creating new one', { ticker, browserId });
        browserInstance.pages.delete(ticker);
        browserInstance.refCount = Math.max(0, browserInstance.refCount - 1);
      }
    }

    const page = await this.createPageForTicker(browserInstance, ticker);
    browserInstance.pages.set(ticker, page);
    browserInstance.refCount++;

    // Record successful browser operation
    circuitBreaker.recordSuccess(`browser-${browserId}`);

    logger.info('Created new page for ticker', { 
      ticker, 
      browserId, 
      totalPages: browserInstance.pages.size,
      refCount: browserInstance.refCount
    });

    return page;
  }

  async releasePageForTicker(ticker: string): Promise<void> {
    const browserId = this.getBrowserIdForTicker(ticker);
    const browserInstance = this.browsers.get(browserId);

    if (!browserInstance || !browserInstance.pages.has(ticker)) {
      logger.warn('Attempted to release non-existent page', { ticker, browserId });
      return;
    }

    const page = browserInstance.pages.get(ticker)!;
    await page.close();
    browserInstance.pages.delete(ticker);
    browserInstance.refCount--;

    logger.info('Released page for ticker', { 
      ticker, 
      browserId,
      remainingPages: browserInstance.pages.size,
      refCount: browserInstance.refCount
    });

    if (browserInstance.pages.size === 0) {
      this.scheduleCleanup(browserId);
    }
  }

  private getBrowserIdForTicker(ticker: string): string {
    const hash = ticker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `browser-${hash % 3}`;
  }

  private async createBrowserInstance(browserId: string): Promise<BrowserInstance> {
    logger.info('Creating new browser instance', { browserId });

    try {
      const browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true
      });

      return {
        browser,
        context,
        pages: new Map(),
        refCount: 0
      };
    } catch (error) {
      // Record real browser failure (not ticker validation)
      circuitBreaker.recordFailure(`browser-${browserId}`, {
        type: 'BROWSER_CRASH',
        severity: 'high'
      }, `Failed to create browser instance: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      throw error;
    }
  }

  private async createPageForTicker(browserInstance: BrowserInstance, ticker: string): Promise<Page> {
    const browserId = this.getBrowserIdForTicker(ticker);
    
    try {
      const page = await browserInstance.context.newPage();
      
      // Set up event handlers for real browser failures
      page.on('crash', () => {
        logger.error('Page crashed', { ticker });
        // Record browser crash as real failure
        circuitBreaker.recordFailure(`browser-${browserId}`, {
          type: 'BROWSER_CRASH',
          severity: 'critical'
        }, `Page crashed for ticker ${ticker}`);
      });

      page.on('pageerror', (error) => {
        logger.error('Page error', { ticker, error: error.message });
        // Only record as circuit breaker failure if it's a serious page error
        if (error.message.includes('Out of memory') || error.message.includes('Script error')) {
          circuitBreaker.recordFailure(`browser-${browserId}`, {
            type: 'PAGE_LOAD_FAILURE',
            severity: 'medium'
          }, `Page error for ticker ${ticker}: ${error.message}`);
        }
      });

      const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
      
      try {
        page.pause();
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 15000 
        });
        
        logger.info('Successfully loaded TradingView page', { ticker, url });
      } catch (error) {
        logger.error('Failed to load TradingView page', { 
          ticker, 
          url, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        
        // Only record as circuit breaker failure for network/timeout issues, not ticker validation
        if (error instanceof Error) {
          if (error.message.includes('Timeout') || error.message.includes('net::') || error.message.includes('ERR_')) {
            circuitBreaker.recordFailure(`browser-${browserId}`, {
              type: 'NETWORK_TIMEOUT',
              severity: 'medium'
            }, `Network/timeout error loading page for ticker ${ticker}: ${error.message}`);
          }
        }
        
        throw error;
      }

      return page;
    } catch (error) {
      // Record page creation failure as real browser failure
      circuitBreaker.recordFailure(`browser-${browserId}`, {
        type: 'PAGE_LOAD_FAILURE',
        severity: 'high'
      }, `Failed to create page for ticker ${ticker}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      throw error;
    }
  }

  private scheduleCleanup(browserId: string): void {
    if (this.cleanupTimeout.has(browserId)) {
      clearTimeout(this.cleanupTimeout.get(browserId)!);
    }

    const timeout = setTimeout(async () => {
      const browserInstance = this.browsers.get(browserId);
      if (browserInstance && browserInstance.pages.size === 0) {
        logger.info('Cleaning up unused browser instance', { browserId });
        await this.closeBrowserInstance(browserId);
      }
      this.cleanupTimeout.delete(browserId);
    }, 30000);

    this.cleanupTimeout.set(browserId, timeout);
    logger.info('Scheduled browser cleanup', { browserId, delayMs: 30000 });
  }

  private cancelCleanup(browserId: string): void {
    if (this.cleanupTimeout.has(browserId)) {
      clearTimeout(this.cleanupTimeout.get(browserId)!);
      this.cleanupTimeout.delete(browserId);
      logger.debug('Cancelled browser cleanup', { browserId });
    }
  }

  private async closeBrowserInstance(browserId: string): Promise<void> {
    const browserInstance = this.browsers.get(browserId);
    if (!browserInstance) return;

    this.cancelCleanup(browserId);

    logger.info('Closing browser instance', { 
      browserId,
      remainingBrowsers: this.browsers.size - 1
    });

    try {
      await browserInstance.context.close();
      await browserInstance.browser.close();
    } catch (error) {
      logger.error('Error closing browser instance', { 
        browserId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }

    this.browsers.delete(browserId);
  }

  getBrowserStats(): { browserInstances: number; totalPages: number; scheduledCleanups: number } {
    let totalPages = 0;
    for (const browser of this.browsers.values()) {
      totalPages += browser.pages.size;
    }
    
    return {
      browserInstances: this.browsers.size,
      totalPages,
      scheduledCleanups: this.cleanupTimeout.size
    };
  }

  async closeAll(): Promise<void> {
    logger.info('Closing all browser instances', { 
      totalBrowsers: this.browsers.size 
    });

    for (const timeout of this.cleanupTimeout.values()) {
      clearTimeout(timeout);
    }
    this.cleanupTimeout.clear();

    const closePromises = Array.from(this.browsers.keys()).map(browserId =>
      this.closeBrowserInstance(browserId)
    );

    await Promise.all(closePromises);
  }
}

export const browserManager = BrowserManager.getInstance();