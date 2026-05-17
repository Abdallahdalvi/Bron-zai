/**
 * Structured Logger — JSON logging with levels and rotation
 * Replaces scattered console.log with structured logging
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  minLevel: LogLevel;
  logToFile: boolean;
  logToConsole: boolean;
  maxFileSize: number;  // bytes
  maxFiles: number;
  prettyPrint: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: 'info',
  logToFile: true,
  logToConsole: true,
  maxFileSize: 10 * 1024 * 1024,  // 10MB
  maxFiles: 5,
  prettyPrint: false,
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private config: LoggerConfig = DEFAULT_CONFIG;
  private logDir: string | null = null;
  private currentLogFile: string | null = null;
  private pending: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logDir = path.join(app.getPath('userData'), 'logs');
    await fs.mkdir(this.logDir, { recursive: true });
    
    this.currentLogFile = path.join(this.logDir, 'bron.log');
    this.initialized = true;

    // Start periodic flush
    this.flushInterval = setInterval(() => this.flush(), 5000);

    // Flush on exit
    process.on('beforeExit', () => this.flushSync());
    process.on('SIGINT', () => {
      this.flushSync();
      process.exit(0);
    });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    if (this.config.prettyPrint) {
      return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}` +
        (entry.context ? ` [${entry.context}]` : '') +
        (entry.error ? `\n  Error: ${entry.error.message}` : '');
    }
    return JSON.stringify(entry);
  }

  private async rotateLogIfNeeded(): Promise<void> {
    if (!this.currentLogFile) return;

    try {
      const stats = await fs.stat(this.currentLogFile);
      if (stats.size > this.config.maxFileSize) {
        // Rotate files
        for (let i = this.config.maxFiles - 1; i > 0; i--) {
          const oldPath = path.join(this.logDir!, `bron.log.${i}`);
          const newPath = path.join(this.logDir!, `bron.log.${i + 1}`);
          
          try {
            await fs.rename(oldPath, newPath);
          } catch {
            // File might not exist
          }
        }

        // Move current to .1
        await fs.rename(this.currentLogFile, path.join(this.logDir!, 'bron.log.1'));
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private async flush(): Promise<void> {
    if (!this.initialized || this.pending.length === 0) return;

    const batch = this.pending.splice(0);
    
    if (this.config.logToFile && this.currentLogFile) {
      await this.rotateLogIfNeeded();
      const lines = batch.map(e => this.formatEntry(e)).join('\n') + '\n';
      await fs.appendFile(this.currentLogFile, lines, 'utf-8');
    }

    if (this.config.logToConsole) {
      for (const entry of batch) {
        const formatted = this.formatEntry(entry);
        switch (entry.level) {
          case 'error':
            console.error(formatted);
            break;
          case 'warn':
            console.warn(formatted);
            break;
          case 'debug':
            console.debug(formatted);
            break;
          default:
            console.log(formatted);
        }
      }
    }
  }

  private flushSync(): void {
    if (!this.initialized || this.pending.length === 0) return;

    const batch = this.pending.splice(0);
    const lines = batch.map(e => this.formatEntry(e)).join('\n') + '\n';
    
    try {
      if (this.currentLogFile) {
        fsSync.appendFileSync(this.currentLogFile, lines, 'utf-8');
      }
    } catch (err) {
      console.error('Failed to flush logs:', err);
    }
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };
  }

  log(level: LogLevel, message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry = this.createEntry(level, message, context, metadata, error);
    this.pending.push(entry);

    // Flush immediately for errors
    if (level === 'error') {
      this.flush();
    }
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, context, metadata);
  }

  info(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, context, metadata);
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log('warn', message, context, metadata, error);
  }

  error(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log('error', message, context, metadata, error);
  }

  /** Get recent log entries (for UI display) */
  async getRecentEntries(limit = 100): Promise<LogEntry[]> {
    if (!this.currentLogFile) return [];

    try {
      const content = await fs.readFile(this.currentLogFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      return lines
        .slice(-limit)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as LogEntry[];
    } catch {
      return [];
    }
  }

  /** Clean up resources */
  async dispose(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}

// Singleton instance
export const logger = new Logger();

// Convenience re-exports
export const log = logger.log.bind(logger);
export const logDebug = logger.debug.bind(logger);
export const logInfo = logger.info.bind(logger);
export const logWarn = logger.warn.bind(logger);
export const logError = logger.error.bind(logger);
