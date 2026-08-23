/**
 * Higher-order function to safely handle IPC invocations.
 * Catches unhandled runtime/DB errors, prevents crashes, and logs to security_log.
 */

function handleIpcSafely(ipcMain, channel, getDbInstance, handlerFn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handlerFn(event, ...args);
    } catch (error) {
      console.error(`[IPC Error on channel "${channel}"]:`, error);

      // Log failure to security_log
      try {
        const db = getDbInstance();
        if (db) {
          db.prepare(`
            INSERT INTO security_log (username_attempted, reason)
            VALUES (?, ?)
          `).run('SYSTEM_IPC', `Error in ${channel}: ${error.message}`);
        }
      } catch (logErr) {
        console.error('[ErrorHandler Log Failure]:', logErr.message);
      }

      return {
        success: false,
        error: error.message || 'An unexpected offline database error occurred.',
      };
    }
  });
}

module.exports = { handleIpcSafely };