import { createLogger } from './logger';
import { browserManager } from '../services/browser-manager';
import { wsManager } from '../services/websocket-manager';
import { rateLimiter } from './rate-limiter';
import { memoryMonitor } from './memory-monitor';
import * as os from 'os';

const logger = createLogger('system-monitor');

export interface SystemHealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
    heapUsed: number;
    heapTotal: number;
  };
  cpu: {
    loadAverage: number[];
  };
  services: {
    websocket: {
      status: 'healthy' | 'unhealthy';
      activeConnections: number;
      totalSubscriptions: number;
    };
    browserManager: {
      status: 'healthy' | 'unhealthy';
      activeBrowsers: number;
      totalPages: number;
      scheduledCleanups: number;
    };
    rateLimiter: {
      status: 'healthy' | 'unhealthy';
      activeClients: number;
      totalCurrentSubscriptions: number;
      config: {
        maxSubscriptionsPerClient: number;
        maxAttemptsPerMinute: number;
      };
    };
  };
  version: string;
}

export class SystemMonitor {
  private static instance: SystemMonitor;
  private startTime: number = Date.now();

  static getInstance(): SystemMonitor {
    if (!SystemMonitor.instance) {
      SystemMonitor.instance = new SystemMonitor();
    }
    return SystemMonitor.instance;
  }

  getSystemHealth(): SystemHealthData {
    const memUsage = process.memoryUsage();
    const totalMem = this.getTotalSystemMemory();
    const memPercentage = (memUsage.rss / totalMem) * 100;
    
    const wsStats = wsManager.getStats();
    const browserStats = browserManager.getBrowserStats();
    const rateLimiterStats = rateLimiter.getStats();
    const memoryStats = memoryMonitor.getMemoryStats();

    // Determine overall health status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Health checks
    if (memPercentage > 80 || memoryStats.leakDetection.possibleLeak) {
      overallStatus = 'degraded';
      logger.warn('High memory usage or potential leak detected', { 
        memPercentage,
        memoryLeakSeverity: memoryStats.leakDetection.severity,
        memoryLeakReason: memoryStats.leakDetection.reason
      });
    }
    
    if (memPercentage > 90 || browserStats.browserInstances > 10 || memoryStats.leakDetection.severity === 'critical') {
      overallStatus = 'unhealthy';
      logger.error('System resources critically high', { 
        memPercentage, 
        browserInstances: browserStats.browserInstances,
        memoryLeakSeverity: memoryStats.leakDetection.severity
      });
    }

    const healthData: SystemHealthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      memory: {
        used: memUsage.rss,
        total: totalMem,
        percentage: memPercentage,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      cpu: {
        loadAverage: this.getLoadAverage(),
      },
      services: {
        websocket: {
          status: wsStats.clients >= 0 ? 'healthy' : 'unhealthy',
          activeConnections: wsStats.clients,
          totalSubscriptions: wsStats.subscriptions,
        },
        browserManager: {
          status: browserStats.browserInstances < 5 ? 'healthy' : 'unhealthy',
          activeBrowsers: browserStats.browserInstances,
          totalPages: browserStats.totalPages,
          scheduledCleanups: browserStats.scheduledCleanups,
        },
        rateLimiter: {
          status: rateLimiterStats.activeClients < 100 ? 'healthy' : 'unhealthy',
          activeClients: rateLimiterStats.activeClients,
          totalCurrentSubscriptions: rateLimiterStats.totalCurrentSubscriptions,
          config: {
            maxSubscriptionsPerClient: rateLimiterStats.rateLimitConfig.maxSubscriptionsPerClient,
            maxAttemptsPerMinute: rateLimiterStats.rateLimitConfig.maxAttemptsPerMinute,
          },
        },
      },
      version: '1.0.0',
    };

    if (overallStatus !== 'healthy') {
      logger.info('System health check completed', {
        status: overallStatus,
        memoryPercentage: memPercentage,
        browserInstances: browserStats.browserInstances,
        wsConnections: wsStats.clients
      });
    }

    return healthData;
  }

  private getTotalSystemMemory(): number {
    // Fallback to a reasonable default if not available
    try {
      return os.totalmem();
    } catch (error) {
      logger.warn('Could not get system memory, using fallback', { error: error instanceof Error ? error.message : 'Unknown error' });
      return 8 * 1024 * 1024 * 1024; // 8GB fallback
    }
  }

  private getLoadAverage(): number[] {
    try {
      return os.loadavg();
    } catch (error) {
      logger.warn('Could not get load average, using fallback', { error: error instanceof Error ? error.message : 'Unknown error' });
      return [0, 0, 0]; // Fallback values
    }
  }

  // Performance monitoring methods
  getPerformanceMetrics() {
    const healthData = this.getSystemHealth();
    const memoryStats = memoryMonitor.getMemoryStats();
    const rateLimiterStats = rateLimiter.getStats();
    
    return {
      timestamp: healthData.timestamp,
      memory: {
        usedMB: Math.round(healthData.memory.used / 1024 / 1024),
        percentage: Math.round(healthData.memory.percentage * 100) / 100,
        heapUsedMB: Math.round(healthData.memory.heapUsed / 1024 / 1024),
        trends: memoryStats.trend,
        leakDetection: memoryStats.leakDetection.severity,
      },
      cpu: {
        loadAverage: healthData.cpu.loadAverage,
        processUsage: process.cpuUsage(),
      },
      services: {
        activeConnections: healthData.services.websocket.activeConnections,
        activeBrowsers: healthData.services.browserManager.activeBrowsers,
        totalPages: healthData.services.browserManager.totalPages,
        rateLimiting: {
          activeClients: rateLimiterStats.activeClients,
          totalSubscriptions: rateLimiterStats.totalCurrentSubscriptions,
        },
      },
      performance: {
        uptime: Math.round(healthData.uptime / 1000),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  // Performance profiling for specific operations
  createPerformanceTimer(operation: string) {
    const start = process.hrtime.bigint();
    
    return {
      end: () => {
        const end = process.hrtime.bigint();
        const durationNs = end - start;
        const durationMs = Number(durationNs) / 1_000_000;
        
        logger.info('Performance timing', {
          operation,
          durationMs: Math.round(durationMs * 100) / 100,
          durationNs: Number(durationNs)
        });
        
        return durationMs;
      }
    };
  }
}

export const systemMonitor = SystemMonitor.getInstance();