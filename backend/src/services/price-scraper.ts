import { Page } from 'playwright';
import { createLogger } from '../utils/logger';

const logger = createLogger('price-scraper');

export interface PriceData {
  ticker: string;
  price: number;
  timestamp: number;
  change24h: number;
}

export class PriceScraper {
  private page: Page;
  private ticker: string;
  private isMonitoring: boolean = false;
  private cachedPriceSelector: string | null = null;
  private currentCallback: ((priceData: PriceData) => void) | null = null;
  
  private priceSelectors = [
    '[data-field="last_price"]',
    '.tv-symbol-price-quote__value',
    '[data-symbol-last]',
    '.js-symbol-last',
    '[class*="last-JWoJqDGp"]',
    '[class*="valueItem"]'
  ];

  constructor(page: Page, ticker: string) {
    this.page = page;
    this.ticker = ticker;
  }

  async extractPrice(): Promise<PriceData | null> {
    try {
      let priceText: string | null = null;
      
      if (this.cachedPriceSelector) {
        try {
          const element = await this.page.$(this.cachedPriceSelector);
          if (element) {
            priceText = await element.textContent();
            if (!priceText?.trim()) {
              this.cachedPriceSelector = null;
              priceText = null;
            }
          }
        } catch (e) {
          this.cachedPriceSelector = null;
        }
      }
      
      if (!priceText) {
        for (const selector of this.priceSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              priceText = await element.textContent();
              if (priceText?.trim()) {
                this.cachedPriceSelector = selector;
                logger.debug('Found working selector', { ticker: this.ticker, selector });
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (!priceText) {
        try {
          const title = await this.page.title();
          const match = title.match(/[\d,]+\.?\d*/);
          if (match) {
            priceText = match[0];
            logger.debug('Using title fallback', { ticker: this.ticker, title });
          }
        } catch (e) {
        }
      }
      
      if (!priceText) {
        logger.warn('No price found', { ticker: this.ticker });
        return null;
      }

      return this.parsePrice(priceText);

    } catch (error) {
      logger.error('Price extraction failed', {
        ticker: this.ticker,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private parsePrice(priceText: string): PriceData | null {
    try {
      const cleanText = priceText.replace(/[$\s,]/g, '');
      const priceMatch = cleanText.match(/\d+\.?\d*/);
      
      if (!priceMatch) return null;
      
      const price = parseFloat(priceMatch[0]);
      
      if (isNaN(price) || price <= 0 || price > 10000000) {
        return null;
      }

      return {
        ticker: this.ticker,
        price,
        timestamp: Date.now(),
        change24h: 0 
      };

    } catch (error) {
      logger.error('Price parsing failed', { ticker: this.ticker, priceText });
      return null;
    }
  }

  async startMonitoring(callback: (priceData: PriceData) => void): Promise<void | { validationFailed: boolean }> {
    if (this.isMonitoring) {
      logger.warn('Already monitoring', { ticker: this.ticker });
      return;
    }

    this.currentCallback = callback;
    
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      
      const initialPrice = await this.extractPrice();
      if (initialPrice) {
        logger.info('Initial price found', { ticker: this.ticker, price: initialPrice.price });
        callback(initialPrice);
      } else {
        logger.error('Initial price not found - ticker may be invalid', { ticker: this.ticker });
        // Return a special error callback to indicate ticker validation failed
        return { validationFailed: true };
      }

      this.isMonitoring = true;
      
      const callbackId = `callback_${Date.now()}`;
      
      await this.page.exposeFunction(callbackId, async () => {
        if (!this.isMonitoring || !this.currentCallback) return;
        
        try {
          const priceData = await this.extractPrice();
          if (priceData) {
            logger.info('Price update detected', { 
              ticker: this.ticker, 
              price: priceData.price 
            });
            this.currentCallback(priceData);
          }
        } catch (error) {
          logger.error('Error in price callback', { 
            ticker: this.ticker, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      });

      await this.page.evaluate((callbackId: string) => {
        console.log('Setting up price monitoring');
      
        let lastPrice = '';
      
        const observer = new MutationObserver(() => {
          const selectors = ['.js-symbol-last', '[data-symbol-last]', '.tv-symbol-price-quote__value'];
      
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent) {
              const currentPrice = element.textContent.trim();
              if (currentPrice !== lastPrice && currentPrice.match(/\d/)) {
                lastPrice = currentPrice;
                console.log('Price changed:', currentPrice);
                try {
                  (window as any)[callbackId]();
                } catch (e) {
                  console.error('Callback error:', e);
                }
                return;
              }
            }
          }
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      
        console.log('Price monitoring active');
      
        return '';
      }, callbackId);

      logger.info('Price monitoring started', { ticker: this.ticker });

    } catch (error) {
      this.isMonitoring = false;
      this.currentCallback = null;
      logger.error('Failed to start monitoring', {
        ticker: this.ticker,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) return;

    logger.info('Stopping price monitoring', { ticker: this.ticker });
    this.isMonitoring = false;
    this.currentCallback = null;
  }

  isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }

  getTicker(): string {
    return this.ticker;
  }
}