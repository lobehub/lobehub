import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerGenerateCommand } from './generate';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    generation: {
      deleteGeneration: { mutate: vi.fn() },
      getGenerationStatus: { query: vi.fn() },
    },
    generationTopic: {
      createTopic: { mutate: vi.fn() },
      getAllGenerationTopics: { query: vi.fn() },
    },
    image: {
      createImage: { mutate: vi.fn() },
    },
    video: {
      createVideo: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { getAuthInfo: mockGetAuthInfo } = vi.hoisted(() => ({
  getAuthInfo: vi.fn(),
}));

const { writeFileSync: mockWriteFileSync } = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/http', () => ({ getAuthInfo: mockGetAuthInfo }));
vi.mock('node:fs', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, writeFileSync: mockWriteFileSync };
});
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('generate command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockGetAuthInfo.mockResolvedValue({
      accessToken: 'test-token',
      headers: {
        'Content-Type': 'application/json',
        'Oidc-Auth': 'test-token',
      },
      serverUrl: 'https://app.lobehub.com',
    });
    for (const router of Object.values(mockTrpcClient)) {
      for (const method of Object.values(router)) {
        for (const fn of Object.values(method)) {
          (fn as ReturnType<typeof vi.fn>).mockReset();
        }
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerGenerateCommand(program);
    return program;
  }

  describe('text', () => {
    it('should default to non-streaming and output plain text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Response text' } }],
          }),
          ok: true,
        }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello']);

      // Should send stream: false by default
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.stream).toBe(false);

      expect(stdoutSpy).toHaveBeenCalledWith('Response text');
    });

    it('should output JSON when --json is used', async () => {
      const responseBody = {
        choices: [{ message: { content: 'Hello' } }],
        model: 'gpt-4o-mini',
        usage: { completion_tokens: 5, prompt_tokens: 10 },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue(responseBody),
          ok: true,
        }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(responseBody, null, 2));
    });

    it('should stream when --stream is explicitly passed', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ body: stream, ok: true }));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--stream']);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.stream).toBe(true);

      expect(stdoutSpy).toHaveBeenCalledWith('Hello');
    });

    it('should parse provider from model string', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'ok' } }],
          }),
          ok: true,
        }),
      );

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'text',
        'Hi',
        '--model',
        'anthropic/claude-3-haiku',
      ]);

      expect(fetch).toHaveBeenCalledWith(
        'https://app.lobehub.com/webapi/chat/anthropic',
        expect.any(Object),
      );
    });

    it('should exit on error response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal error'),
        }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'fail']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('500'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('image', () => {
    it('should create image generation', async () => {
      mockTrpcClient.generationTopic.createTopic.mutate.mockResolvedValue('topic-1');
      mockTrpcClient.image.createImage.mutate.mockResolvedValue({
        data: {
          batch: { id: 'batch-1' },
          generations: [{ asyncTaskId: 'task-1', id: 'gen-1' }],
        },
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'image',
        'a cute cat',
        '--model',
        'dall-e-3',
        '--provider',
        'openai',
      ]);

      expect(mockTrpcClient.generationTopic.createTopic.mutate).toHaveBeenCalledWith({
        type: 'image',
      });
      expect(mockTrpcClient.image.createImage.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          generationTopicId: 'topic-1',
          model: 'dall-e-3',
          params: { prompt: 'a cute cat' },
          provider: 'openai',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Image generation started'));
    });
  });

  describe('video', () => {
    it('should create video generation', async () => {
      mockTrpcClient.generationTopic.createTopic.mutate.mockResolvedValue('topic-2');
      mockTrpcClient.video.createVideo.mutate.mockResolvedValue({
        data: { generationId: 'gen-v1' },
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'video',
        'a dancing cat',
        '--model',
        'gen-3',
        '--provider',
        'runway',
      ]);

      expect(mockTrpcClient.video.createVideo.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          generationTopicId: 'topic-2',
          model: 'gen-3',
          params: { prompt: 'a dancing cat' },
          provider: 'runway',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Video generation started'));
    });
  });

  describe('tts', () => {
    it('should call TTS endpoint and save file', async () => {
      const audioBuffer = new ArrayBuffer(100);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(audioBuffer),
          ok: true,
        }),
      );

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'tts',
        'Hello world',
        '--output',
        '/tmp/test.mp3',
      ]);

      expect(fetch).toHaveBeenCalledWith(
        'https://app.lobehub.com/webapi/tts/openai',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/test.mp3', expect.any(Buffer));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Audio saved'));
    });

    it('should reject invalid backend', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'tts',
        'Hello',
        '--backend',
        'invalid',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Invalid backend'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('asr', () => {
    it('should exit when file not found', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'asr', '/nonexistent/audio.mp3']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('delete', () => {
    it('should delete a generation with --yes', async () => {
      mockTrpcClient.generation.deleteGeneration.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'delete', 'gen-1', '--yes']);

      expect(mockTrpcClient.generation.deleteGeneration.mutate).toHaveBeenCalledWith({
        generationId: 'gen-1',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted generation'));
    });
  });

  describe('status', () => {
    it('should show generation status', async () => {
      mockTrpcClient.generation.getGenerationStatus.query.mockResolvedValue({
        generation: { asset: { url: 'https://example.com/image.png' }, id: 'gen-1' },
        status: 'success',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'status', 'gen-1', 'task-1']);

      expect(mockTrpcClient.generation.getGenerationStatus.query).toHaveBeenCalledWith({
        asyncTaskId: 'task-1',
        generationId: 'gen-1',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('success'));
    });
  });

  describe('list', () => {
    it('should list generation topics', async () => {
      mockTrpcClient.generationTopic.getAllGenerationTopics.query.mockResolvedValue([
        { id: 't1', title: 'My Images', type: 'image', updatedAt: new Date().toISOString() },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[0][0]).toContain('ID');
    });

    it('should show message when empty', async () => {
      mockTrpcClient.generationTopic.getAllGenerationTopics.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No generation topics found.');
    });
  });
});
