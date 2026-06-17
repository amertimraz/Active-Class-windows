'use strict';
/**
 * Minimal leveled logger for the Node side (server + Electron main).
 *
 * Phase 0 goal: stop swallowing errors silently. Logs go to the console AND
 * to a rotating-ish daily file under <dataDir>/logs so problems are visible
 * after the fact instead of vanishing into empty catch blocks.
 *
 * Usage:
 *   const log = require('./logger').create('server');
 *   log.info('started'); log.error('failed', err);
 */
const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[envLevel] != null ? LEVELS[envLevel] : LEVELS.info;

const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
const logsDir = path.join(dataDir, 'logs');

let stream = null;
function getStream() {
  if (stream) return stream;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const file = path.join(logsDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    stream = fs.createWriteStream(file, { flags: 'a' });
  } catch {
    stream = null; // file logging is best-effort; never crash the app over a log
  }
  return stream;
}

function fmtArg(a) {
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

function write(scope, level, args) {
  if (LEVELS[level] > threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${args
    .map(fmtArg)
    .join(' ')}`;
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(line);
  const s = getStream();
  if (s) {
    try {
      s.write(line + '\n');
    } catch {
      /* best-effort */
    }
  }
}

function create(scope = 'app') {
  return {
    error: (...a) => write(scope, 'error', a),
    warn: (...a) => write(scope, 'warn', a),
    info: (...a) => write(scope, 'info', a),
    debug: (...a) => write(scope, 'debug', a),
  };
}

module.exports = { create, logsDir };
