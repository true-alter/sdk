/**
 * `wire-state.json` provenance artefact.
 *
 * Written to `$XDG_CONFIG_HOME/alter/wire-state.json` after every wire
 * run. Holds everything `unwire` needs to reverse the operation without
 * guessing, plus enough metadata (SDK version, timestamps, SHAs pre and
 * post) to make the operation auditable.
 *
 * Append-only semantics: a new wire run rewrites this file in full.
 * Prior state is not retained, the backup siblings on disk are the
 * canonical rollback surface, not this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { alterConfigDir, wireStatePath, type ClientId } from './paths.js';

export const WIRE_STATE_VERSION = 1;

export type WireTargetStatus = 'written' | 'already-wired' | 'skipped' | 'failed';

export interface WireTargetFile {
  client: ClientId;
  method: 'file';
  status: WireTargetStatus;
  path: string;
  backupPath: string | null;
  rootKey: string;
  serverName: string;
  preSha256: string | null;
  postSha256: string;
  reason?: string;
}

export interface WireTargetCli {
  client: ClientId;
  method: 'cli';
  status: WireTargetStatus;
  command: string;
  stdout?: string;
  stderr?: string;
  reason?: string;
}

export type WireTarget = WireTargetFile | WireTargetCli;

export interface WireState {
  version: typeof WIRE_STATE_VERSION;
  sdkVersion: string;
  writtenAt: string;
  endpoint: string;
  targets: WireTarget[];
}

export function readWireState(): WireState | null {
  const path = wireStatePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WireState;
    if (parsed.version !== WIRE_STATE_VERSION) {
      throw new Error(
        `wire-state.json version ${String(parsed.version)} is not supported by this SDK (expected ${WIRE_STATE_VERSION})`,
      );
    }
    return parsed;
  } catch (err) {
    throw new Error(`failed to parse wire-state.json: ${(err as Error).message}`);
  }
}

export function writeWireState(state: WireState): void {
  const path = wireStatePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function clearWireState(): void {
  const path = wireStatePath();
  if (!existsSync(path)) return;
  // Writing an empty state rather than unlinking preserves the "we've
  // wired before" audit trail. An explicit `alter-identity status`
  // can then show "last wired, then unwired at <ts>".
  mkdirSync(alterConfigDir(), { recursive: true, mode: 0o700 });
  const empty: WireState = {
    version: WIRE_STATE_VERSION,
    sdkVersion: '',
    writtenAt: new Date().toISOString(),
    endpoint: '',
    targets: [],
  };
  writeFileSync(path, JSON.stringify(empty, null, 2) + '\n', { mode: 0o600 });
}
