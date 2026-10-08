export enum IPC_CHANNELS {
  AUTH_LOGIN = 'auth:login',
  PATIENT_GET_BY_ID = 'patient:get-by-id',
  PATIENT_SAVE = 'patient:save-record',
  PATIENT_CREATE = 'patient:create',
  PATIENT_SET_PHOTO = 'patient:set-photo',
  AUDIT_LOG_EVENT = 'audit:log-event',
  AUDIT_GET_ENTRIES = 'audit:get-entries',
  AUDIT_VERIFY_CHAIN = 'audit:verify-chain',
  BACKUP_LIST_DRIVES = 'backup:list-drives',
  BACKUP_START = 'backup:start',
  SHEET_SYNC_STATUS = 'sheet:status',
  SHEET_SYNC_PREVIEW = 'sheet:preview',
  SHEET_SYNC = 'sheet:sync',
  REGISTRATION_FETCH_DRIVE_PHOTOS = 'registration:fetch-drive-photos',
  REGISTRATION_CSV_PREVIEW = 'registration:csv-preview',
  REGISTRATION_CSV_IMPORT = 'registration:csv-import',
  SESSION_LOCK = 'session:lock'
}
