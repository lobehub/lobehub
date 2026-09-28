import os from 'node:os';
import path from 'node:path';

import { FileSnapshotStore, type ISnapshotStore } from '@lobechat/agent-tracing';

import { resolveCliDirName } from '../constants/identity';

/**
 * Leaf directory holding locally recorded execution traces. Sits next to
 * `settings.json` / `credentials.json` under the CLI home rather than under the
 * user's cwd: an agent run's trace belongs to the machine, not to whichever
 * repository happened to be the working directory when it was spawned.
 */
const TRACES_DIR_NAME = 'traces';

/**
 * `~/.lobehub/traces` — or the `LOBEHUB_CLI_HOME` override, so a dev build
 * (`LOBEHUB_CLI_HOME=.lobehub-dev`) keeps its traces out of the real ones.
 */
export const resolveTraceRoot = (): string => path.join(os.homedir(), resolveCliDirName());

/** Absolute path of the directory the snapshots actually live in. */
export const resolveTraceDir = (): string => path.join(resolveTraceRoot(), TRACES_DIR_NAME);

/**
 * Snapshot store for locally executed agent runs.
 *
 * Layout (owned by `FileSnapshotStore`):
 *
 *   ~/.lobehub/traces/
 *     2026-08-30T…_op_abc123def.json   completed runs
 *     _partial/op_abc….json            in-progress, or left behind by a crash
 *     latest.json                      symlink to the newest completed run
 */
export const createLocalTraceStore = (): ISnapshotStore =>
  new FileSnapshotStore(resolveTraceRoot(), TRACES_DIR_NAME);

/** Options that point `loadSnapshot` at the store above. */
export const localTraceStoreOptions = () => ({
  dirName: TRACES_DIR_NAME,
  rootDir: resolveTraceRoot(),
});
