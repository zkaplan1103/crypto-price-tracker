import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { PriceData } from './price-scraper';
import { rateLimiter } from '../utils/rate-limiter';

const logger = createLogger('websocket-manager');

interface ClientSubscription {
  id: string;
  ws: WebSocket;
  subscribedTickers: Set<string>;
  lastPing: number;
}

export class WebSocketManager {
  private static instance: WebSocketManager;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientSubscription> = new Map();
  private tickerSubscribers: Map<string, Set<string>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  initialize(server: any): void {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      clientTracking: true
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const clientIp = req.socket.remoteAddress || 'unknown';
      
      logger.info('New WebSocket connection', {
        clientId,
        clientIp,
        totalClients: this.clients.size + 1
      });

      const client: ClientSubscription = {
        id: clientId,
        ws,
        subscribedTickers: new Set(),
        lastPing: Date.now()
      };

      this.clients.set(clientId, client);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch (error) {
          logger.warn('Invalid message from client', {
            clientId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          this.sendToClient(clientId, { type: 'error', message: 'Invalid message format' });
        }
      });

      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastPing = Date.now();
        }
      });

      ws.on('close', (code, reason) => {
        logger.info('WebSocket connection closed', {
          clientId,
          code,
          reason: reason.toString(),
          totalClients: this.clients.size - 1
        });
        this.removeClient(clientId);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', {
          clientId,
          error: error.message
        });
        this.removeClient(clientId);
      });

      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        message: 'WebSocket connection established'
      });
    });

    this.startPingInterval();

    logger.info('WebSocket server initialized', {
      path: '/ws'
    });
  }

  private handleClientMessage(clientId: string, message: any): void {
    logger.debug('Received client message', { clientId, messageType: message.type });

    switch (message.type) {
      case 'subscribe':
        this.subscribeClientToTicker(clientId, message.ticker);
        break;
      case 'unsubscribe':
        this.unsubscribeClientFromTicker(clientId, message.ticker);
        break;
      case 'ping':
        this.sendToClient(clientId, { type: 'pong' });
        break;
      case 'get_rate_limit_stats':
        const clientStats = rateLimiter.getClientStats(clientId);
        this.sendToClient(clientId, {
          type: 'rate_limit_stats',
          data: clientStats
        });
        break;
      default:
        logger.warn('Unknown message type', { clientId, messageType: message.type });
        this.sendToClient(clientId, { type: 'error', message: 'Unknown message type' });
    }
  }

  private subscribeClientToTicker(clientId: string, ticker: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      logger.warn('Attempted to subscribe non-existent client', { clientId, ticker });
      return;
    }

    const normalizedTicker = ticker.toUpperCase().trim();

    // Record the subscription attempt for rate limiting
    rateLimiter.recordSubscriptionAttempt(clientId);

    // Check rate limits
    const rateLimitCheck = rateLimiter.canSubscribe(clientId);
    if (!rateLimitCheck.allowed) {
      logger.warn('Client subscription blocked by rate limiter', {
        clientId,
        ticker: normalizedTicker,
        reason: rateLimitCheck.reason
      });

      this.sendToClient(clientId, {
        type: 'subscription_denied',
        ticker: normalizedTicker,
        message: rateLimitCheck.reason,
        waitTime: rateLimitCheck.waitTime
      });
      return;
    }

    // Check if already subscribed
    if (client.subscribedTickers.has(normalizedTicker)) {
      this.sendToClient(clientId, {
        type: 'already_subscribed',
        ticker: normalizedTicker,
        message: `Already subscribed to ${normalizedTicker}`
      });
      return;
    }

    client.subscribedTickers.add(normalizedTicker);

    if (!this.tickerSubscribers.has(normalizedTicker)) {
      this.tickerSubscribers.set(normalizedTicker, new Set());
    }
    this.tickerSubscribers.get(normalizedTicker)!.add(clientId);

    // Record successful subscription for rate limiting
    rateLimiter.recordSuccessfulSubscription(clientId);

    logger.info('Client subscribed to ticker', {
      clientId,
      ticker: normalizedTicker,
      clientTickerCount: client.subscribedTickers.size,
      tickerSubscriberCount: this.tickerSubscribers.get(normalizedTicker)!.size
    });

    this.sendToClient(clientId, {
      type: 'subscribed',
      ticker: normalizedTicker,
      message: `Subscribed to ${normalizedTicker}`
    });
  }

  private unsubscribeClientFromTicker(clientId: string, ticker: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const normalizedTicker = ticker.toUpperCase().trim();
    
    // Only update rate limiter if client was actually subscribed
    if (client.subscribedTickers.has(normalizedTicker)) {
      rateLimiter.recordUnsubscription(clientId);
    }
    
    client.subscribedTickers.delete(normalizedTicker);

    const tickerSubs = this.tickerSubscribers.get(normalizedTicker);
    if (tickerSubs) {
      tickerSubs.delete(clientId);
      if (tickerSubs.size === 0) {
        this.tickerSubscribers.delete(normalizedTicker);
      }
    }

    logger.info('Client unsubscribed from ticker', {
      clientId,
      ticker: normalizedTicker,
      remainingClientTickers: client.subscribedTickers.size,
      remainingTickerSubscribers: tickerSubs ? tickerSubs.size : 0
    });

    this.sendToClient(clientId, {
      type: 'unsubscribed',
      ticker: normalizedTicker,
      message: `Unsubscribed from ${normalizedTicker}`
    });
  }

  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const ticker of client.subscribedTickers) {
      const tickerSubs = this.tickerSubscribers.get(ticker);
      if (tickerSubs) {
        tickerSubs.delete(clientId);
        if (tickerSubs.size === 0) {
          this.tickerSubscribers.delete(ticker);
        }
      }
    }

    this.clients.delete(clientId);
    
    // Clean up rate limiting data for this client
    rateLimiter.removeClient(clientId);

    logger.info('Client removed', {
      clientId,
      remainingClients: this.clients.size
    });
  }

  broadcastTickerValidationFailure(ticker: string): void {
    const subscribers = this.tickerSubscribers.get(ticker);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = {
      type: 'ticker_validation_failed',
      data: {
        ticker: ticker,
        message: 'Ticker validation failed - no price data found'
      }
    };

    let successCount = 0;
    let errorCount = 0;

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        subscribers.delete(clientId);
        if (client) this.clients.delete(clientId);
        continue;
      }

      try {
        client.ws.send(JSON.stringify(message));
        successCount++;
      } catch (error) {
        errorCount++;
        logger.error('Failed to send validation failure to client', {
          clientId,
          ticker: ticker,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        this.removeClient(clientId);
      }
    }

    logger.info('Ticker validation failure broadcast complete', {
      ticker: ticker,
      successCount,
      errorCount,
      totalSubscribers: successCount + errorCount
    });
  }

  broadcastPriceUpdate(priceData: PriceData): void {
    const subscribers = this.tickerSubscribers.get(priceData.ticker);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = {
      type: 'price_update',
      data: {
        ticker: priceData.ticker,
        price: priceData.price,
        change24h: priceData.change24h,
        timestamp: priceData.timestamp
      }
    };

    let successCount = 0;
    let errorCount = 0;

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        subscribers.delete(clientId);
        if (client) this.clients.delete(clientId);
        continue;
      }

      try {
        client.ws.send(JSON.stringify(message));
        successCount++;
      } catch (error) {
        errorCount++;
        logger.error('Failed to send price update to client', {
          clientId,
          ticker: priceData.ticker,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        this.removeClient(clientId);
      }
    }

    logger.debug('Price update broadcast complete', {
      ticker: priceData.ticker,
      price: priceData.price,
      successCount,
      errorCount,
      totalSubscribers: successCount + errorCount
    });
  }

  private sendToClient(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send message to client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.removeClient(clientId);
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const deadClients: string[] = [];

      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          deadClients.push(clientId);
          continue;
        }

        if (now - client.lastPing > 60000) {
          logger.warn('Client appears dead, removing', { clientId, lastPing: client.lastPing });
          deadClients.push(clientId);
          continue;
        }

        try {
          client.ws.ping();
        } catch (error) {
          logger.error('Failed to ping client', { clientId });
          deadClients.push(clientId);
        }
      }

      deadClients.forEach(clientId => this.removeClient(clientId));
    }, 30000);
  }

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getStats() {
    const rateLimiterStats = rateLimiter.getStats();
    
    return {
      clients: this.clients.size,
      subscriptions: Array.from(this.tickerSubscribers.values())
        .reduce((sum, subs) => sum + subs.size, 0),
      rateLimiting: rateLimiterStats
    };
  }

  shutdown(): void {
    logger.info('Shutting down WebSocket server', {
      activeConnections: this.clients.size
    });

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    for (const [clientId, client] of this.clients) {
      try {
        client.ws.close(1001, 'Server shutting down');
      } catch (error) {
        logger.error('Error closing client connection during shutdown', { clientId });
      }
    }

    this.clients.clear();
    this.tickerSubscribers.clear();

    // Shutdown rate limiter
    rateLimiter.shutdown();

    if (this.wss) {
      this.wss.close();
    }
  }
}

export const wsManager = WebSocketManager.getInstance();