const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC communication methods to the React renderer thread
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Invoke main process IPC channel asynchronously
   * @param {string} channel
   * @param {any} data
   */
  invoke: (channel, data) => {
    const validChannels = [
      // Auth
      'auth:login',
      'auth:register',
      // Users (approval workflow)
      'user:list-pending',
      'user:approve',
      // Patients
      'patient:get-by-id',
      'patient:create',
      'patient:import-csv',
      // Clinical forms
      'medication:save-checkin',
      'medshack:save-visit',
      'incident:save-report',
      'staff:save-checkin',
      // Audit
      'audit:log-event',
      'audit:get-entries',
      // Backup
      'backup:list-drives',
      'backup:start',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
  },

  /**
   * Listen for events emitted by the main process
   * @param {string} channel
   * @param {Function} func
   */
  on: (channel, func) => {
    const validChannels = ['sync:status', 'network:status-change'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});