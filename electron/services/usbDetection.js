// electron/services/usbDetection.js
//
// Cross-platform removable-drive detection for the "Backup to USB" feature
// (FR-08). The tech spec calls out Windows `wmic` specifically (the Camp
// Physician's laptop is Windows), but `wmic` is deprecated/removed on newer
// Windows builds, so this uses PowerShell's Get-Volume/Get-Volume+CIM
// instead, with best-effort fallbacks for macOS/Linux dev machines so the
// feature is at least testable off-Windows.
//
// Runs entirely in the Electron MAIN process — never expose child_process
// to the renderer directly.

const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

/**
 * @typedef {{ driveLetter: string, label: string, freeSpaceGb: number }} UsbDrive
 */

async function listUsbDrivesWindows() {
  // Get-Volume reports DriveType for each volume; 'Removable' is what USB
  // flash drives report as. CSV output over PowerShell's own JSON cmdlet
  // for portability across PowerShell 5.1/7.
  const psScript = `
    Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } |
    ForEach-Object {
      [PSCustomObject]@{
        DriveLetter = $_.DriveLetter
        Label       = $_.FileSystemLabel
        FreeGb      = [math]::Round($_.SizeRemaining / 1GB, 2)
      }
    } | ConvertTo-Json -Compress
  `;

  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    timeout: 10000,
  });

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  // ConvertTo-Json returns a single object (not an array) when there's
  // exactly one result, so normalise both shapes.
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((row) => ({
    driveLetter: `${row.DriveLetter}:\\`,
    label: row.Label || 'Removable Disk',
    freeSpaceGb: row.FreeGb ?? 0,
  }));
}

async function listUsbDrivesMac() {
  // diskutil list -plist is the reliable machine-readable form; falls back
  // to nothing found rather than throwing if diskutil isn't available.
  const { stdout } = await execFileAsync('df', ['-g'], { timeout: 10000 });
  const lines = stdout.trim().split('\n').slice(1);

  return lines
    .filter((line) => line.includes('/Volumes/'))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const mountPoint = parts.slice(8).join(' ') || parts[parts.length - 1];
      const availableGb = Number(parts[3]) || 0;
      return {
        driveLetter: mountPoint,
        label: mountPoint.split('/Volumes/')[1] || mountPoint,
        freeSpaceGb: Math.round(availableGb * 10) / 10,
      };
    });
}

async function listUsbDrivesLinux() {
  // lsblk with removable flag is the most reliable signal on Linux.
  const { stdout } = await execFileAsync(
    'lsblk',
    ['-J', '-o', 'NAME,MOUNTPOINT,RM,SIZE,LABEL,FSAVAIL'],
    { timeout: 10000 }
  );
  const { blockdevices } = JSON.parse(stdout);

  const drives = [];
  const walk = (devices) => {
    for (const dev of devices || []) {
      if (dev.rm === true || dev.rm === '1') {
        if (dev.mountpoint) {
          drives.push({
            driveLetter: dev.mountpoint,
            label: dev.label || dev.name,
            freeSpaceGb: dev.fsavail ? parseFloat(dev.fsavail) : 0,
          });
        }
      }
      if (dev.children) walk(dev.children);
    }
  };
  walk(blockdevices);
  return drives;
}

/**
 * Detects connected removable/USB drives for the current OS.
 * Returns an empty array (never throws to the caller) if detection isn't
 * possible on this platform/environment — the UI already handles "no
 * drives detected" as a normal state.
 *
 * @returns {Promise<UsbDrive[]>}
 */
async function listUsbDrives() {
  try {
    if (process.platform === 'win32') return await listUsbDrivesWindows();
    if (process.platform === 'darwin') return await listUsbDrivesMac();
    if (process.platform === 'linux') return await listUsbDrivesLinux();
    return [];
  } catch (error) {
    console.error('[USB Detection] Failed to enumerate drives:', error.message);
    return [];
  }
}

module.exports = { listUsbDrives };
