interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    service: string;
    message: string;
    metadata?: Record<string, any>;
  }
  
  export const createLogger = (serviceName: string) => {
    const log = (level: LogEntry['level'], message: string, metadata?: Record<string, any>) => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        service: serviceName,
        message,
        metadata
      };
  
      switch (level) {
        case 'error':
          console.error(JSON.stringify(entry, null, 2));
          break;
        case 'warn':
          console.warn(JSON.stringify(entry, null, 2));
          break;
        case 'debug':
          console.debug(JSON.stringify(entry, null, 2));
          break;
        default:
          console.log(JSON.stringify(entry, null, 2));
      }
    };
  
    return {
      info: (message: string, metadata?: Record<string, any>) => log('info', message, metadata),
      warn: (message: string, metadata?: Record<string, any>) => log('warn', message, metadata),
      error: (message: string, metadata?: Record<string, any>) => log('error', message, metadata),
      debug: (message: string, metadata?: Record<string, any>) => log('debug', message, metadata)
    };
  };
  
  export type Logger = ReturnType<typeof createLogger>;