import { useState, useEffect } from 'react';
import { validateTicker } from '../utils/ticker-validation';
import styles from '../styles/AddTickerForm.module.css';

interface AddTickerFormProps {
  onAddTicker: (ticker: string) => Promise<void>;
  existingTickers: string[];
}

export function AddTickerForm({ onAddTicker, existingTickers }: AddTickerFormProps) {
  const [ticker, setTicker] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    const normalizedTicker = ticker.trim().toUpperCase();
    console.log('Attempting to add ticker:', normalizedTicker);
    
    const validation = validateTicker(normalizedTicker, existingTickers);
    if (!validation.isValid) {
      console.log('Ticker validation failed:', validation.error, 'for ticker:', normalizedTicker);
      setValidationError(validation.error || 'Invalid ticker');
      return;
    }

    // Clear text box only after validation passes
    setTicker('');
    console.log('Ticker validation passed for:', normalizedTicker);
    setValidationError(null);
    setIsSubmitting(true);
    
    try {
      await onAddTicker(normalizedTicker);
      console.log('Successfully added ticker:', normalizedTicker);
    } catch (error) {
      console.error('Failed to add ticker:', normalizedTicker, 'Error:', error);
      setValidationError('Failed to add ticker. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTicker(e.target.value);
    setValidationError(null);
  };

  useEffect(() => {
    if (validationError) {
      const timer = setTimeout(() => {
        setValidationError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [validationError]);

  return (
    <div className={styles.formContainer}>
      {validationError && (
        <div className={styles.validationError}>
          {validationError}
        </div>
      )}
      <div className={styles.inputContainer}>
        <div 
          className={`${styles.inputWrapper} ${isHovered ? styles.hovered : styles.default}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className={styles.inputLabel}>
            Ticker
          </div>
          <input
            type="text"
            value={ticker}
            onChange={handleInputChange}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={!isFocused && !ticker ? "e.g. TSLA" : ""}
            className={styles.input}
          />
        </div>
        <button 
          type="button"
          onClick={() => handleSubmit()}
          className={styles.addButton}
        >
          Add
        </button>
      </div>
    </div>
  );
}