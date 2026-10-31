import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { buildTtsParams, registerTtsCommand } from './tts';

const { synthesize } = vi.hoisted(() => ({ synthesize: vi.fn() }));

vi.mock('../../api/client', () => ({
  getTrpcClient: vi.fn(async () => ({ tts: { synthesize: { mutate: synthesize } } })),
}));

describe('generate tts', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let output: string;

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerTtsCommand(program);
    await program.parseAsync(['node', 'test', 'tts', ...args]);
  };

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    output = path.join(os.tmpdir(), `lh-tts-test-${process.pid}-${Date.now()}.wav`);
    synthesize.mockResolvedValue({
      audioBase64: Buffer.from('RIFF-audio').toString('base64'),
      format: 'wav',
      mimeType: 'audio/wav',
      usage: { cost: 0.000_075, inputCharacters: 5 },
    });
  });

  afterEach(async () => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    synthesize.mockReset();
    await rm(output, { force: true });
  });

  it('sends provider/model/voice/params and writes the decoded audio', async () => {
    await run(
      'hello',
      '-m',
      'minimax/speech-02-hd',
      '--voice',
      'female-shaonv',
      '--speed',
      '1.2',
      '--pitch',
      '-2',
      '--emotion',
      'happy',
      '--format',
      'wav',
      '--sample-rate',
      '32000',
      '-o',
      output,
    );

    expect(synthesize).toHaveBeenCalledWith({
      input: 'hello',
      model: 'speech-02-hd',
      params: { emotion: 'happy', format: 'wav', pitch: -2, sampleRate: 32_000, speed: 1.2 },
      provider: 'minimax',
      speed: 1.2,
      voice: 'female-shaonv',
    });
    expect(await readFile(output, 'utf8')).toBe('RIFF-audio');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('5 chars, $0.000075'));
  });

  it("omits params and voice so the server applies the model's defaults", async () => {
    await run('hello', '-o', output);

    expect(synthesize).toHaveBeenCalledWith({
      input: 'hello',
      model: 'tts-1',
      params: undefined,
      provider: 'openai',
      speed: undefined,
      voice: undefined,
    });
  });

  it('names the default output file after the returned format', async () => {
    const cwd = process.cwd();
    const dir = path.dirname(output);
    process.chdir(dir);
    try {
      await run('hello');
      expect(await readFile(path.join(dir, 'output.wav'), 'utf8')).toBe('RIFF-audio');
    } finally {
      process.chdir(cwd);
      await rm(path.join(dir, 'output.wav'), { force: true });
    }
  });

  it('falls back to output.mp3 when an older server returns no format', async () => {
    synthesize.mockResolvedValue({ audioBase64: Buffer.from('ID3').toString('base64') });
    const cwd = process.cwd();
    const dir = path.dirname(output);
    process.chdir(dir);
    try {
      await run('hello');
      expect(await readFile(path.join(dir, 'output.mp3'), 'utf8')).toBe('ID3');
    } finally {
      process.chdir(cwd);
      await rm(path.join(dir, 'output.mp3'), { force: true });
    }
  });

  it('exits with an error on invalid --params JSON', async () => {
    await run('hello', '--params', '{not json', '-o', output);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--params must be a JSON'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe('buildTtsParams', () => {
  it('lets dedicated flags override the same key in --params', () => {
    expect(
      buildTtsParams({
        model: 'tts-1',
        params: '{"speed":0.8,"volume":2,"emotion":"calm"}',
        speed: '1.5',
      }),
    ).toEqual({ emotion: 'calm', speed: 1.5, volume: 2 });
  });

  it('rejects non-numeric numbers and non-object params', () => {
    expect(() => buildTtsParams({ model: 'tts-1', speed: 'fast' })).toThrow(
      '--speed must be a number',
    );
    expect(() => buildTtsParams({ model: 'tts-1', params: '[1]' })).toThrow(
      '--params must be a JSON object',
    );
  });
});
