import { createLogger } from './logger';

const logger = createLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface FailureType {
  type: 'BROWSER_CRASH' | 'NETWORK_TIMEOUT' | 'PAGE_LOAD_FAILURE' | 'WEBSOCKET_ERROR' | 'SYSTEM_ERROR';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface FailureRecord {
  timestamp: number;
  failureType: FailureType;
  service: string;
  details: string;
}

interface CircuitStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  nextRetryTime: number;
  totalRequests: number;
  failureRate: number;
}

export class CircuitBreaker {
  private static instance: CircuitBreaker;
  private circuits: Map<string, CircuitStats> = new Map();
  private failures: Map<string, FailureRecord[]> = new Map();
  
  // Configuration per circuit type
  private readonly circuitConfigs = {
    browser: {
      failureThreshold: 5,       // Failures before opening
      recoveryTimeout: 30000,    // 30 seconds
      halfOpenMaxRequests: 3,    // Test requests in half-open
      windowSizeMs: 60000,       // 1 minute sliding window
    },
    websocket: {
      failureThreshold: 10,
      recoveryTimeout: 15000,    // 15 seconds  
      halfOpenMaxRequests: 5,
      windowSizeMs: 30000,       // 30 seconds
    },
    system: {
      failureThreshold: 3,
      recoveryTimeout: 60000,    // 1 minute
      halfOpenMaxRequests: 2,
      windowSizeMs: 120000,      // 2 minutes
    }
  };

  static getInstance(): CircuitBreaker {
    if (!CircuitBreaker.instance) {
      CircuitBreaker.instance = new CircuitBreaker();
    }
    return CircuitBreaker.instance;
  }

  /**
   * Check if a circuit allows execution
   * IMPORTANT: Only call this for real system failures, NOT ticker validation
   */
  canExecute(circuitName: string): boolean {
    const circuit = this.getOrCreateCircuit(circuitName);
    const now = Date.now();

    switch (circuit.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        if (now >= circuit.nextRetryTime) {
          logger.info('Circuit breaker transitioning to HALF_OPEN', { circuitName });
          circuit.state = 'HALF_OPEN';
          circuit.successCount = 0;
          return true;
        }
        return false;

      case 'HALF_OPEN':
        return circuit.successCount < this.getConfig(circuitName).halfOpenMaxRequests;

      default:
        return true;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    circuit.successCount++;
    circuit.totalRequests++;

    if (circuit.state === 'HALF_OPEN') {
      const config = this.getConfig(circuitName);
      if (circuit.successCount >= config.halfOpenMaxRequests) {
        logger.info('Circuit breaker recovered, transitioning to CLOSED', { 
          circuitName,
          successCount: circuit.successCount 
        });
        circuit.state = 'CLOSED';
        circuit.failureCount = 0;
        this.cleanupOldFailures(circuitName);
      }
    }

    this.updateFailureRate(circuitName);
  }

  /**
   * Record a failure - ONLY for real system failures
   * Do NOT call this for ticker validation failures or business logic errors
   */
  recordFailure(circuitName: string, failureType: FailureType, details: string = ''): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    const now = Date.now();
    
    // Record the failure
    const failure: FailureRecord = {
      timestamp: now,
      failureType,
      service: circuitName,
      details
    };

    if (!this.failures.has(circuitName)) {
      this.failures.set(circuitName, []);
    }
    this.failures.get(circuitName)!.push(failure);

    circuit.failureCount++;
    circuit.totalRequests++;
    circuit.lastFailureTime = now;

    // Clean up old failures outside the window
    this.cleanupOldFailures(circuitName);

    // Update failure rate
    this.updateFailureRate(circuitName);

    const config = this.getConfig(circuitName);
    const recentFailures = this.getRecentFailures(circuitName);

    logger.warn('Circuit breaker recorded failure', {
      circuitName,
      failureType: failureType.type,
      severity: failureType.severity,
      details,
      recentFailures: recentFailures.length,
      threshold: config.failureThreshold
    });

    // Check if circuit should open
    if (circuit.state === 'CLOSED' && recentFailures.length >= config.failureThreshold) {
      this.openCircuit(circuitName);
    } else if (circuit.state === 'HALF_OPEN') {
      // Any failure in half-open state reopens the circuit
      this.openCircuit(circuitName);
    }
  }

