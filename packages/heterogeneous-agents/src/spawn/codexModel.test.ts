import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseCodexModelFromArgs,
  parseCodexProfileFromArgs,
  readCodexSessionModel,
  resolveCodexInitialModel,
} from './codexModel';

const tempDirs: string[] = [];

const makeTempCodexHome = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lobe-codex-model-'));
  tempDirs.push(dir);
  return dir;
};

describe('codex model metadata helpers', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('parses explicit model and profile flags from Codex args', () => {
    expect(parseCodexModelFromArgs(['exec', '--model', 'gpt-5.5'])).toBe('gpt-5.5');
    expect(parseCodexModelFromArgs(['exec', '-m=gpt-5.4'])).toBe('gpt-5.4');
    expect(parseCodexModelFromArgs(['exec', '-c', 'model="gpt-5.3"'])).toBe('gpt-5.3');
    expect(parseCodexModelFromArgs(['exec', '--config=model="gpt-5.2"'])).toBe('gpt-5.2');
    expect(parseCodexProfileFromArgs(['exec', '--profile', 'fast'])).toBe('fast');
    expect(parseCodexProfileFromArgs(['exec', '-p=deep'])).toBe('deep');
  });

  it('resolves the initial model from CODEX_HOME config profile fallback', async () => {
    const codexHome = await makeTempCodexHome();
    await writeFile(
      path.join(codexHome, 'config.toml'),
      [
        'model = "gpt-5.4"',
        '',
        '[profiles.fast]',
        'model = "gpt-5.5-mini"',
        '',
        '[profiles."quoted.name"]',
        'model = "gpt-5.5"',
      ].join('\n'),
    );

    await expect(
      resolveCodexInitialModel({
        args: ['exec', '--profile', 'fast'],
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual({
      model: 'gpt-5.5-mini',
      profile: 'fast',
      source: 'config',
    });

    await expect(
      resolveCodexInitialModel({
        args: ['exec'],
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual({
      model: 'gpt-5.4',
      profile: undefined,
      source: 'config',
    });
  });

  it('prefers explicit args over config defaults', async () => {
    const codexHome = await makeTempCodexHome();
    await writeFile(path.join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n');

    await expect(
      resolveCodexInitialModel({
        args: ['exec', '--model', 'gpt-5.5'],
        env: { CODEX_HOME: codexHome },
      }),
    ).resolves.toEqual({
      model: 'gpt-5.5',
      profile: undefined,
      source: 'args',
    });
  });

  it('reads model metadata from the matching Codex rollout session file', async () => {
    const codexHome = await makeTempCodexHome();
    const sessionDir = path.join(codexHome, 'sessions', '2026', '06', '11');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, 'rollout-2026-06-11T01-31-27-thread-123.jsonl'),
      [
        JSON.stringify({ payload: { model_provider: 'openai' }, type: 'session_meta' }),
        JSON.stringify({ payload: { model_context_window: 258_400 }, type: 'turn_context' }),
        JSON.stringify({ payload: { model: 'gpt-5.5' }, type: 'event_msg' }),
      ].join('\n'),
    );

    await expect(
      readCodexSessionModel('thread-123', { env: { CODEX_HOME: codexHome } }),
    ).resolves.toMatchObject({
      contextWindow: 258_400,
      line: 3,
      model: 'gpt-5.5',
      provider: 'openai',
    });
  });

  it('reads the latest cumulative usage from a Codex rollout session file', async () => {
    const codexHome = await makeTempCodexHome();
    const sessionDir = path.join(codexHome, 'sessions', '2026', '06', '11');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, 'rollout-2026-06-11T01-31-27-thread-usage.jsonl'),
      [
        JSON.stringify({
          payload: { usage: { input_tokens: 10, output_tokens: 2 } },
          type: 'event_msg',
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { cached_input_tokens: 5, input_tokens: 25, output_tokens: 9 },
        }),
      ].join('\n'),
    );

    await expect(
      readCodexSessionModel('thread-usage', { env: { CODEX_HOME: codexHome } }),
    ).resolves.toMatchObject({
      cumulativeUsage: {
        inputCachedTokens: 5,
        inputCacheMissTokens: 20,
        totalInputTokens: 25,
        totalOutputTokens: 9,
        totalTokens: 34,
      },
    });
  });
});
