import { ConnectRouter } from '@connectrpc/connect';
import { CryptoStreamService } from '../gen/proto/crypto_stream/v1/service_connect';
import { 
  SubscriptionResponse
} from '../gen/proto/crypto_stream/v1/service_pb';
import { createLogger } from '../utils/logger';
import { systemMonitor } from '../utils/system-monitor';
import { browserManager } from './browser-manager';
import { PriceScraper, PriceData } from './price-scraper';
import { wsManager } from './websocket-manager';

const logger = createLogger('crypto-stream-service');

const activeScrapers = new Map<string, PriceScraper>();
const activeSubscriptions = new Set<string>();

// Performance metrics
const performanceStats = {
  subscriptionAttempts: 0,
  successfulSubscriptions: 0,
  failedSubscriptions: 0,
  unsubscriptionAttempts: 0,
  averageSubscriptionTime: 0,
};

function validateTicker(ticker: string): { isValid: boolean; error?: string } {
  if (!ticker || typeof ticker !== 'string') {
    return { isValid: false, error: 'Ticker must be a non-empty string' };
  }

  const cleanTicker = ticker.toUpperCase().trim();
  
  if (cleanTicker.length < 2) {
    return { isValid: false, error: 'Ticker must be at least 2 characters long' };
  }
  
  if (cleanTicker.length > 10) {
    return { isValid: false, error: 'Ticker must be no more than 10 characters long' };
  }
  
  if (!/^[A-Z0-9]+$/.test(cleanTicker)) {
    return { isValid: false, error: 'Ticker must contain only alphanumeric characters' };
  }

  return { isValid: true };
}

function broadcastPriceUpdate(priceData: PriceData): void {
  wsManager.broadcastPriceUpdate(priceData);

  logger.info('Price update broadcasted', {
    ticker: priceData.ticker,
    price: priceData.price,
    change24h: priceData.change24h,
    wsStats: wsManager.getStats(),
    browserStats: browserManager.getBrowserStats()
  });
}

