/**
 * Lightweight frontend logger.
 * Wraps console with level prefixes and a debug toggle.
 * Log levels: debug, info, warn, error
 */

window.logger = (function() {
    const DEBUG_ENABLED = localStorage.getItem('debug') === 'true';

    function timestamp() {
        return new Date().toISOString();
    }

    return {
        debug(msg, ...args) {
            if (DEBUG_ENABLED) {
                console.debug(`[${timestamp()}] [DEBUG] ${msg}`, ...args);
            }
        },
        info(msg, ...args) {
            console.info(`[${timestamp()}] [INFO] ${msg}`, ...args);
        },
        warn(msg, ...args) {
            console.warn(`[${timestamp()}] [WARN] ${msg}`, ...args);
        },
        error(msg, ...args) {
            console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
        }
    };
})();
