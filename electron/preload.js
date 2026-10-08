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
      'auth:register',          // frontend branch: self-registration (pending approval)
      // Users (approval workflow) - frontend branch
      'user:list-pending',
      'user:approve',
      // Patients
      'patient:get-by-id',
      'patient:save-record',    // dev branch (kept, nothing in frontend calls it yet)
      'patient:create',
      'patient:set-photo',      // dev branch
      'patient:import-csv',     // frontend branch (dev uses registration:csv-* instead)
      // Google Sheets sync - dev branch
      'sheet:status',
      'sheet:preview',
      'sheet:sync',
      // Registration import - dev branch
      'registration:fetch-drive-photos',
      'registration:csv-preview',
      'registration:csv-import',
      // Clinical forms - frontend branch (no backend handlers exist for these yet)
      'medication:save-checkin',
      'medshack:save-visit',
      'incident:save-report',
      'staff:save-checkin',
      'crewindemnity:save',
      // Medication & treatment log
      'medlog:get',
      'medlog:add-schedule',
      'medlog:record',
      'medlog:today',
      // Audit
      'audit:log-event',
      'audit:get-entries',
      'audit:verify-chain',     // dev branch
      // Backup
      'backup:list-drives',
      'backup:start'
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