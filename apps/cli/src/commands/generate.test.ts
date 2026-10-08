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
    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

    const sseResponse = (events: Array<{ data: unknown; event?: string }>, chunkSize = 7) => {
      const raw = events
        .map(({ data, event }) =>
          [
            'id: chat_test',
            event ? `event: ${event}` : undefined,
            `data: ${typeof data === 'string' && data === '[DONE]' ? data : JSON.stringify(data)}`,
            '',
            '',
          ]
            .filter((line) => line !== undefined)
            .join('\n'),
        )
        .join('');
      const encoder = new TextEncoder();
      // Split into small chunks so events straddle read() boundaries
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < raw.length; i += chunkSize) {
            controller.enqueue(encoder.encode(raw.slice(i, i + chunkSize)));
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    };

    /** Gemini reply as captured from production `/webapi/chat/lobehub` */
    const geminiEvents = [
      { data: { content: 'Hello there', partType: 'text' }, event: 'content_part' },
      { data: { content: ', how are you?', partType: 'text' }, event: 'content_part' },
      { data: 'STOP', event: 'stop' },
      { data: { totalInputTokens: 6, totalOutputTokens: 7 }, event: 'usage' },
      { data: { latency: 650, ttft: 607 }, event: 'speed' },
    ];

    /** OpenAI Responses reply as captured from production `/webapi/chat/lobehub` */
    const openaiEvents = [
      { data: 'in_progress', event: 'data' },
      { data: { type: 'response.in_progress' }, event: 'data' },
      { data: 'encrypted-signature', event: 'reasoning_signature' },
      { data: 'Hello', event: 'text' },
      { data: ', world', event: 'text' },
      { data: { type: 'response.completed' }, event: 'data' },
      { data: { totalTokens: 272 }, event: 'usage' },
    ];

    const writtenText = () =>
      stdoutSpy.mock.calls.map(([chunk]: [unknown]) => String(chunk)).join('');

    it('should default to non-streaming and output plain text', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ choices: [{ message: { content: 'Response text' } }] }),
          ),
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
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(responseBody)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(responseBody, null, 2));
    });

    it('should collect SSE text when the server ignores non-streaming mode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(geminiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello']);

      expect(writtenText()).toBe('Hello there, how are you?\n');
      expect(log.error).not.toHaveBeenCalled();
    });

    it('should output collected SSE as JSON when --json is used without --stream', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(geminiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello', '--json']);

      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        content: 'Hello there, how are you?',
        finishReason: 'STOP',
        usage: { totalInputTokens: 6, totalOutputTokens: 7 },
      });
    });

    it('should stream Gemini content parts without printing the stop reason', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(geminiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--stream']);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.stream).toBe(true);

      expect(writtenText()).toBe('Hello there, how are you?\n');
    });

    it('should stream only text events from the LobeHub protocol', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(openaiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--stream']);

      expect(writtenText()).toBe('Hello, world\n');
    });

    it('should keep reasoning content parts out of the reply text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          sseResponse([
            {
              data: { content: 'Thinking...', inReasoning: true, partType: 'text' },
              event: 'content_part',
            },
            { data: 'more thoughts', event: 'reasoning' },
            { data: { content: 'Answer', partType: 'text' }, event: 'content_part' },
          ]),
        ),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--json']);

      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toMatchObject({
        content: 'Answer',
        reasoning: 'Thinking...more thoughts',
      });
    });

    it('should warn when an image model replies without text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          sseResponse([
            { data: { content: 'iVBORw0KGgo=', partType: 'image' }, event: 'content_part' },
            { data: 'STOP', event: 'stop' },
          ]),
        ),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Draw a cat']);

      expect(writtenText()).toBe('\n');
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('generate image'));
    });

    it('should stream plain OpenAI chat-completion chunks', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            sseResponse([
              { data: { choices: [{ delta: { content: 'Hello' } }] } },
              { data: '[DONE]' },
            ]),
          ),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--stream']);

      expect(writtenText()).toBe('Hello\n');
    });

    it('should print each SSE event as a JSON line with --stream --json', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(geminiEvents.slice(0, 3))));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi', '--stream', '--json']);

      expect(consoleSpy.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual(
        geminiEvents.slice(0, 3),
      );
    });

    it('should exit when the SSE stream reports an error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          sseResponse([
            { data: 'Partial', event: 'text' },
            { data: { message: 'quota exceeded' }, event: 'error' },
          ]),
        ),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse provider from model string', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] })),
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
        vi.fn().mockResolvedValue(new Response('Internal error', { status: 500 })),
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
