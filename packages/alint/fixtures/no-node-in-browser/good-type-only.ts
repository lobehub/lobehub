// Fixture: a client helper that only needs a Node-side type.
import type { ChildProcess } from 'node:child_process';

import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';

export type ProcessHandle = Pick<ChildProcess, 'pid'>;

export const needsDevice = (type: string) => !isRemoteHeterogeneousType(type);
