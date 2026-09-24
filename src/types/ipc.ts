export enum IPC_CHANNELS {
  AUTH_LOGIN = 'auth:login',
  PATIENT_GET_BY_ID = 'patient:get-by-id',
  PATIENT_SAVE = 'patient:save-record',
  AUDIT_LOG_EVENT = 'audit:log-event',
  AUDIT_GET_ENTRIES = 'audit:get-entries',
  AUDIT_VERIFY_CHAIN = 'audit:verify-chain',
  BACKUP_LIST_DRIVES = 'backup:list-drives',
  BACKUP_START = 'backup:start',
  CSV_IMPORT_CAMPERS = 'csv:import-campers',
  SESSION_LOCK = 'session:lock'
}
