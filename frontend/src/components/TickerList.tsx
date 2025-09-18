import { useState, useEffect, useRef } from 'react';
import { PriceData } from '../hooks/usePriceStreaming';
import styles from '../styles/TickerList.module.css';

interface TickerListProps {
  tickers: string[];
  priceData: Map<string, PriceData>;
  invalidTickers: Set<string>;
  onRemoveTicker: (ticker: string) => Promise<void>;
}

export function TickerList({ tickers, priceData, invalidTickers, onRemoveTicker }: TickerListProps) {
  const [fadingTickers, setFadingTickers] = useState<Set<string>>(new Set());
  const [movingUpTickers, setMovingUpTickers] = useState<Set<string>>(new Set());
  const [hoveredRemoveButton, setHoveredRemoveButton] = useState<string | null>(null);
  const [flashingPrices, setFlashingPrices] = useState<Set<string>>(new Set());
  const [newTickers, setNewTickers] = useState<Set<string>>(new Set());
  const [slidingTickers, setSlidingTickers] = useState<Set<string>>(new Set());
  const [waveBarTickers, setWaveBarTickers] = useState<Map<string, number>>(new Map());
  //const [notFoundTickers, setNotFoundTickers] = useState<Set<string>>(new Set());
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const previousTickersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentTickerSet = new Set(tickers);
    const previousTickerSet = previousTickersRef.current;
    
    const newTickersToAdd = new Set<string>();
    currentTickerSet.forEach(ticker => {
      if (!previousTickerSet.has(ticker)) {
        newTickersToAdd.add(ticker);
      }
    });
    
    if (newTickersToAdd.size > 0) {
      setNewTickers(prev => new Set([...prev, ...newTickersToAdd]));
      
      const sortedCurrentTickers = tickers.sort();
      const sortedPreviousTickers = Array.from(previousTickerSet).sort();
      
      const tickersToSlide = new Set<string>();
      newTickersToAdd.forEach(newTicker => {
        const newTickerIndex = sortedCurrentTickers.indexOf(newTicker);
        if (newTickerIndex < sortedCurrentTickers.length - 1) {
          sortedPreviousTickers.forEach(existingTicker => {
            if (existingTicker > newTicker) {
              tickersToSlide.add(existingTicker);
            }
          });
        }
      });
      
      if (tickersToSlide.size > 0) {
        setSlidingTickers(prev => new Set([...prev, ...tickersToSlide]));
        
        const waveBarMap = new Map<string, number>();
        const tickersToSlideArray = Array.from(tickersToSlide).sort();
        
        tickersToSlideArray.forEach((ticker, index) => {
          const delay = index * 50; 
          waveBarMap.set(ticker, delay);
          
          setTimeout(() => {
            setWaveBarTickers(prev => {
              const updated = new Map(prev);
              updated.delete(ticker);
              return updated;
            });
          }, 350 + delay); 
        });
        
        setWaveBarTickers(prev => new Map([...prev, ...waveBarMap]));
        
        setTimeout(() => {
          setSlidingTickers(prev => {
            const updated = new Set(prev);
            tickersToSlide.forEach(ticker => updated.delete(ticker));
            return updated;
          });
        }, 250);
      }
      
      setTimeout(() => {
        setNewTickers(prev => {
          const updated = new Set(prev);
          newTickersToAdd.forEach(ticker => updated.delete(ticker));
          return updated;
        });
      }, 150);
    }
    
    previousTickersRef.current = currentTickerSet;
  }, [tickers]);

  useEffect(() => {
    const currentPrices = previousPricesRef.current;
    const flashingTickersToAdd = new Set<string>();
    
    priceData.forEach((data, ticker) => {
      const previousPrice = currentPrices.get(ticker);
      if (previousPrice !== undefined && previousPrice !== data.price) {
        console.log('Price update for', ticker, ':', previousPrice, '→', data.price);
        flashingTickersToAdd.add(ticker);
      }
      currentPrices.set(ticker, data.price);
    });
    
    if (flashingTickersToAdd.size > 0) {
      setFlashingPrices(prev => new Set([...prev, ...flashingTickersToAdd]));
      
      setTimeout(() => {
        setFlashingPrices(prev => {
          const updated = new Set(prev);
          flashingTickersToAdd.forEach(ticker => updated.delete(ticker));
          return updated;
        });
      }, 1500);
    }
  }, [priceData]);

  const handleRemove = async (ticker: string) => {
    console.log('Starting removal process for ticker:', ticker);
    
    try {
      const sortedTickers = tickers.sort();
      const removedIndex = sortedTickers.indexOf(ticker);
      const tickersToMoveUp = sortedTickers.slice(removedIndex + 1);
      
      if (tickersToMoveUp.length > 0) {
        console.log('Tickers that will move up:', tickersToMoveUp);
      }
      
      setFadingTickers(prev => new Set([...prev, ticker]));
      
      if (tickersToMoveUp.length > 0) {
        setMovingUpTickers(prev => new Set([...prev, ...tickersToMoveUp]));
      }
      
      setTimeout(async () => {
        try {
          await onRemoveTicker(ticker);
          console.log('Successfully removed ticker:', ticker);
        } catch (error) {
          console.error('Backend removal failed for ticker:', ticker, 'Error:', error);
          throw error;
        }
        
        setFadingTickers(prev => {
          const updated = new Set(prev);
          updated.delete(ticker);
          return updated;
        });
        
        setMovingUpTickers(prev => {
          const updated = new Set(prev);
          tickersToMoveUp.forEach(t => updated.delete(t));
          return updated;
        });
        
      }, 300); 
      
    } catch (error) {
      console.error('Failed to initiate ticker removal:', ticker, 'Error:', error);
      setFadingTickers(prev => {
        const updated = new Set(prev);
        updated.delete(ticker);
        return updated;
      });
    }
  };

  if (tickers.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {tickers.sort().map((ticker) => {
        const price = priceData.get(ticker);
        const isFading = fadingTickers.has(ticker);
        const isMovingUp = movingUpTickers.has(ticker);
        const isRemoveHovered = hoveredRemoveButton === ticker;
        const isFlashing = flashingPrices.has(ticker);
        const isNew = newTickers.has(ticker);
        const isSliding = slidingTickers.has(ticker);
        const waveBarDelay = waveBarTickers.get(ticker);
        const hasWaveBar = waveBarDelay !== undefined;
        const isNotFound = invalidTickers.has(ticker);
        
        const tickerItemClasses = [
          styles.tickerItem,
          isFading && styles.fading,
          isNew && styles.new,
          isSliding && styles.sliding,
          isMovingUp && styles.movingUp
        ].filter(Boolean).join(' ');

        return (
          <div 
            key={ticker}
            className={tickerItemClasses}
          >
            <span className={styles.tickerSymbol}>
              {ticker}
            </span>
            
            <div className={styles.priceContainer}>
              {price ? (
                <span className={`${styles.price} ${isFlashing ? styles.flashing : ''}`}>
                  {price.price.toLocaleString('en-US', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 8
                  })}
                </span>
              ) : isNotFound ? (
                <span className={styles.notFoundMessage}>
                  Not Found Please Remove
                </span>
              ) : (
                <div className={styles.loadingSpinner} />
              )}
              
              <button
                onClick={() => handleRemove(ticker)}
                onMouseEnter={() => setHoveredRemoveButton(ticker)}
                onMouseLeave={() => setHoveredRemoveButton(null)}
                className={`${styles.removeButton} ${isRemoveHovered ? styles.hovered : ''}`}
              >
                ×
              </button>
            </div>
            
            {hasWaveBar && (
              <div
                className={styles.waveBar}
                style={{ animationDelay: `${waveBarDelay}ms` }}
              />
            )}
          </div>
        );
      })}
      
    </div>
  );
}