export const cryptoStreamRouter = (router: ConnectRouter) => {
  router.service(CryptoStreamService, {
    async subscribeTicker(req) {
      const startTime = Date.now();
      performanceStats.subscriptionAttempts++;
      
      const performanceTimer = systemMonitor.createPerformanceTimer(`subscribeTicker-${req.ticker}`);
      const validation = validateTicker(req.ticker);
      
      if (!validation.isValid) {
        logger.warn('Invalid ticker subscription attempt', { 
          ticker: req.ticker, 
          error: validation.error 
        });
        
        const response = new SubscriptionResponse({
          success: false,
          message: validation.error,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
        performanceTimer.end();
        return response;
      }

      const ticker = req.ticker.toUpperCase().trim();
      
      logger.info('Processing ticker subscription', { 
        ticker,
        currentSubscriptions: activeSubscriptions.size
      });

      if (activeSubscriptions.has(ticker)) {
        logger.info('Ticker already subscribed', { ticker });
        return new SubscriptionResponse({
          success: true,
          message: `Already subscribed to ${ticker}`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
      }

      try {
        logger.info('Acquiring browser page for ticker', { ticker });
        const page = await browserManager.getPageForTicker(ticker);
        
        const scraper = new PriceScraper(page, ticker);
        
        const priceUpdateHandler = (priceData: PriceData) => {
          logger.debug('Received price update from scraper', priceData);
          
          broadcastPriceUpdate(priceData);
        };
        
        logger.info('Starting price monitoring for ticker', { ticker });
        
        // Start monitoring with timeout fallback
        try {
          const monitoringResult = await scraper.startMonitoring(priceUpdateHandler);
          
          // Check if validation failed (no initial price found)
          if (monitoringResult && (monitoringResult as any).validationFailed) {
            logger.warn('Ticker validation failed - no initial price found', { ticker });
            
            // Clean up the scraper since validation failed
            try {
              await scraper.stopMonitoring();
              await browserManager.releasePageForTicker(ticker);
            } catch (cleanupError) {
              logger.error('Error cleaning up failed ticker validation', {
                ticker,
                cleanupError: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error'
              });
            }
            
            // DO NOT add to active subscriptions for failed validation
            // Return failure via ConnectRPC, no need for WebSocket broadcast
            return new SubscriptionResponse({
              success: false,
              message: `Ticker ${ticker} not found - no price data available`,
              activeTickers: Array.from(activeSubscriptions).sort()
            });
          }
        } catch (monitoringError) {
          logger.warn('Price monitoring setup failed, but continuing with subscription', { 
            ticker, 
            error: monitoringError instanceof Error ? monitoringError.message : 'Unknown error' 
          });
        }

        activeScrapers.set(ticker, scraper);
        activeSubscriptions.add(ticker);
        
        logger.info('Ticker subscription completed successfully', { 
          ticker,
          totalSubscriptions: activeSubscriptions.size,
          isMonitoring: scraper.isCurrentlyMonitoring()
        });

        return new SubscriptionResponse({
          success: true,
          message: `Successfully subscribed to ${ticker} with real-time price monitoring`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });

      } catch (error) {
        logger.error('Failed to subscribe to ticker', {
          ticker,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });

        try {
          await browserManager.releasePageForTicker(ticker);
        } catch (cleanupError) {
          logger.error('Error during subscription cleanup', {
            ticker,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error'
          });
        }

        return new SubscriptionResponse({
          success: false,
          message: `Failed to subscribe to ${ticker}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
      }
    },

    async unsubscribeTicker(req) {
      const validation = validateTicker(req.ticker);
      
      if (!validation.isValid) {
        return new SubscriptionResponse({
          success: false,
          message: validation.error,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
      }

      const ticker = req.ticker.toUpperCase().trim();
      
      logger.info('Processing ticker unsubscription', { ticker });

      if (!activeSubscriptions.has(ticker)) {
        logger.warn('Attempted to unsubscribe from non-existent ticker', { ticker });
        return new SubscriptionResponse({
          success: false,
          message: `Not subscribed to ${ticker}`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
      }

      try {
        const scraper = activeScrapers.get(ticker);
        if (scraper) {
          logger.info('Stopping price monitoring for ticker', { ticker });
          await scraper.stopMonitoring();
          activeScrapers.delete(ticker);
        }

        logger.info('Releasing browser resources for ticker', { ticker });
        await browserManager.releasePageForTicker(ticker);
        
        activeSubscriptions.delete(ticker);
        
        logger.info('Ticker unsubscribed successfully', { 
          ticker,
          remainingSubscriptions: activeSubscriptions.size
        });

        return new SubscriptionResponse({
          success: true,
          message: `Successfully unsubscribed from ${ticker}`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });

      } catch (error) {
        logger.error('Failed to unsubscribe from ticker', {
          ticker,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        activeSubscriptions.delete(ticker);
        activeScrapers.delete(ticker);

        return new SubscriptionResponse({
          success: false,
          message: `Error unsubscribing from ${ticker}, but subscription removed`,
          activeTickers: Array.from(activeSubscriptions).sort()
        });
      }
    },

    async getActiveSubscriptions() {
      const subscriptionList = Array.from(activeSubscriptions).sort();
      
      let activeMonitoringCount = 0;
      for (const ticker of activeSubscriptions) {
        const scraper = activeScrapers.get(ticker);
        if (scraper && scraper.isCurrentlyMonitoring()) {
          activeMonitoringCount++;
        }
      }

      logger.info('Active subscriptions requested', {
        totalSubscriptions: activeSubscriptions.size,
        activelyMonitoring: activeMonitoringCount,
        subscriptions: subscriptionList
      });

      return new SubscriptionResponse({
        success: true,
        message: `${activeSubscriptions.size} active subscriptions (${activeMonitoringCount} actively monitoring)`,
        activeTickers: subscriptionList
      });
    }
  });

  return router;
};

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, starting graceful shutdown', {
    activeSubscriptions: activeSubscriptions.size,
    activeScrapers: activeScrapers.size
  });
  
  const stopPromises = Array.from(activeScrapers.entries()).map(async ([ticker, scraper]) => {
    try {
      logger.info('Stopping scraper during shutdown', { ticker });
      await scraper.stopMonitoring();
    } catch (error) {
      logger.error('Error stopping scraper during shutdown', { 
        ticker, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });
  
  await Promise.all(stopPromises);
  
  await browserManager.closeAll();
  
  logger.info('Graceful shutdown completed');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  
  browserManager.closeAll().finally(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString()
  });
});