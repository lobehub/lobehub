import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildHeterogeneousPrompt } from '../protocol';
import { lobeHubCliGuide, lobeHubCliSkillBody } from '../protocol/lobeHubCliGuide';
import * as cliPlugin from '../spawn/lobeHubCliPlugin';
import { preparePiRpcInput } from './preparePiRpcInput';

const options = { args: ['--model', 'test-model'], lobeHubContext: true };

afterEach(() => vi.restoreAllMocks());

describe('preparePiRpcInput', () => {
  it('delivers the guide as a native skill, not as the first user message', async () => {
    const input = buildHeterogeneousPrompt({ isNewSession: true, prompt: '你好' });
    const result = await preparePiRpcInput(input, options);

    expect(result.prompt).toEqual({ text: '你好' });
    expect(result.args).toEqual(['--skill', expect.any(String), ...options.args]);
    const skill = await readFile(result.args[1], 'utf8');
    expect(path.basename(result.args[1])).toBe('SKILL.md');
    expect(skill).toContain(lobeHubCliSkillBody);
    expect(skill).toContain('Not needed for ordinary work on local files or other tools.');
    expect(input.some((block) => block.type === 'text' && block.text === lobeHubCliGuide)).toBe(
      true,
    );
  });

  it('loads the same skill on resume and when discovery is disabled', async () => {
    const first = await preparePiRpcInput(
      buildHeterogeneousPrompt({ isNewSession: true, prompt: 'first' }),
      options,
    );
    const resumed = await preparePiRpcInput(
      buildHeterogeneousPrompt({ isNewSession: false, prompt: 'next' }),
      { ...options, args: ['--no-skills'] },
    );

    expect(resumed.args).toEqual(['--skill', first.args[1], '--no-skills']);
    expect(resumed.prompt).toEqual({ text: 'next' });
  });

  it('preserves system context, referenced topics and image content', async () => {
    const blocks = buildHeterogeneousPrompt({
      isNewSession: true,
      prompt: '<refer_topic id="tpc_test" /> Summarize this',
      systemContext: 'Selected source text',
    });
    const result = await preparePiRpcInput(
      [
        ...blocks,
        { type: 'image', source: { type: 'base64', data: 'aGVsbG8=', mediaType: 'image/png' } },
      ],
      options,
    );

    expect(result.prompt.text).toContain('Selected source text');
    expect(result.prompt.text).toContain('lh topic view');
    expect(result.prompt.text).toContain('<refer_topic id="tpc_test" /> Summarize this');
    expect(result.prompt.text).not.toContain(lobeHubCliGuide);
    expect(result.prompt.images).toEqual([
      { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' },
    ]);
  });

  it('leaves ordinary terminal runs and user-authored guide text untouched', async () => {
    const resolve = vi.spyOn(cliPlugin, 'resolveLobeHubCliPluginDir');
    const standalone = await preparePiRpcInput('hello', {
      args: options.args,
      lobeHubContext: false,
    });
    expect(standalone).toEqual({ args: options.args, prompt: { text: 'hello' } });
    expect(resolve).not.toHaveBeenCalled();

    for (const input of [lobeHubCliGuide, [{ type: 'text' as const, text: lobeHubCliGuide }]]) {
      expect((await preparePiRpcInput(input, options)).prompt.text).toBe(lobeHubCliGuide);
    }
  });

  it.each([true, false])(
    'fails explicitly without a safe skill directory (new session: %s)',
    async (isNewSession) => {
      vi.spyOn(cliPlugin, 'resolveLobeHubCliPluginDir').mockResolvedValue(undefined);
      await expect(
        preparePiRpcInput(buildHeterogeneousPrompt({ isNewSession, prompt: 'work' }), options),
      ).rejects.toThrow('Cannot prepare the LobeHub skill for Pi');
    },
  );

  it('fails on unreadable attachments instead of silently dropping them', async () => {
    await expect(
      preparePiRpcInput(
        [
          { type: 'text', text: 'describe this' },
          { type: 'image', source: { type: 'path', path: '/nonexistent-pi-test-image.png' } },
        ],
        options,
      ),
    ).rejects.toThrow();
  });
});
