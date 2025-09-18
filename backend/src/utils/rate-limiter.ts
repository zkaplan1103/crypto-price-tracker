import { createLogger } from './logger';

const logger = createLogger('rate-limiter');

interface ClientRateLimit {
  subscriptionAttempts: number[];
  subscriptionCount: number;
  lastSubscriptionTime: number;
  warningsSent: number;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private clients: Map<string, ClientRateLimit> = new Map();
  
  // Rate limiting configuration
  private readonly MAX_SUBSCRIPTIONS_PER_CLIENT = 20; // Maximum concurrent subscriptions per client
  private readonly MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE = 30; // Maximum subscription attempts per minute
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  
  private cleanupInterval: NodeJS.Timeout;

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  constructor() {
    // Periodically cleanup old client data
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldClients();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Check if a client can subscribe to a new ticker
   */
  canSubscribe(clientId: string): { allowed: boolean; reason?: string; waitTime?: number } {
    const client = this.getOrCreateClient(clientId);
    const now = Date.now();

    // Check concurrent subscription limit
    if (client.subscriptionCount >= this.MAX_SUBSCRIPTIONS_PER_CLIENT) {
      logger.warn('Client exceeded max concurrent subscriptions', {
        clientId,
        currentCount: client.subscriptionCount,
        maxAllowed: this.MAX_SUBSCRIPTIONS_PER_CLIENT
      });
      
      return {
        allowed: false,
        reason: `Maximum concurrent subscriptions exceeded (${this.MAX_SUBSCRIPTIONS_PER_CLIENT})`
      };
    }

    // Clean old attempts outside the time window
    client.subscriptionAttempts = client.subscriptionAttempts.filter(
      attempt => now - attempt < this.RATE_LIMIT_WINDOW_MS
    );

    // Check subscription attempts per minute
    if (client.subscriptionAttempts.length >= this.MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE) {
      const oldestAttempt = Math.min(...client.subscriptionAttempts);
      const waitTime = Math.ceil((this.RATE_LIMIT_WINDOW_MS - (now - oldestAttempt)) / 1000);
      
      // Send warning for rate limiting (limit to 3 warnings to avoid spam)
      if (client.warningsSent < 3) {
        client.warningsSent++;
        logger.warn('Client rate limited for subscription attempts', {
          clientId,
          attemptsInWindow: client.subscriptionAttempts.length,
          maxAllowed: this.MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE,
          waitTimeSeconds: waitTime
        });
      }
      
      return {
        allowed: false,
        reason: `Rate limit exceeded. Too many subscription attempts in the last minute`,
        waitTime: waitTime
      };
    }

    return { allowed: true };
  }

  /**
   * Record a subscription attempt
   */
  recordSubscriptionAttempt(clientId: string): void {
    const client = this.getOrCreateClient(clientId);
    client.subscriptionAttempts.push(Date.now());
    client.lastSubscriptionTime = Date.now();
  }

  /**
   * Record a successful subscription
   */
  recordSuccessfulSubscription(clientId: string): void {
    const client = this.getOrCreateClient(clientId);
    client.subscriptionCount++;
    
    logger.debug('Recorded successful subscription', {
      clientId,
      newCount: client.subscriptionCount
    });
  }

  /**
   * Record an unsubscription
   */
  recordUnsubscription(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptionCount = Math.max(0, client.subscriptionCount - 1);
      
      logger.debug('Recorded unsubscription', {
        clientId,
        newCount: client.subscriptionCount
      });
    }
  }

  /**
   * Remove all rate limit data for a client (called when client disconnects)
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      logger.debug('Removing rate limit data for client', {
        clientId,
        subscriptionCount: client.subscriptionCount,
        attemptsInWindow: client.subscriptionAttempts.length
      });
      
      this.clients.delete(clientId);
    }
  }

  /**
   * Get rate limit stats for a client
   */
  getClientStats(clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) {
      return null;
    }

    const now = Date.now();
    const recentAttempts = client.subscriptionAttempts.filter(
      attempt => now - attempt < this.RATE_LIMIT_WINDOW_MS
    ).length;

    return {
      subscriptionCount: client.subscriptionCount,
      recentAttempts,
      maxSubscriptions: this.MAX_SUBSCRIPTIONS_PER_CLIENT,
      maxAttemptsPerMinute: this.MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE,
      remainingSubscriptions: this.MAX_SUBSCRIPTIONS_PER_CLIENT - client.subscriptionCount,
      remainingAttempts: this.MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE - recentAttempts
    };
  }

  /**
   * Get overall rate limiter statistics
   */
  getStats() {
    return {
      activeClients: this.clients.size,
      totalCurrentSubscriptions: Array.from(this.clients.values())
        .reduce((sum, client) => sum + client.subscriptionCount, 0),
      rateLimitConfig: {
        maxSubscriptionsPerClient: this.MAX_SUBSCRIPTIONS_PER_CLIENT,
        maxAttemptsPerMinute: this.MAX_SUBSCRIPTION_ATTEMPTS_PER_MINUTE,
        windowSizeMs: this.RATE_LIMIT_WINDOW_MS
      }
    };
  }

  private getOrCreateClient(clientId: string): ClientRateLimit {
    if (!this.clients.has(clientId)) {
      this.clients.set(clientId, {
        subscriptionAttempts: [],
        subscriptionCount: 0,
        lastSubscriptionTime: Date.now(),
        warningsSent: 0
      });
      
      logger.debug('Created new rate limit tracking for client', { clientId });
    }
    
    return this.clients.get(clientId)!;
  }

  private cleanupOldClients(): void {
    const now = Date.now();
    const cutoffTime = 30 * 60 * 1000; // 30 minutes
    let removedClients = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastSubscriptionTime > cutoffTime && client.subscriptionCount === 0) {
        this.clients.delete(clientId);
        removedClients++;
      }
    }

    if (removedClients > 0) {
      logger.info('Cleaned up inactive rate limit clients', {
        removedClients,
        remainingClients: this.clients.size
      });
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clients.clear();
    logger.info('Rate limiter shutdown completed');
  }
}

export const rateLimiter = RateLimiter.getInstance();