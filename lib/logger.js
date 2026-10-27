'use strict';

/**
 * Structured logger for the file browser.
 * Provides level-based logging with consistent formatting.
 * Log levels: debug, info, warn, error
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function timestamp() {
    return new Date().toISOString();
}

function safeStringify(obj) {
    try {
        return JSON.stringify(obj);
    } catch {
        // Circular or otherwise non-serializable object
        try {
            const seen = new WeakSet();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return '[Circular]';
                    seen.add(value);
                }
                return value;
            });
        } catch {
            return String(obj);
        }
    }
}

function formatMessage(level, msg, meta) {
    const base = `[${timestamp()}] [${level.toUpperCase()}] ${msg}`;
    if (meta) {
        return `${base} ${typeof meta === 'object' ? safeStringify(meta) : meta}`;
    }
    return base;
}

const logger = {
    debug(msg, meta) {
        if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
            console.debug(formatMessage('debug', msg, meta));
        }
    },
    info(msg, meta) {
        if (CURRENT_LEVEL <= LOG_LEVELS.info) {
            console.log(formatMessage('info', msg, meta));
        }
    },
    warn(msg, meta) {
        if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
            console.warn(formatMessage('warn', msg, meta));
        }
    },
    error(msg, meta) {
        if (CURRENT_LEVEL <= LOG_LEVELS.error) {
            console.error(formatMessage('error', msg, meta));
        }
    }
};

module.exports = logger;
