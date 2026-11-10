import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { claudeCodeMemoryService } from '@/services/claudeCodeMemory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

type MemoryEnvKey = 'CLAUDE_CODE_PROJECT_DIR_NAME' | 'CLAUDE_CONFIG_DIR';

/** One of the agent's own env values that move where its runs keep memory. */
const useAgentMemoryEnv = (agentId: string | undefined, key: MemoryEnvKey) =>
  useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.env?.[key]
      : undefined,
  );

/**
 * Claude Code's auto memory for `workingDirectory`, read from the execution
 * device: Electron IPC on this desktop, the device RPC for a bound device.
 * Follows the agent's own `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME`,
 * as its runs do. Inert until there is a directory and a transport. An offline
 * device (`null` from the RPC) surfaces as an error, never as "no memory".
 */
export const useClaudeCodeMemory = ({
  agentId,
  deviceId,
  workingDirectory,
}: {
  agentId?: string;
  deviceId?: string;
  workingDirectory?: string;
}) => {
  const configDir = useAgentMemoryEnv(agentId, 'CLAUDE_CONFIG_DIR');
  const projectDirName = useAgentMemoryEnv(agentId, 'CLAUDE_CODE_PROJECT_DIR_NAME');
  const key =
    workingDirectory && (deviceId || isDesktop)
      ? localFileKeys.claudeCodeMemory(deviceId, workingDirectory, configDir, projectDirName)
      : null;

  return useClientDataSWR(
    key,
    async () => {
      const result = await claudeCodeMemoryService.listMemory({
        agentId,
        deviceId,
        env: { CLAUDE_CODE_PROJECT_DIR_NAME: projectDirName, CLAUDE_CONFIG_DIR: configDir },
        workingDirectory: workingDirectory!,
      });
      if (!result) throw new Error('The device did not return Claude Code memory');
      return result;
    },
    // Claude Code writes memory between turns, and the user edits it in the
    // portal, so a refocus re-reads the directory instead of waiting minutes.
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
};
