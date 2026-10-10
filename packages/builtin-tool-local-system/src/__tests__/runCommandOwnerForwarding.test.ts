/**
 * runCommand must carry its owner — topic, agent and the tool message that issued it — down to
 * the desktop IPC, so the process monitor can say who started a background process and link
 * straight back to that message.
 */
import { describe, expect, it, vi } from 'vitest';

const runCommand = vi.fn();
// The executor module pulls in @/services/electron/localFileService (renderer alias).
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { runCommand },
}));

const { localSystemExecutor } = await import('../client/executor');

describe('localSystemExecutor.runCommand — owner forwarding', () => {
  it('forwards topicId, agentId and the tool messageId to the IPC call', async () => {
    runCommand.mockResolvedValue({ output: '', shell_id: 'sh-1', success: true });

    await localSystemExecutor.runCommand(
      { command: 'npm run dev', description: 'dev server', run_in_background: true },
      { agentId: 'agt_1', messageId: 'msg_tool_1', topicId: 'tpc_1' } as any,
    );

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        command: 'npm run dev',
        messageId: 'msg_tool_1',
        run_in_background: true,
        topicId: 'tpc_1',
      }),
    );
  });

  it('forwards the group and workspace so the link opens in the launching conversation', async () => {
    runCommand.mockResolvedValue({ output: '', shell_id: 'sh-2', success: true });

    await localSystemExecutor.runCommand({ command: 'npm run dev' }, {
      agentId: 'agt_1',
      groupId: 'grp_1',
      messageId: 'msg_tool_2',
      topicId: 'tpc_1',
      workspaceId: 'ws_1',
    } as any);

    expect(runCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: 'grp_1', workspaceId: 'ws_1' }),
    );
  });
});
