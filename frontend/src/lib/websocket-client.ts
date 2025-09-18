export interface PriceUpdate {
  ticker: string;
  price: number;
  change24h: number;
  timestamp: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private connectionTimeoutMs: number = 5000;
  
  private onPriceUpdate: (data: PriceUpdate) => void = () => {};
  private onConnectionStateChange: (state: ConnectionState) => void = () => {};
  private onTickerValidationFailed: (ticker: string) => void = () => {};

  constructor(url: string = 'ws://localhost:8080/ws') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Attempting WebSocket connection to', this.url);
        this.onConnectionStateChange('connecting');
        
        // Clean up any existing connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        
        // Set a connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            console.error('WebSocket connection timeout');
            this.ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, this.connectionTimeoutMs);
        
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected successfully');
          
          // Clear connection timeout on successful connection
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          
          this.onConnectionStateChange('connected');
          this.reconnectAttempts = 0;
          this.startPingInterval();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'price_update') {
              console.log('Received price update:', data.data);
              this.onPriceUpdate(data.data);
            } else if (data.type === 'ticker_validation_failed') {
              console.log('Ticker validation failed:', data.data.ticker);
              this.onTickerValidationFailed(data.data.ticker);
            } else if (data.type === 'pong') {
              console.log('Received pong');
            } else if (data.type === 'connected') {
              console.log('Server confirmed connection:', data.message);
            } else if (data.type === 'subscription_denied') {
              console.warn('Subscription denied:', data.message);
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error, 'Raw data:', event.data);
          }
        };
        
        this.ws.onclose = (event) => {
          console.warn('WebSocket connection closed:', {
            code: event.code, 
            reason: event.reason,
            wasClean: event.wasClean
          });
          
          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          
          this.cleanup();
          this.onConnectionStateChange('disconnected');
          
          // Only attempt to reconnect if this wasn't a manual disconnect
          if (event.code !== 1000) {
            this.scheduleReconnect();
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error occurred:', error);
          
          // Clear connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          
          this.onConnectionStateChange('error');
          
          // Don't immediately reject - let the close handler manage reconnection
          // Only reject if we're in the initial connection attempt
          if (this.reconnectAttempts === 0) {
            reject(new Error('WebSocket connection failed'));
          }
        };
        
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        this.onConnectionStateChange('error');
        reject(error);
      }
    });
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
          console.log('Sent ping to server');
        } catch (error) {
          console.error('Failed to send ping:', error);
        }
      }
    }, 30000);
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached, giving up');
      this.onConnectionStateChange('error');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    
    console.log('Scheduling WebSocket reconnection in', delay, 'ms. Attempt:', this.reconnectAttempts + 1);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch((error) => {
        console.error('Reconnection attempt failed:', error);
      });
    }, delay);
  }

  onPriceUpdateReceived(callback: (data: PriceUpdate) => void): void {
    this.onPriceUpdate = callback;
  }

  onConnectionStateChanged(callback: (state: ConnectionState) => void): void {
    this.onConnectionStateChange = callback;
  }

  onTickerValidationFailedReceived(callback: (ticker: string) => void): void {
    this.onTickerValidationFailed = callback;
  }

  subscribeToTicker(ticker: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('Subscribing to ticker via WebSocket:', ticker);
      this.ws.send(JSON.stringify({ type: 'subscribe', ticker }));
    } else {
      console.warn('Cannot subscribe - WebSocket not connected');
    }
  }

  unsubscribeFromTicker(ticker: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('Unsubscribing from ticker via WebSocket:', ticker);
      this.ws.send(JSON.stringify({ type: 'unsubscribe', ticker }));
    }
  }

  disconnect(): void {
    console.log('Manually disconnecting WebSocket');
    
    this.cleanup();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.onConnectionStateChange('disconnected');
  }

  getConnectionState(): ConnectionState {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'error';
    }
  }
}