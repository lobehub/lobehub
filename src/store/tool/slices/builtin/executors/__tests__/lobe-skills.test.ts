import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudSandboxService } from '@/services/cloudSandbox';

import { skillsExecutor } from '../lobe-skills';

vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: () => [] }));
vi.mock('@/services/cloudSandbox', () => ({ cloudSandboxService: { callTool: vi.fn() } }));
vi.mock('@/services/skill', () => ({ agentSkillService: {} }));
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ activeTopicId: 'test-topic' }) },
}));

describe.each(['runCommand', 'execScript'] as const)('Web Skills %s recreation', (api) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])('warns when sandbox transport success is %s', async (success) => {
    vi.mocked(cloudSandboxService.callTool).mockResolvedValue({
      error: success ? undefined : { message: 'missing input file' },
      result: { exitCode: success ? 0 : 1, stdout: 'command output' },
      sessionExpiredAndRecreated: true,
      success,
    });

    const result = await skillsExecutor.invoke(
      api,
      { command: 'cat /tmp/input', description: 'Read input' },
      { messageId: 'test-message', operationId: 'test-operation' },
    );

    expect(result.content).toContain('sandbox session expired and was recreated');
    expect(result.content).toContain(success ? 'command output' : 'missing input file');
    expect(result.success).toBe(success);
    if (success) expect(result.state).toMatchObject({ sessionExpiredAndRecreated: true });
  });
});
