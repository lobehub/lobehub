import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudSandboxService } from '@/services/cloudSandbox';

import { skillsExecutor } from '../lobe-skills';

vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: () => [] }));
vi.mock('@/services/cloudSandbox', () => ({
  cloudSandboxService: { callTool: vi.fn(), exportAndUploadFile: vi.fn() },
}));
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

describe('Web Skills exportFile failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tells the model why the export failed', async () => {
    const message = "File not found. Tried paths: ['nope.txt', '/workspace/nope.txt']";
    vi.mocked(cloudSandboxService.exportAndUploadFile).mockResolvedValue({
      error: { message },
      filename: 'nope.txt',
      success: false,
    });

    const result = await skillsExecutor.invoke(
      'exportFile',
      { filename: 'nope.txt', path: 'nope.txt' },
      { messageId: 'test-message', operationId: 'test-operation' },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain(message);
  });

  it('keeps a transport error message', async () => {
    vi.mocked(cloudSandboxService.exportAndUploadFile).mockRejectedValue(new Error('fetch failed'));

    const result = await skillsExecutor.invoke(
      'exportFile',
      { filename: 'a.csv', path: './a.csv' },
      { messageId: 'test-message', operationId: 'test-operation' },
    );

    expect(result.content).toContain('fetch failed');
  });
});
