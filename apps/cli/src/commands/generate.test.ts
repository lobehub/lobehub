import { rm as fsRm, writeFile as fsWriteFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerGenerateCommand } from './generate';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    aiChat: {
      decide: { mutate: vi.fn() },
      outputJSON: { mutate: vi.fn() },
    },
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

const { uploadLocalFile: mockUploadLocalFile } = vi.hoisted(() => ({
  uploadLocalFile: vi.fn(),
}));

vi.mock('../utils/uploadLocalFile', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, uploadLocalFile: mockUploadLocalFile };
});

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/http', () => ({ getAuthInfo: mockGetAuthInfo }));
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

    /** Gemini reply as emitted by `/webapi/chat/*` */
    const geminiEvents = [
      { data: { content: 'Hello there', partType: 'text' }, event: 'content_part' },
      { data: { content: ', how are you?', partType: 'text' }, event: 'content_part' },
      { data: 'STOP', event: 'stop' },
      { data: { totalInputTokens: 6, totalOutputTokens: 7 }, event: 'usage' },
      { data: { latency: 650, ttft: 607 }, event: 'speed' },
    ];

    /** OpenAI Responses reply as emitted by `/webapi/chat/*` */
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

    it('should output collected SSE as JSON when --json is used', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(geminiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hello', '--json']);

      expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
        content: 'Hello there, how are you?',
        finishReason: 'STOP',
        usage: { totalInputTokens: 6, totalOutputTokens: 7 },
      });
    });

    it('should collect only text events from the LobeHub protocol', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(openaiEvents)));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi']);

      expect(writtenText()).toBe('Hello, world\n');
    });

    it('should keep reasoning parts out of the reply text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          sseResponse([
            // Gemini thought parts, as emitted by the google stream transformer
            {
              data: {
                content: 'Thinking...',
                inReasoning: true,
                partType: 'text',
                thoughtSignature: 'sig',
              },
              event: 'reasoning_part',
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

    it('should collect plain OpenAI chat-completion chunks', async () => {
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
      await program.parseAsync(['node', 'test', 'generate', 'text', 'Hi']);

      expect(writtenText()).toBe('Hello\n');
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

  describe('decide', () => {
    const questions = {
      helpful: {
        criteria: { false: 'Chatter.', true: 'An open question.' },
        instructions: 'Would stepping in help?',
        type: 'boolean',
      },
    };

    it('should send the questions and state to aiChat.decide', async () => {
      const response = {
        answers: { helpful: { probability: 0.7, type: 'boolean' } },
        model: 'jev',
      };
      mockTrpcClient.aiChat.decide.mutate.mockResolvedValue({ data: response, tracingId: 't' });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'decide',
        'Newest message: is it ready?',
        '--model',
        'lobehub/jev-1.14.0',
        '--questions',
        JSON.stringify(questions),
      ]);

      expect(mockTrpcClient.aiChat.decide.mutate).toHaveBeenCalledWith({
        metadata: { trigger: 'cli' },
        model: 'jev-1.14.0',
        provider: 'lobehub',
        questions,
        state: 'Newest message: is it ready?',
      });
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
    });

    it('should read questions and state from files', async () => {
      mockTrpcClient.aiChat.decide.mutate.mockResolvedValue({ data: { answers: {} } });
      const dir = os.tmpdir();
      const questionsPath = path.join(dir, `lh-gen-decide-q-${process.pid}.json`);
      const statePath = path.join(dir, `lh-gen-decide-s-${process.pid}.txt`);
      await fsWriteFile(questionsPath, JSON.stringify(questions));
      await fsWriteFile(statePath, 'state from file');

      try {
        const program = createProgram();
        await program.parseAsync([
          'node',
          'test',
          'generate',
          'decide',
          '-m',
          'lobehub/jev-1.14.0',
          '-q',
          questionsPath,
          '--state-file',
          statePath,
        ]);

        expect(mockTrpcClient.aiChat.decide.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ questions, state: 'state from file' }),
        );
      } finally {
        await fsRm(questionsPath, { force: true });
        await fsRm(statePath, { force: true });
      }
    });

    it('should require --model', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'decide',
        'state',
        '--questions',
        JSON.stringify(questions),
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('`--model` is required'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.decide.mutate).not.toHaveBeenCalled();
    });

    it('should reject a question without a known type', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'decide',
        'state',
        '-m',
        'lobehub/jev-1.14.0',
        '--questions',
        '{"ok":{"instructions":"Is it ok?","type":"yesno"}}',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Question "ok" needs a type'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.decide.mutate).not.toHaveBeenCalled();
    });

    it('should require a state', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'decide',
        '-m',
        'lobehub/jev-1.14.0',
        '--questions',
        JSON.stringify(questions),
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No state'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should report a server error and exit', async () => {
      mockTrpcClient.aiChat.decide.mutate.mockRejectedValue(
        new Error('Decision models are not supported by this provider'),
      );

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'decide',
        'state',
        '-m',
        'openai/gpt-4o',
        '--questions',
        JSON.stringify(questions),
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Decision failed'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('json', () => {
    it('should send the schema to aiChat.outputJSON', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      mockTrpcClient.aiChat.outputJSON.mutate.mockResolvedValue({
        data: { name: 'Maya' },
        tracingId: 'trace-1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Invent a person',
        '--schema',
        '{"properties":{"name":{"type":"string"}},"required":["name"],"type":"object"}',
        '--schema-name',
        'person',
      ]);

      expect(mockTrpcClient.aiChat.outputJSON.mutate).toHaveBeenCalledWith({
        messages: [{ content: 'Invent a person', role: 'user' }],
        model: 'gpt-4o-mini',
        provider: 'openai',
        schema: {
          name: 'person',
          schema: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
        },
      });
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ name: 'Maya' }, null, 2));
      // Structured output never touches the chat endpoint
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should require --schema', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'generate', 'json', 'Return JSON']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('`--schema` is required'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.outputJSON.mutate).not.toHaveBeenCalled();
    });

    it('should keep slashes in the model id when --provider is given', async () => {
      mockTrpcClient.aiChat.outputJSON.mutate.mockResolvedValue({ data: { ok: true } });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--provider',
        'siliconcloud',
        '--model',
        'Qwen/Qwen3.6-27B',
        '--schema',
        '{"type":"object","properties":{}}',
      ]);

      expect(mockTrpcClient.aiChat.outputJSON.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'Qwen/Qwen3.6-27B', provider: 'siliconcloud' }),
      );
    });

    it('should reject schema keywords the server drops', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--schema',
        '{"type":"object","properties":{},"minProperties":1}',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('minProperties'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.outputJSON.mutate).not.toHaveBeenCalled();
    });

    it('should mark the schema strict when --strict is passed', async () => {
      mockTrpcClient.aiChat.outputJSON.mutate.mockResolvedValue({ data: { age: 29 } });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Give me an age',
        '--schema',
        '{"properties":{"age":{"type":"number"}},"type":"object"}',
        '--strict',
      ]);

      expect(mockTrpcClient.aiChat.outputJSON.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: {
            name: 'response',
            schema: { properties: { age: { type: 'number' } }, type: 'object' },
            strict: true,
          },
        }),
      );
    });

    it('should read the schema from a file when --schema is a path', async () => {
      const schemaPath = path.join(os.tmpdir(), `lh-gen-schema-${process.pid}.json`);
      await fsWriteFile(
        schemaPath,
        JSON.stringify({ properties: { age: { type: 'number' } }, type: 'object' }),
      );
      mockTrpcClient.aiChat.outputJSON.mutate.mockResolvedValue({ data: { age: 29 } });

      try {
        const program = createProgram();
        await program.parseAsync([
          'node',
          'test',
          'generate',
          'json',
          'Give me an age',
          '--schema',
          schemaPath,
        ]);
      } finally {
        await fsRm(schemaPath, { force: true });
      }

      expect(mockTrpcClient.aiChat.outputJSON.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: {
            name: 'response',
            schema: { properties: { age: { type: 'number' } }, type: 'object' },
          },
        }),
      );
    });

    it('should reject an unreadable schema file', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--schema',
        './no-such-schema.json',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Cannot read schema file'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.outputJSON.mutate).not.toHaveBeenCalled();
    });

    it('should reject a schema that is not an object schema', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--schema',
        '{"type":"array","properties":{}}',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('object schema'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.aiChat.outputJSON.mutate).not.toHaveBeenCalled();
    });

    it('should fail when the endpoint returns no parsed data', async () => {
      mockTrpcClient.aiChat.outputJSON.mutate.mockResolvedValue({
        data: undefined,
        tracingId: 'trace-1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--schema',
        '{"type":"object","properties":{}}',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should report a failed request', async () => {
      mockTrpcClient.aiChat.outputJSON.mutate.mockRejectedValue(new Error('provider down'));

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'generate',
        'json',
        'Hi',
        '--schema',
        '{"type":"object","properties":{}}',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('provider down'));
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
