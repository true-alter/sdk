/**
 * Atomic JSON write with backup siblings.
 *
 *   1. Read existing file bytes (if any) → sha256 → `pre`
 *   2. Parse JSON (tolerate empty file + JSON-with-comments when absent)
 *   3. Apply caller's merge function
 *   4. Write `<path>.alter-tmp-<ts>` with the merged content
 *   5. If original existed, copy it to `<path>.alter-backup-<ts>`
 *      before replacing
 *   6. Atomically rename `<path>.alter-tmp-<ts>` over `<path>`
 *   7. Compute sha256 of the written content → `post`
 *
 * Windows note: `fs.renameSync` across an existing file used to fail
 * on older Node builds; modern Node (≥ 16) handles this correctly on
 * NTFS, so no special-case is needed. We still keep all operations
 * synchronous, the CLI path is strictly sequential and the tiny
 * blocking cost buys determinism.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export interface WriteResult {
  /** The file we replaced (absolute, as given). */
  path: string;
  /** Backup sibling, or null if the target did not exist before. */
  backupPath: string | null;
  /** SHA-256 of the pre-existing content (or null if the file did not exist). */
  preSha256: string | null;
  /** SHA-256 of the content we wrote. */
  postSha256: string;
  /** true when pre === post, i.e. the merge was a no-op. */
  noop: boolean;
}

export interface AtomicMergeOptions {
  path: string;
  /** Timestamp to thread into tmp/backup filenames. Passed in so a single wire run uses one ts. */
  timestamp: string;
  /** Merge callback: receives the parsed existing object (or {} if absent). Must return the full new object. */
  merge: (existing: Record<string, unknown>) => Record<string, unknown>;
  /**
   * If true and the merge produces the same bytes as the existing file,
   * skip the write entirely and return `{ noop: true, backupPath: null }`.
   */
  idempotent?: boolean;
}

export function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function atomicJsonMerge(opts: AtomicMergeOptions): WriteResult {
  const { path, timestamp, merge, idempotent = true } = opts;
  const tmpPath = `${path}.alter-tmp-${timestamp}`;
  const backupPath = `${path}.alter-backup-${timestamp}`;

  let existed = false;
  let preBytes: string | null = null;
  let parsed: Record<string, unknown> = {};

  if (existsSync(path)) {
    existed = true;
    preBytes = readFileSync(path, 'utf8');
    if (preBytes.trim().length > 0) {
      try {
        parsed = JSON.parse(preBytes) as Record<string, unknown>;
      } catch (err) {
        throw new Error(
          `refusing to wire ${path}: existing file is not valid JSON (${(err as Error).message}). ` +
            'Hand-fix the file, then re-run `alter-identity wire`.',
        );
      }
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error(`refusing to wire ${path}: existing JSON root is not an object`);
      }
    }
  }

  const merged = merge(parsed);
  const serialised = JSON.stringify(merged, null, 2) + '\n';

  if (idempotent && preBytes !== null && preBytes === serialised) {
    return {
      path,
      backupPath: null,
      preSha256: sha256(preBytes),
      postSha256: sha256(preBytes),
      noop: true,
    };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmpPath, serialised, { mode: 0o600 });

  try {
    if (existed) copyFileSync(path, backupPath);
    renameSync(tmpPath, path);
  } catch (err) {
    // Clean up the tmp file on failure so re-runs don't accumulate cruft.
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }

  return {
    path,
    backupPath: existed ? backupPath : null,
    preSha256: preBytes === null ? null : sha256(preBytes),
    postSha256: sha256(serialised),
    noop: false,
  };
}

/**
 * Restore a target from its backup sibling. If `backupPath` is null
 * the target was created by our write step, in that case we unlink
 * the file to restore the original "did not exist" state.
 */
export function restoreFromBackup(path: string, backupPath: string | null): void {
  if (backupPath === null) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  if (!existsSync(backupPath)) {
    throw new Error(`cannot restore ${path}: backup missing at ${backupPath}`);
  }
  renameSync(backupPath, path);
}
