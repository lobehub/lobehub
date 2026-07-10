import { rm as fsRm, writeFile as fsWriteFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerGenerateCommand } from './generate';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    asr: {
      transcribe: { mutate: vi.fn() },
    },
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

const { uploadLocalFile: mockUploadLocalFile } = vi.hoisted(() => ({
  uploadLocalFile: vi.fn(),
}));

vi.mock('../utils/uploadLocalFile', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, uploadLocalFile: mockUploadLocalFile };
});

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

    it('should pass image-to-video params', async () => {
      mockTrpcClient.generationTopic.createTopic.mutate.mockResolvedValue('topic-3');
      mockTrpcClient.video.createVideo.mutate.mockResolvedValue({
        data: { generationId: 'gen-v2' },
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'video',
        'a cat waving',
        '--model',
        'cogvideox',
        '--provider',
        'zhipu',
        '--image',
        'https://example.com/first.png',
        '--end-image',
        'https://example.com/last.png',
        '--images',
        'https://example.com/a.png',
        'https://example.com/b.png',
      ]);

      expect(mockTrpcClient.video.createVideo.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          generationTopicId: 'topic-3',
          model: 'cogvideox',
          params: {
            endImageUrl: 'https://example.com/last.png',
            imageUrl: 'https://example.com/first.png',
            imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
            prompt: 'a cat waving',
          },
          provider: 'zhipu',
        }),
      );
    });
  });

  describe('tts', () => {
    it('should call OpenAI TTS endpoint and save file', async () => {
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
  });

  describe('asr', () => {
    it('should exit when file not found', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'asr', '/nonexistent/audio.mp3']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should upload large local audio and transcribe by fileId', async () => {
      // Real >3MB temp file so existsSync/statSync (unmocked) see it as large.
      const bigPath = path.join(os.tmpdir(), `lh-asr-test-${process.pid}-${Date.now()}.mp3`);
      await fsWriteFile(bigPath, Buffer.alloc(4 * 1024 * 1024));
      mockUploadLocalFile.mockResolvedValue({ id: 'file_999' });
      mockTrpcClient.asr.transcribe.mutate.mockResolvedValue({ text: 'big result' });

      try {
        const program = createProgram();
        await program.parseAsync(['node', 'test', 'generate', 'asr', bigPath]);

        expect(mockUploadLocalFile).toHaveBeenCalledWith(expect.anything(), bigPath);
        expect(mockTrpcClient.asr.transcribe.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ fileId: 'file_999', model: 'whisper-1', provider: 'openai' }),
        );
        // never inlines bytes for the large file
        expect(mockTrpcClient.asr.transcribe.mutate.mock.calls[0][0]).not.toHaveProperty(
          'audioBase64',
        );
        expect(stdoutSpy).toHaveBeenCalledWith('big result');
      } finally {
        await fsRm(bigPath, { force: true });
      }
    });

    it('should download and transcribe an audio URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('audio-bytes').buffer),
        headers: new Headers(),
        ok: true,
      });
      vi.stubGlobal('fetch', fetchMock);
      mockTrpcClient.asr.transcribe.mutate.mockResolvedValue({ text: 'hello world' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'asr',
        'https://example.com/audio/sample.mp3',
      ]);

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/audio/sample.mp3');
      expect(mockTrpcClient.asr.transcribe.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          audioBase64: Buffer.from('audio-bytes').toString('base64'),
          fileName: 'sample.mp3',
          model: 'whisper-1',
          provider: 'openai',
        }),
      );
      expect(stdoutSpy).toHaveBeenCalledWith('hello world');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should derive an extension and mime type from Content-Type when the URL has none', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('audio-bytes').buffer),
          headers: new Headers({ 'content-type': 'audio/mpeg; charset=binary' }),
          ok: true,
        }),
      );
      mockTrpcClient.asr.transcribe.mutate.mockResolvedValue({ text: 'ok' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'asr', 'https://example.com/download']);

      expect(mockTrpcClient.asr.transcribe.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'download.mp3',
          mimeType: 'audio/mpeg',
        }),
      );
    });

    it('should prefer the filename from Content-Disposition', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('audio-bytes').buffer),
          headers: new Headers({
            'content-disposition': 'attachment; filename="recording.wav"',
          }),
          ok: true,
        }),
      );
      mockTrpcClient.asr.transcribe.mutate.mockResolvedValue({ text: 'ok' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'asr',
        'https://example.com/files/abc123?sig=xyz',
      ]);

      expect(mockTrpcClient.asr.transcribe.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'recording.wav' }),
      );
    });

    it('should exit when audio URL download fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
      );

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'asr',
        'https://example.com/missing.mp3',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to download audio'));
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
