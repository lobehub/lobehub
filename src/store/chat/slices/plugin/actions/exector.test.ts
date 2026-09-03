import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { useToolStore } from '@/store/tool';

import { lobehubSkillExecutor } from './exector';

const basePayload = {
  apiName: 'runCommand',
  arguments: JSON.stringify({ command: 'repo view lobehub/lobehub' }),
  identifier: 'github',
} as ChatToolPayload;

describe('lobehubSkillExecutor', () => {
  it('should surface raw output directly for a successful CLI skill command', async () => {
    vi.spyOn(useToolStore.getState(), 'callLobehubSkillTool').mockResolvedValue({
      data: {
        command: 'gh repo view lobehub/lobehub',
        exitCode: 0,
        output: 'name:\tlobehub/lobehub\ndescription:\tSelf-hosted AI chat platform',
      },
      success: true,
    });

    const result = await lobehubSkillExecutor(basePayload);

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      'name:\tlobehub/lobehub\ndescription:\tSelf-hosted AI chat platform',
    );
    // Must not be JSON-stringified — no escaped envelope, no wrapping quotes/braces
    expect(result.content).not.toContain('"exitCode"');
  });

  it('should keep the full envelope for a failed (non-zero exitCode) CLI skill command', async () => {
    vi.spyOn(useToolStore.getState(), 'callLobehubSkillTool').mockResolvedValue({
      data: {
        command: 'gh repo view nonexistent/repo',
        exitCode: 1,
        output: 'HTTP 404: Not Found',
      },
      success: true,
    });

    const result = await lobehubSkillExecutor(basePayload);

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      JSON.stringify({
        command: 'gh repo view nonexistent/repo',
        exitCode: 1,
        output: 'HTTP 404: Not Found',
      }),
    );
  });

  it('should keep JSON-stringifying non-CLI-shaped skill results (e.g. Linear)', async () => {
    vi.spyOn(useToolStore.getState(), 'callLobehubSkillTool').mockResolvedValue({
      data: { id: 'issue-1', title: 'Example issue' },
      success: true,
    });

    const result = await lobehubSkillExecutor({
      ...basePayload,
      identifier: 'linear',
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe(JSON.stringify({ id: 'issue-1', title: 'Example issue' }));
  });

  it('should pass through a plain string result unchanged', async () => {
    vi.spyOn(useToolStore.getState(), 'callLobehubSkillTool').mockResolvedValue({
      data: 'plain text result',
      success: true,
    });

    const result = await lobehubSkillExecutor(basePayload);

    expect(result.content).toBe('plain text result');
  });
});