  private openCircuit(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    const config = this.getConfig(circuitName);
    
    circuit.state = 'OPEN';
    circuit.nextRetryTime = Date.now() + config.recoveryTimeout;

    logger.error('Circuit breaker opened due to failures', {
      circuitName,
      failureCount: circuit.failureCount,
      failureRate: circuit.failureRate,
      nextRetryTime: new Date(circuit.nextRetryTime).toISOString(),
      recoveryTimeoutMs: config.recoveryTimeout
    });
  }

  private getRecentFailures(circuitName: string): FailureRecord[] {
    const config = this.getConfig(circuitName);
    const cutoffTime = Date.now() - config.windowSizeMs;
    
    return (this.failures.get(circuitName) || [])
      .filter(f => f.timestamp >= cutoffTime);
  }

  private cleanupOldFailures(circuitName: string): void {
    const config = this.getConfig(circuitName);
    const cutoffTime = Date.now() - config.windowSizeMs;
    
    const failures = this.failures.get(circuitName);
    if (failures) {
      const recentFailures = failures.filter(f => f.timestamp >= cutoffTime);
      this.failures.set(circuitName, recentFailures);
    }
  }

  private updateFailureRate(circuitName: string): void {
    const circuit = this.getOrCreateCircuit(circuitName);
    const recentFailures = this.getRecentFailures(circuitName);
    
    // Calculate failure rate over the window
    if (circuit.totalRequests > 0) {
      circuit.failureRate = (recentFailures.length / Math.max(circuit.totalRequests, 10)) * 100;
    }
  }

  private getOrCreateCircuit(circuitName: string): CircuitStats {
    if (!this.circuits.has(circuitName)) {
      this.circuits.set(circuitName, {
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        nextRetryTime: 0,
        totalRequests: 0,
        failureRate: 0
      });
      
      logger.info('Created new circuit breaker', { circuitName });
    }
    
    return this.circuits.get(circuitName)!;
  }

  private getConfig(circuitName: string) {
    // Determine circuit type from name
    if (circuitName.includes('browser') || circuitName.includes('playwright')) {
      return this.circuitConfigs.browser;
    } else if (circuitName.includes('websocket') || circuitName.includes('ws')) {
      return this.circuitConfigs.websocket;
    } else {
      return this.circuitConfigs.system;
    }
  }

  /**
   * Get current state of a circuit
   */
  getCircuitState(circuitName: string): CircuitStats {
    return { ...this.getOrCreateCircuit(circuitName) };
  }

  /**
   * Get all circuit states
   */
  getAllCircuitStates(): Record<string, CircuitStats> {
    const states: Record<string, CircuitStats> = {};
    for (const [name, circuit] of this.circuits) {
      states[name] = { ...circuit };
    }
    return states;
  }

  /**
   * Manually reset a circuit (for admin purposes)
   */
  resetCircuit(circuitName: string): boolean {
    if (this.circuits.has(circuitName)) {
      logger.info('Manually resetting circuit breaker', { circuitName });
      
      const circuit = this.getOrCreateCircuit(circuitName);
      circuit.state = 'CLOSED';
      circuit.failureCount = 0;
      circuit.successCount = 0;
      circuit.failureRate = 0;
      
      this.failures.delete(circuitName);
      return true;
    }
    return false;
  }

  /**
   * Get failure details for debugging
   */
  getFailureHistory(circuitName: string, limit: number = 10): FailureRecord[] {
    const failures = this.failures.get(circuitName) || [];
    return failures.slice(-limit);
  }

  shutdown(): void {
    logger.info('Circuit breaker shutting down', {
      totalCircuits: this.circuits.size
    });
    
    this.circuits.clear();
    this.failures.clear();
  }
}

export const circuitBreaker = CircuitBreaker.getInstance();