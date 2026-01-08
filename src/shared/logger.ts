/**
 * Logger module for danger-transcode
 * Provides consistent logging with timestamps and log levels
 * Shared across all modules
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // Gray
  info: '\x1b[36m', // Cyan
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';

export interface LoggerOptions {
  level?: LogLevel;
  useColors?: boolean;
  prefix?: string;
}

export class Logger {
  private level: LogLevel;
  private useColors: boolean;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.useColors = options.useColors ?? Deno.stdout.isTerminal();
    this.prefix = options.prefix ?? '';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').replace('Z', '');
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.formatTimestamp();
    const levelStr = level.toUpperCase().padEnd(5);
    const prefix = this.prefix ? `[${this.prefix}] ` : '';

    if (this.useColors) {
      const color = LOG_LEVEL_COLORS[level];
      return `${color}[${timestamp}] ${levelStr}${RESET_COLOR} ${prefix}${message}`;
    }

    return `[${timestamp}] ${levelStr} ${prefix}${message}`;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message);
    const output = level === 'error' ? console.error : console.log;

    if (args.length > 0) {
      output(formattedMessage, ...args);
    } else {
      output(formattedMessage);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  /** Create a child logger with a prefix */
  child(prefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({
      level: this.level,
      useColors: this.useColors,
      prefix: newPrefix,
    });
  }

  /** Set the log level */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Get the current log level */
  getLevel(): LogLevel {
    return this.level;
  }

  /** Log a progress message (always shown, regardless of level) */
  progress(current: number, total: number, message: string): void {
    const percent = Math.round((current / total) * 100);
    const bar = this.createProgressBar(percent);
    const formattedMessage = `${bar} ${percent}% (${current}/${total}) ${message}`;

    if (this.useColors) {
      // Clear line and write progress
      Deno.stdout.writeSync(new TextEncoder().encode(`\r\x1b[K${formattedMessage}`));
    } else {
      console.log(formattedMessage);
    }
  }

  /** End progress line */
  progressEnd(): void {
    if (this.useColors) {
      Deno.stdout.writeSync(new TextEncoder().encode('\n'));
    }
  }

  private createProgressBar(percent: number): string {
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

