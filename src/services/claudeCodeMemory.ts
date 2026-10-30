import type {
  DeviceClaudeCodeMemoryRunEnv,
  DeviceListClaudeCodeMemoryResult,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Claude Code auto-memory chokepoint. A bound device answers over the
 * `device.listClaudeCodeMemory` RPC; the local desktop scans over Electron IPC.
 * (Parallels `projectSkillService`.)
 */
class ClaudeCodeMemoryService {
  /** Memory files under `~/.claude/projects/<project key>/memory` for `workingDirectory`. */
  async listMemory({
    agentId,
    deviceId,
    env,
    workingDirectory,
  }: {
    agentId?: string;
    deviceId?: string;
    /**
     * The agent's own Claude Code env, for the local scan. A bound device gets
     * it from `agentId` on the server instead, which owns the approved roots.
     */
    env?: DeviceClaudeCodeMemoryRunEnv;
    workingDirectory: string;
  }): Promise<DeviceListClaudeCodeMemoryResult | null> {
    return deviceId
      ? lambdaClient.device.listClaudeCodeMemory.query({ agentId, deviceId, workingDirectory })
      : ensureElectronIpc().workspace.listClaudeCodeMemory({ env, scope: workingDirectory });
  }
}

export const claudeCodeMemoryService = new ClaudeCodeMemoryService();
