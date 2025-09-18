import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { expressConnectMiddleware } from '@connectrpc/connect-express';
import { cryptoStreamRouter } from './services/crypto-stream-service';
import { wsManager } from './services/websocket-manager';
import { createLogger } from './utils/logger';
import { systemMonitor } from './utils/system-monitor';
import { memoryMonitor } from './utils/memory-monitor';
import { circuitBreaker } from './utils/circuit-breaker';

const logger = createLogger('server');
const app: Express = express();
const server = createServer(app);
const PORT = process.env.PORT || 8080;


app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));


app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent') || 'unknown'
    });
  });
  next();
});


app.use(expressConnectMiddleware({
  routes: cryptoStreamRouter
}));

// Enhanced health check with system monitoring
app.get('/health', (req, res) => {
  try {
    const healthData = systemMonitor.getSystemHealth();
    
    // Set appropriate HTTP status based on health
    const statusCode = healthData.status === 'healthy' ? 200 
                      : healthData.status === 'degraded' ? 200 
                      : 503;
    
    res.status(statusCode).json(healthData);
  } catch (error) {
    logger.error('Health check failed', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check system failure',
      version: '1.0.0'
    });
  }
});

// Lightweight health check for load balancers
app.get('/health/ping', (req, res) => {
  res.status(200).send('OK');
});

// Performance metrics endpoint
app.get('/metrics', (req, res) => {
  try {
    const metrics = systemMonitor.getPerformanceMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Metrics collection failed', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Metrics collection failed' });
  }
});

// Memory monitoring endpoint
app.get('/metrics/memory', (req, res) => {
  try {
    const memoryStats = memoryMonitor.getMemoryStats();
    res.json(memoryStats);
  } catch (error) {
    logger.error('Memory metrics collection failed', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Memory metrics collection failed' });
  }
});

// Circuit breaker status endpoint
app.get('/metrics/circuits', (req, res) => {
  try {
    const circuits = circuitBreaker.getAllCircuitStates();
    res.json(circuits);
  } catch (error) {
    logger.error('Failed to get circuit breaker states', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Failed to get circuit breaker states' });
  }
});

// Force garbage collection endpoint (for debugging)
app.post('/admin/gc', async (req, res) => {
  try {
    const forced = await memoryMonitor.forceGarbageCollection();
    res.json({ 
      success: forced,
      message: forced ? 'Garbage collection forced' : 'Garbage collection not available'
    });
  } catch (error) {
    logger.error('Failed to force garbage collection', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Failed to force garbage collection' });
  }
});

// Reset circuit breaker endpoint (for debugging)
app.post('/admin/circuits/:circuitName/reset', (req, res) => {
  try {
    const { circuitName } = req.params;
    const reset = circuitBreaker.resetCircuit(circuitName);
    res.json({ 
      success: reset,
      message: reset ? `Circuit ${circuitName} reset` : `Circuit ${circuitName} not found`
    });
  } catch (error) {
    logger.error('Failed to reset circuit breaker', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Failed to reset circuit breaker' });
  }
});

// Performance stats endpoint
app.get('/metrics/performance', (req, res) => {
  try {
    const enhanced = systemMonitor.getPerformanceMetrics();
    res.json({
      ...enhanced,
      observability: {
        monitoring: 'enabled',
        memoryLeakDetection: 'active',
        circuitBreakerProtection: 'active',
        rateLimiting: 'active',
        performanceProfiling: 'basic',
      }
    });
  } catch (error) {
    logger.error('Failed to get performance stats', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    res.status(500).json({ error: 'Failed to get performance stats' });
  }
});

// 404 
app.use((req, res) => {
  logger.warn('Route not found', { 
    method: req.method, 
    url: req.url,
    ip: req.ip
  });
  res.status(404).json({ error: 'Not found' });
});

// global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url
  });
  res.status(500).json({ error: 'Internal server error' });
});

wsManager.initialize(server);

// Start memory monitoring
memoryMonitor.startMonitoring();

server.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    websocketPath: '/ws',
    memoryMonitoring: 'enabled'
  });
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down server');
  wsManager.shutdown();
  memoryMonitor.shutdown();
  circuitBreaker.shutdown();
});

export { app, server };
