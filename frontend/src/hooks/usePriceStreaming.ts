import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketClient, PriceUpdate, ConnectionState } from '../lib/websocket-client';

export interface PriceData extends PriceUpdate {}

export interface UsePriceStreamingReturn {
  priceData: Map<string, PriceData>;
  connectionState: ConnectionState;
  connect: () => void;
  disconnect: () => void;
  subscribeToTicker: (ticker: string) => void;
  unsubscribeFromTicker: (ticker: string) => void;
  onTickerValidationFailed: (callback: (ticker: string) => void) => void;
}

export function usePriceStreaming(): UsePriceStreamingReturn {
  const [priceData, setPriceData] = useState<Map<string, PriceData>>(() => {
    // Load price data from localStorage on initial render
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('crypto-price-data');
        if (stored) {
          const parsedData = JSON.parse(stored);
          const dataMap = new Map<string, PriceData>();
          
          // Convert stored array back to Map
          Object.entries(parsedData).forEach(([ticker, data]) => {
            dataMap.set(ticker, data as PriceData);
          });
          
          console.log('Restored price data from localStorage:', dataMap);
          return dataMap;
        }
      } catch (e) {
        console.warn('Failed to restore price data from localStorage:', e);
      }
    }
    return new Map();
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const wsClientRef = useRef<WebSocketClient | null>(null);

  const handlePriceUpdate = useCallback((update: PriceUpdate) => {
    console.log('Processing price update in hook:', update);
    
    setPriceData(prevData => {
      const newData = new Map(prevData);
      newData.set(update.ticker, {
        ticker: update.ticker,
        price: update.price,
        change24h: update.change24h,
        timestamp: update.timestamp
      });
      return newData;
    });
  }, []);

  const handleConnectionStateChange = useCallback((state: ConnectionState) => {
    console.log('WebSocket connection state changed to:', state);
    setConnectionState(state);
  }, []);

  const connect = useCallback(async () => {
    if (wsClientRef.current) {
      console.log('WebSocket client already exists, disconnecting first');
      wsClientRef.current.disconnect();
    }

    // Small delay to ensure server is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    wsClientRef.current = new WebSocketClient();
    wsClientRef.current.onPriceUpdateReceived(handlePriceUpdate);
    wsClientRef.current.onConnectionStateChanged(handleConnectionStateChange);
    
    try {
      await wsClientRef.current.connect();
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setConnectionState('error');
    }
  }, [handlePriceUpdate, handleConnectionStateChange]);

  const disconnect = useCallback(() => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    setPriceData(new Map());
    setConnectionState('disconnected');
  }, []);

  const subscribeToTicker = useCallback((ticker: string) => {
    if (wsClientRef.current) {
      wsClientRef.current.subscribeToTicker(ticker);
    }
  }, []);

  const unsubscribeFromTicker = useCallback((ticker: string) => {
    if (wsClientRef.current) {
      wsClientRef.current.unsubscribeFromTicker(ticker);
    }
  }, []);

  const onTickerValidationFailed = useCallback((callback: (ticker: string) => void) => {
    if (wsClientRef.current) {
      wsClientRef.current.onTickerValidationFailedReceived(callback);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }
    };
  }, [connect]);

  // Save price data to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && priceData.size > 0) {
      try {
        // Convert Map to plain object for JSON storage
        const dataObject: Record<string, PriceData> = {};
        priceData.forEach((data, ticker) => {
          dataObject[ticker] = data;
        });
        
        localStorage.setItem('crypto-price-data', JSON.stringify(dataObject));
        console.log('Saved price data to localStorage:', dataObject);
      } catch (e) {
        console.warn('Failed to save price data to localStorage:', e);
      }
    }
  }, [priceData]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return {
    priceData,
    connectionState,
    connect,
    disconnect,
    subscribeToTicker,
    unsubscribeFromTicker,
    onTickerValidationFailed
  };
}