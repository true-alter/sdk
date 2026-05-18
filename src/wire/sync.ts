/**
 * Refuse to wire any client whose config sits on a synced volume.
 *
 * Writing MCP config under iCloud / OneDrive / Dropbox / Google Drive
 * silently propagates the same `mcpServers.alter` entry (and API key
 * headers) to every other device the user syncs. That is a consent
 * violation — wire consent is per-device.
 *
 * The check is a prefix match against the resolved absolute path; it
 * is deliberately broader than strictly necessary so that users who
 * symlink their home directory into a synced volume (a known Mac
 * pattern) are also caught.
 */

import { platform } from 'node:os';
import { resolve } from 'node:path';

const SYNC_PREFIXES = [
  // iCloud Drive — both the new and legacy mounts.
  'Library/Mobile Documents/com~apple~CloudDocs',
  'iCloud Drive',
  // OneDrive variants Microsoft ships across editions.
  'OneDrive',
  'OneDrive - ',
  // Dropbox standard + enterprise mounts.
  'Dropbox',
  'Dropbox (',
  // Google Drive (ALTER does not integrate with Google; still refuse).
  'Google Drive',
  'GoogleDrive',
  'CloudStorage/GoogleDrive',
  // Box, pCloud, Sync.com, MEGA — high-signal names worth refusing.
  'Box Sync',
  'pCloud Drive',
  'Sync.com',
  'MEGAsync',
];

export interface SyncedVolumeHit {
  refused: true;
  matchedPrefix: string;
  resolvedPath: string;
}

/**
 * Returns a hit record if the resolved path lives under a known synced
 * volume, null otherwise. Normalises path separators so the check is
 * Windows-safe without hardcoding `\`.
 */
export function detectSyncedVolume(path: string): SyncedVolumeHit | null {
  const absolute = resolve(path);
  // Normalise separators for prefix checking only — we never write this
  // transformed string back to disk.
  const normalised = platform() === 'win32' ? absolute.replace(/\\/g, '/') : absolute;
  for (const prefix of SYNC_PREFIXES) {
    // Look for "/<prefix>/" anywhere in the path so nested mounts catch.
    if (normalised.includes(`/${prefix}/`) || normalised.includes(`/${prefix}`)) {
      return { refused: true, matchedPrefix: prefix, resolvedPath: absolute };
    }
  }
  return null;
}
