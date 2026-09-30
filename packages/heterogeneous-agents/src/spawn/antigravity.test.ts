import { describe, expect, it } from 'vitest';

import { buildAntigravityArgs } from './antigravity';
import { buildAgentInput } from './input/buildAgentInput';

describe('Antigravity process input', () => {
  it('sends long prompts as one JSONL stdin message rather than Windows command-line arguments', async () => {
    const prompt = '中文 "quoted"\n& echo %USERPROFILE% '.repeat(5000);
    const input = await buildAgentInput('antigravity', prompt);
    expect(input.args).toEqual([]);
    expect(input.stdin.split('\n')).toHaveLength(2);
    expect(JSON.parse(input.stdin)).toEqual({ event: 'user', message: { content: prompt } });
  });

  it('resumes the exact conversation while retaining user model and permission settings', () => {
    expect(
      buildAntigravityArgs({
        extraArgs: ['--model', 'custom-model', '--effort', 'high'],
        resumeSessionId: 'conv-1',
      }),
    ).toEqual([
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--conversation',
      'conv-1',
      '--model',
      'custom-model',
      '--effort',
      'high',
    ]);
    expect(buildAntigravityArgs({})).not.toContain('--dangerously-skip-permissions');
  });

  it.each([
    '--output-format=json',
    '--input-format',
    '--prompt-interactive=hello',
    '--remote-control',
    '-i',
    '-p',
    '--continue',
    '--conversation=other',
    '--',
  ])('rejects custom %s that breaks protocol or session ownership', (flag) => {
    expect(() => buildAntigravityArgs({ extraArgs: [flag] })).toThrow('LobeHub manages');
  });

  it('rejects image attachments instead of silently dropping them', async () => {
    await expect(
      buildAgentInput('antigravity', [
        { type: 'image', source: { type: 'path', path: '/tmp/image.png' } },
      ]),
    ).rejects.toThrow('does not support image attachments');
  });
});
