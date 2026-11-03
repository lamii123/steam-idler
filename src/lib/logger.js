const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function formatValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level, message, ...meta) {
  if (LEVELS[level] > threshold) return;

  const timestamp = new Date().toISOString();
  const suffix = meta.length ? ` ${meta.map(formatValue).join(' ')}` : '';
  const line = `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  error: (message, ...meta) => write('error', message, ...meta),
  warn: (message, ...meta) => write('warn', message, ...meta),
  info: (message, ...meta) => write('info', message, ...meta),
  debug: (message, ...meta) => write('debug', message, ...meta),
};
