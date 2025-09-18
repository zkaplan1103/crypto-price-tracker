import { createLogger } from './logger';

const logger = createLogger('memory-monitor');

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryTrend {
  shortTerm: number; // 5 minute trend
  mediumTerm: number; // 15 minute trend
  longTerm: number; // 30 minute trend
}

export interface MemoryStats {
  current: MemorySnapshot;
  trend: MemoryTrend;
  leakDetection: {
    possibleLeak: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    recommendation: string;
  };
  thresholds: {
    heapUsedMB: number;
    heapUsedPercent: number;
    rssMB: number;
  };
}

export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private snapshots: MemorySnapshot[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private gcForced: boolean = false;
  
  // Configuration
  private readonly SNAPSHOT_INTERVAL_MS = 30 * 1000; // 30 seconds
  private readonly MAX_SNAPSHOTS = 120; // Keep 1 hour of data (30s * 120 = 60min)
  private readonly HEAP_WARNING_THRESHOLD_MB = 512; // Warn at 512MB
  private readonly HEAP_CRITICAL_THRESHOLD_MB = 1024; // Critical at 1GB
  private readonly RSS_WARNING_THRESHOLD_MB = 1024; // Warn at 1GB RSS
  private readonly LEAK_DETECTION_GROWTH_THRESHOLD = 1.5; // 50% growth indicates potential leak
  private readonly LEAK_DETECTION_MIN_SAMPLES = 10; // Need at least 10 samples for trend analysis

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  startMonitoring(): void {
    if (this.monitoringInterval) {
      logger.warn('Memory monitoring already started');
      return;
    }

    logger.info('Starting memory monitoring', {
      snapshotIntervalMs: this.SNAPSHOT_INTERVAL_MS,
      maxSnapshots: this.MAX_SNAPSHOTS
    });

    // Take initial snapshot
    this.takeSnapshot();

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.takeSnapshot();
      this.analyzeMemoryHealth();
    }, this.SNAPSHOT_INTERVAL_MS);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Memory monitoring stopped');
    }
  }

  private takeSnapshot(): void {
    const memUsage = process.memoryUsage();
    
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers
    };

    this.snapshots.push(snapshot);

    // Keep only the most recent snapshots
    if (this.snapshots.length > this.MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-this.MAX_SNAPSHOTS);
    }

    logger.debug('Memory snapshot taken', {
      heapUsedMB: Math.round(snapshot.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(snapshot.heapTotal / 1024 / 1024),
      rssMB: Math.round(snapshot.rss / 1024 / 1024)
    });
  }

  private analyzeMemoryHealth(): void {
    if (this.snapshots.length < 2) return;

    const current = this.snapshots[this.snapshots.length - 1];
    const heapUsedMB = current.heapUsed / 1024 / 1024;
    const rssMB = current.rss / 1024 / 1024;

    // Check critical thresholds
    if (heapUsedMB > this.HEAP_CRITICAL_THRESHOLD_MB) {
      logger.error('Critical heap memory usage detected', {
        heapUsedMB: Math.round(heapUsedMB),
        thresholdMB: this.HEAP_CRITICAL_THRESHOLD_MB
      });
    } else if (heapUsedMB > this.HEAP_WARNING_THRESHOLD_MB) {
      logger.warn('High heap memory usage detected', {
        heapUsedMB: Math.round(heapUsedMB),
        thresholdMB: this.HEAP_WARNING_THRESHOLD_MB
      });
    }

    if (rssMB > this.RSS_WARNING_THRESHOLD_MB) {
      logger.warn('High RSS memory usage detected', {
        rssMB: Math.round(rssMB),
        thresholdMB: this.RSS_WARNING_THRESHOLD_MB
      });
    }

    // Analyze trends for potential leaks
    const leakAnalysis = this.detectMemoryLeaks();
    if (leakAnalysis.possibleLeak && leakAnalysis.severity === 'critical') {
      logger.error('Potential memory leak detected', {
        severity: leakAnalysis.severity,
        reason: leakAnalysis.reason,
        recommendation: leakAnalysis.recommendation
      });
    } else if (leakAnalysis.possibleLeak) {
      logger.warn('Potential memory issue detected', {
        severity: leakAnalysis.severity,
        reason: leakAnalysis.reason
      });
    }
  }

  private calculateTrend(minutes: number): number {
    if (this.snapshots.length < 2) return 0;

    const timeWindowMs = minutes * 60 * 1000;
    const cutoffTime = Date.now() - timeWindowMs;
    
    const recentSnapshots = this.snapshots.filter(s => s.timestamp >= cutoffTime);
    
    if (recentSnapshots.length < 2) return 0;

    const oldest = recentSnapshots[0];
    const newest = recentSnapshots[recentSnapshots.length - 1];
    
    return ((newest.heapUsed - oldest.heapUsed) / oldest.heapUsed) * 100;
  }

  private detectMemoryLeaks() {
    if (this.snapshots.length < this.LEAK_DETECTION_MIN_SAMPLES) {
      return {
        possibleLeak: false,
        severity: 'low' as const,
        reason: 'Insufficient data for leak detection',
        recommendation: 'Continue monitoring'
      };
    }

    const shortTermTrend = this.calculateTrend(5);
    const mediumTermTrend = this.calculateTrend(15);
    const longTermTrend = this.calculateTrend(30);

    const current = this.snapshots[this.snapshots.length - 1];
    const heapUsedMB = current.heapUsed / 1024 / 1024;

    // Check for consistent growth pattern (potential leak)
    const consistentGrowth = shortTermTrend > 0 && mediumTermTrend > 0 && longTermTrend > 0;
    const significantGrowth = longTermTrend > (this.LEAK_DETECTION_GROWTH_THRESHOLD - 1) * 100;

    if (consistentGrowth && significantGrowth) {
      if (heapUsedMB > this.HEAP_CRITICAL_THRESHOLD_MB) {
        return {
          possibleLeak: true,
          severity: 'critical' as const,
          reason: `Consistent memory growth of ${longTermTrend.toFixed(1)}% over 30 minutes with high usage`,
          recommendation: 'Immediate investigation required - consider heap dump and restart'
        };
      } else if (longTermTrend > 100) {
        return {
          possibleLeak: true,
          severity: 'high' as const,
          reason: `Rapid memory growth of ${longTermTrend.toFixed(1)}% over 30 minutes`,
          recommendation: 'Investigate potential memory leaks in recent operations'
        };
      } else {
        return {
          possibleLeak: true,
          severity: 'medium' as const,
          reason: `Steady memory growth of ${longTermTrend.toFixed(1)}% over 30 minutes`,
          recommendation: 'Monitor closely and check for resource cleanup issues'
        };
      }
    }

    // Check for sudden spikes
    if (shortTermTrend > 50) {
      return {
        possibleLeak: true,
        severity: 'medium' as const,
        reason: `Sudden memory increase of ${shortTermTrend.toFixed(1)}% in 5 minutes`,
        recommendation: 'Check recent operations for memory-intensive tasks'
      };
    }

    return {
      possibleLeak: false,
      severity: 'low' as const,
      reason: 'Memory usage appears stable',
      recommendation: 'Continue normal monitoring'
    };
  }

  getMemoryStats(): MemoryStats {
    const current = this.snapshots.length > 0 
      ? this.snapshots[this.snapshots.length - 1]
      : {
          timestamp: Date.now(),
          heapUsed: 0,
          heapTotal: 0,
          rss: 0,
          external: 0,
          arrayBuffers: 0
        };

    return {
      current,
      trend: {
        shortTerm: this.calculateTrend(5),
        mediumTerm: this.calculateTrend(15),
        longTerm: this.calculateTrend(30)
      },
      leakDetection: this.detectMemoryLeaks(),
      thresholds: {
        heapUsedMB: Math.round(current.heapUsed / 1024 / 1024),
        heapUsedPercent: current.heapTotal > 0 ? Math.round((current.heapUsed / current.heapTotal) * 100) : 0,
        rssMB: Math.round(current.rss / 1024 / 1024)
      }
    };
  }

  // Manual memory cleanup utilities
  async forceGarbageCollection(): Promise<boolean> {
    if (this.gcForced) {
      logger.warn('Garbage collection already forced recently, skipping');
      return false;
    }

    try {
      // Only available in Node.js with --expose-gc flag
      if (global.gc) {
        logger.info('Forcing garbage collection');
        global.gc();
        this.gcForced = true;
        
        // Reset flag after 1 minute
        setTimeout(() => {
          this.gcForced = false;
        }, 60000);
        
        return true;
      } else {
        logger.warn('Garbage collection not available (requires --expose-gc flag)');
        return false;
      }
    } catch (error) {
      logger.error('Failed to force garbage collection', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  getRecentTrends(minutes: number = 30): MemorySnapshot[] {
    const timeWindowMs = minutes * 60 * 1000;
    const cutoffTime = Date.now() - timeWindowMs;
    
    return this.snapshots.filter(s => s.timestamp >= cutoffTime);
  }

  shutdown(): void {
    this.stopMonitoring();
    this.snapshots = [];
    logger.info('Memory monitor shutdown completed');
  }
}

export const memoryMonitor = MemoryMonitor.getInstance();