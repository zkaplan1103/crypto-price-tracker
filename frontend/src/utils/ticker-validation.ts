export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateTicker = (ticker: string, existingTickers: string[]): ValidationResult => {
  const trimmedTicker = ticker.trim();
  
  if (!trimmedTicker) {
    return { isValid: false, error: 'Ticker cannot be empty' };
  }
  
  if (!/^[A-Za-z0-9]+$/.test(trimmedTicker)) {
    return { isValid: false, error: 'Ticker can only contain letters and numbers' };
  }
  
  const upperTicker = trimmedTicker.toUpperCase();
  if (!upperTicker.endsWith('USD')) {
    return { isValid: false, error: 'Ticker must end with USD' };
  }
  
  if (existingTickers.includes(upperTicker)) {
    return { isValid: false, error: 'Ticker already added' };
  }
  
  return { isValid: true };
};