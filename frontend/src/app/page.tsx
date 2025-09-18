'use client';

import { useState, useEffect } from 'react';
import { cryptoStreamClient } from '../lib/connect-client';
import { SubscriptionRequest, SubscriptionResponse } from '../gen/proto/crypto_stream/v1/service_pb';
import { Empty } from '@bufbuild/protobuf';
import { TickerList } from '../components/TickerList';
import { AddTickerForm } from '../components/AddTickerForm';
import { usePriceStreaming } from '../hooks/usePriceStreaming';
import styles from '../styles/HomePage.module.css';

export default function HomePage() {
  const [activeTickers, setActiveTickers] = useState<string[]>(() => {
    // Load tickers from localStorage on initial render
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('crypto-tickers');
        return stored ? JSON.parse(stored) : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validatingTickers, setValidatingTickers] = useState<Set<string>>(new Set());
  const [invalidTickers, setInvalidTickers] = useState<Set<string>>(new Set());
  
  const { 
    priceData, 
    connectionState,
    subscribeToTicker,
    unsubscribeFromTicker,
    onTickerValidationFailed
  } = usePriceStreaming();

  // Set up ticker validation failure callback
  useEffect(() => {
    onTickerValidationFailed((ticker: string) => {
      setInvalidTickers(prev => new Set([...prev, ticker]));
      setValidatingTickers(prev => {
        const updated = new Set(prev);
        updated.delete(ticker);
        return updated;
      });
    });
  }, [onTickerValidationFailed]);

  // Clear validating state when price data is received
  useEffect(() => {
    priceData.forEach((_, ticker) => {
      setValidatingTickers(prev => {
        if (prev.has(ticker)) {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        }
        return prev;
      });
      setInvalidTickers(prev => {
        if (prev.has(ticker)) {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        }
        return prev;
      });
    });
  }, [priceData]);

  const loadActiveTickers = async () => {
    try {
      const request = new Empty();
      const response = await cryptoStreamClient.getActiveSubscriptions(request) as SubscriptionResponse;
      
      // Get current frontend tickers (from localStorage)
      const currentFrontendTickers = activeTickers;
      const backendTickers = response.activeTickers;
      
      console.log('Frontend tickers from localStorage:', currentFrontendTickers);
      console.log('Backend active tickers:', backendTickers);
      
      // Start with backend tickers
      setActiveTickers(backendTickers.sort());
      
      // Find tickers that exist in frontend but not in backend (need revalidation)
      const tickersToRevalidate = currentFrontendTickers.filter(
        ticker => !backendTickers.includes(ticker)
      );
      
      console.log('Tickers needing revalidation:', tickersToRevalidate);
      console.log('Tickers that will be resubscribed to WebSocket:', backendTickers);
      
      // Always resubscribe to WebSocket for ALL backend tickers (lost on refresh)
      if (backendTickers.length > 0) {
        setTimeout(() => {
          console.log('Resubscribing to WebSocket for backend tickers:', backendTickers);
          backendTickers.forEach(ticker => {
            console.log('Subscribing to WebSocket for:', ticker);
            subscribeToTicker(ticker);
            
            // If we have cached price data, don't show as validating
            if (priceData.has(ticker)) {
              console.log('Found cached price data for:', ticker, 'not showing as validating');
              setValidatingTickers(prev => {
                const updated = new Set(prev);
                updated.delete(ticker);
                return updated;
              });
            }
          });
        }, 1000);
      }
      
      // Handle frontend-only tickers that need backend revalidation
      if (tickersToRevalidate.length > 0) {
        console.log('Revalidating tickers after refresh:', tickersToRevalidate);
        
        // Add them back to the UI as validating
        setActiveTickers(prev => [...prev, ...tickersToRevalidate].sort());
        setValidatingTickers(prev => new Set([...prev, ...tickersToRevalidate]));
        
        // Wait a bit for WebSocket connection to establish, then revalidate
        setTimeout(async () => {
          console.log('Starting ticker revalidation, WebSocket state:', connectionState);
          
          for (const ticker of tickersToRevalidate) {
            try {
              console.log('Revalidating ticker:', ticker);
              
              // Subscribe to WebSocket first
              subscribeToTicker(ticker);
              
              // Small delay to ensure WebSocket subscription is processed
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Try to subscribe via backend
              const subRequest = new SubscriptionRequest({ ticker });
              const subResponse = await cryptoStreamClient.subscribeTicker(subRequest);
              
              console.log('Backend response for', ticker, ':', subResponse);
              
              if (subResponse.success) {
                // Successfully revalidated
                setValidatingTickers(prev => {
                  const updated = new Set(prev);
                  updated.delete(ticker);
                  return updated;
                });
                console.log('Successfully revalidated ticker:', ticker);
              } else {
                // Failed revalidation - mark as invalid
                setValidatingTickers(prev => {
                  const updated = new Set(prev);
                  updated.delete(ticker);
                  return updated;
                });
                setInvalidTickers(prev => new Set([...prev, ticker]));
                unsubscribeFromTicker(ticker);
                console.log('Ticker revalidation failed:', ticker, subResponse.message);
              }
            } catch (error) {
              // Error revalidating - mark as invalid
              setValidatingTickers(prev => {
                const updated = new Set(prev);
                updated.delete(ticker);
                return updated;
              });
              setInvalidTickers(prev => new Set([...prev, ticker]));
              unsubscribeFromTicker(ticker);
              console.error('Error revalidating ticker:', ticker, error);
            }
          }
        }, 1500); // Wait 1.5 seconds for WebSocket connection
      }
      
      setError(null);
    } catch (err) {
      console.error('Failed to load active tickers:', err);
      setError('Failed to load active tickers');
    } finally {
      setLoading(false);
    }
  };

  const addTicker = async (ticker: string) => {
    try {
      setError(null);
      
      // Add ticker to list immediately for instant UI feedback
      setActiveTickers(prev => [...prev, ticker].sort());
      setValidatingTickers(prev => new Set([...prev, ticker]));
      setInvalidTickers(prev => {
        const updated = new Set(prev);
        updated.delete(ticker);
        return updated;
      });
      
      // Subscribe to WebSocket
      subscribeToTicker(ticker);
      
      // Small delay to ensure WebSocket subscription is processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const request = new SubscriptionRequest({ ticker });
      const response = await cryptoStreamClient.subscribeTicker(request) as SubscriptionResponse;
      
      if (response.success) {
        // Backend validated - just clear validating state
        // Don't update activeTickers here to preserve invalid ones
        setValidatingTickers(prev => {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        });
      } else {
        // Backend rejected - keep ticker in UI but mark as invalid
        // Keep the ticker in activeTickers so it shows in the UI
        setValidatingTickers(prev => {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        });
        // Mark as invalid so it shows "not found, please remove"
        setInvalidTickers(prev => new Set([...prev, ticker]));
        unsubscribeFromTicker(ticker);
        // Don't throw error, just let it show as invalid
      }
    } catch (err) {
      console.error('Failed to add ticker:', err);
      // For network/system errors, remove from list and show error
      setActiveTickers(prev => prev.filter(t => t !== ticker));
      setValidatingTickers(prev => {
        const updated = new Set(prev);
        updated.delete(ticker);
        return updated;
      });
      unsubscribeFromTicker(ticker);
      setError('Failed to add ticker - network or system error');
    }
  };

  const removeTicker = async (ticker: string) => {
    try {
      setError(null);
      
      // Check if this is an invalid ticker - if so, just remove from frontend
      if (invalidTickers.has(ticker)) {
        setActiveTickers(prev => prev.filter(t => t !== ticker));
        setInvalidTickers(prev => {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        });
        unsubscribeFromTicker(ticker);
        return;
      }
      
      // Check if ticker is still validating - if so, just remove from frontend
      if (validatingTickers.has(ticker)) {
        setActiveTickers(prev => prev.filter(t => t !== ticker));
        setValidatingTickers(prev => {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        });
        unsubscribeFromTicker(ticker);
        return;
      }
      
      // For valid tickers, call backend to unsubscribe
      const request = new SubscriptionRequest({ ticker });
      const response = await cryptoStreamClient.unsubscribeTicker(request) as SubscriptionResponse;
      
      if (response.success) {
        setActiveTickers(prev => prev.filter(t => t !== ticker));
        unsubscribeFromTicker(ticker);
      } else {
        setError(response.message || 'Failed to remove ticker');
      }
    } catch (err) {
      console.error('Failed to remove ticker:', err);
      setError('Failed to remove ticker');
    }
  };

  // Save tickers to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('crypto-tickers', JSON.stringify(activeTickers));
      } catch (e) {
        console.warn('Failed to save tickers to localStorage:', e);
      }
    }
  }, [activeTickers]);

  // Auto-hide error messages after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    loadActiveTickers();
  }, []);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingText}>
          Loading application...
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <AddTickerForm onAddTicker={addTicker} existingTickers={activeTickers} />
      
      {error && (
        <div className={styles.errorMessage}>
          {error}
        </div>
      )}
      
      <TickerList 
        tickers={activeTickers}
        priceData={priceData}
        invalidTickers={invalidTickers}
        onRemoveTicker={removeTicker}
      />
    </div>
  );
}