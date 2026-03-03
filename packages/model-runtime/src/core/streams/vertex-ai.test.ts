import { describe, expect, it, vi } from 'vitest';

import * as uuidModule from '../../utils/uuid';
import { GoogleGenerativeAIStream } from './google';

describe('GoogleGenerativeAIStream (Vertex AI scenarios)', () => {
  it('should transform Vertex AI stream to protocol stream', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');
    const rawChunks = [
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '你好' }] },
            safetyRatings: [
              {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.06298828,
                severity: 'HARM_SEVERY_NEGLIGIBLE',
                severityScore: 0.10986328,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.05029297,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.078125,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.19433594,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.16015625,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.059326172,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.064453125,
              },
            ],
            index: 0,
          },
        ],
        usageMetadata: {},
        modelVersion: 'gemini-1.5-flash-001',
      },
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '！ 😊' }] },
            safetyRatings: [
              {
                category: 'HARM_CATEGORY_HATE_SPEECH',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.052734375,
                severity: 'HARM_SEVRITY_NEGLIGIBLE',
                severityScore: 0.08642578,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.071777344,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.095214844,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.1640625,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.10498047,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.075683594,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.053466797,
              },
            ],
            index: 0,
          },
        ],
        modelVersion: 'gemini-1.5-flash-001',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        rawChunks.forEach((chunk) => controller.enqueue(chunk));

        controller.close();
      },
    });

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onToolCallMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream, {
      callbacks: {
        onStart: onStartMock,
        onText: onTextMock,
        onToolsCalling: onToolCallMock,
        onCompletion: onCompletionMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      // text
      'id: chat_1\n',
      'event: text\n',
      `data: "你好"\n\n`,

      // text
      'id: chat_1\n',
      'event: text\n',
      `data: "！ 😊"\n\n`,

      // requireTerminalEvent: no finishReason → stream parsing error
      'id: chat_1\n',
      'event: error\n',
      `data: ${JSON.stringify({ body: { name: 'Stream parsing error', reason: 'unexpected_end' }, message: 'Stream ended unexpectedly', name: 'Stream parsing error', type: 'StreamChunkError' })}\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenCalledTimes(2);
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('tool_calls', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('abcd1234');

    const rawChunks = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'realtime-weather____fetchCurrentWeather',
                    args: { city: '杭州' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
            safetyRatings: [
              {
                category: 'HARM_CATERY_HATE_SPEECH',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.09814453,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.07470703,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.1484375,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.15136719,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.11279297,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.10107422,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.048828125,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.05493164,
              },
            ],
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 95, candidatesTokenCount: 9, totalTokenCount: 104 },
        modelVersion: 'gemini-1.5-flash-001',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        rawChunks.forEach((chunk) => controller.enqueue(chunk));

        controller.close();
      },
    });

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onToolCallMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream, {
      callbacks: {
        onStart: onStartMock,
        onText: onTextMock,
        onToolsCalling: onToolCallMock,
        onCompletion: onCompletionMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      // text
      'id: chat_1\n',
      'event: tool_calls\n',
      `data: [{"function":{"arguments":"{\\"city\\":\\"杭州\\"}","name":"realtime-weather____fetchCurrentWeather"},"id":"realtime-weather____fetchCurrentWeather_0_abcd1234","index":0,"type":"function"}]\n\n`,
      'id: chat_1\n',
      'event: stop\n',
      'data: "STOP"\n\n',
      'id: chat_1\n',
      'event: usage\n',
      'data: {"outputImageTokens":0,"outputTextTokens":9,"totalInputTokens":95,"totalOutputTokens":9,"totalTokens":104}\n\n',
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onToolCallMock).toHaveBeenCalledTimes(1);
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should handle stop with content', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: { parts: [{ text: '234' }], role: 'model' },
            safetyRatings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
            ],
          },
        ],
        text: () => '234',
        usageMetadata: {
          promptTokenCount: 20,
          totalTokenCount: 20,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
        },
        modelVersion: 'gemini-2.0-flash-exp-image-generation',
      },
      {
        text: () => '567890\n',
        candidates: [
          {
            content: { parts: [{ text: '567890\n' }], role: 'model' },
            finishReason: 'STOP',
            safetyRatings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
            ],
          },
        ],
        usageMetadata: {
          promptTokenCount: 19,
          candidatesTokenCount: 11,
          totalTokenCount: 30,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 11 }],
        },
        modelVersion: 'gemini-2.0-flash-exp-image-generation',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => {
          controller.enqueue(item);
        });

        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "234"\n',

        'id: chat_1',
        'event: text',
        `data: "567890\\n"\n`,
        // stop
        'id: chat_1',
        'event: stop',
        `data: "STOP"\n`,
        // usage
        'id: chat_1',
        'event: usage',
        `data: {"inputTextTokens":19,"outputImageTokens":0,"outputTextTokens":11,"totalInputTokens":19,"totalOutputTokens":11,"totalTokens":30}\n`,
      ].map((i) => i + '\n'),
    );
  });

  it('should return empty text chunk without candidates', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: { parts: [{ text: '234' }], role: 'model' },
            safetyRatings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
            ],
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 3,
          totalTokenCount: 23,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
        },
        modelVersion: 'gemini-2.5-flash-preview-04-17',
      },
      {
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 3,
          totalTokenCount: 23,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
        },
        modelVersion: 'gemini-2.5-flash-preview-04-17',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => {
          controller.enqueue(item);
        });

        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "234"\n',
        'id: chat_1',
        'event: text',
        `data: ""\n`,
        // requireTerminalEvent: no finishReason → stream parsing error
        'id: chat_1',
        'event: error',
        `data: ${JSON.stringify({ body: { name: 'Stream parsing error', reason: 'unexpected_end' }, message: 'Stream ended unexpectedly', name: 'Stream parsing error', type: 'StreamChunkError' })}\n`,
      ].map((i) => i + '\n'),
    );
  });

  it('should handle image generation (text + inlineData)', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is the generated image:' }],
              role: 'model',
            },
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          totalTokenCount: 10,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'iVBORw0KGgoAAAANSUhEUg==',
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 1120,
          totalTokenCount: 1130,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
          candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => controller.enqueue(item));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockStream);
    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        // Gemini 3 model: text-only chunk also uses content_part format
        'id: chat_1',
        'event: content_part',
        'data: {"content":"Here is the generated image:","partType":"text"}\n',

        'id: chat_1',
        'event: content_part',
        'data: {"content":"iVBORw0KGgoAAAANSUhEUg==","mimeType":"image/png","partType":"image"}\n',

        'id: chat_1',
        'event: stop',
        'data: "STOP"\n',

        'id: chat_1',
        'event: usage',
        'data: {"inputTextTokens":10,"outputImageTokens":1120,"outputTextTokens":0,"totalInputTokens":10,"totalOutputTokens":1120,"totalTokens":1130}\n',
      ].map((i) => i + '\n'),
    );
  });

  it('should handle reasoning with image parts', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Thinking about the image...', thought: true }],
              role: 'model',
            },
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          totalTokenCount: 5,
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQ==' },
                  thought: true,
                },
              ],
              role: 'model',
            },
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          totalTokenCount: 5,
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: { mimeType: 'image/png', data: 'finalImageData==' },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 1120,
          totalTokenCount: 1425,
          candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
          thoughtsTokenCount: 300,
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => controller.enqueue(item));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockStream);
    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        // Reasoning text
        'id: chat_1',
        'event: reasoning_part',
        'data: {"content":"Thinking about the image...","inReasoning":true,"partType":"text"}\n',

        // Reasoning image
        'id: chat_1',
        'event: reasoning_part',
        'data: {"content":"/9j/4AAQ==","inReasoning":true,"mimeType":"image/jpeg","partType":"image"}\n',

        // Content image
        'id: chat_1',
        'event: content_part',
        'data: {"content":"finalImageData==","mimeType":"image/png","partType":"image"}\n',

        // stop + usage
        'id: chat_1',
        'event: stop',
        'data: "STOP"\n',

        'id: chat_1',
        'event: usage',
        'data: {"outputImageTokens":1120,"outputReasoningTokens":300,"outputTextTokens":0,"totalInputTokens":5,"totalOutputTokens":1420,"totalTokens":1425}\n',
      ].map((i) => i + '\n'),
    );
  });

  it('should handle mixed text and image in single chunk', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Here is your cat picture: ' },
                { inlineData: { mimeType: 'image/png', data: 'catImageBase64==' } },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 1130,
          totalTokenCount: 1138,
          candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
        },
        modelVersion: 'gemini-3-pro-image-preview',
      },
    ];

    const mockStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => controller.enqueue(item));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockStream);
    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: content_part',
        'data: {"content":"Here is your cat picture: ","partType":"text"}\n',

        'id: chat_1',
        'event: content_part',
        'data: {"content":"catImageBase64==","mimeType":"image/png","partType":"image"}\n',

        'id: chat_1',
        'event: stop',
        'data: "STOP"\n',

        'id: chat_1',
        'event: usage',
        'data: {"outputImageTokens":1120,"outputTextTokens":10,"totalInputTokens":8,"totalOutputTokens":1130,"totalTokens":1138}\n',
      ].map((i) => i + '\n'),
    );
  });

  it('should return stop chunk with empty content candidates', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const data = [
      {
        candidates: [
          {
            content: { parts: [{ text: '234' }], role: 'model' },
            safetyRatings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
            ],
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 3,
          totalTokenCount: 23,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
        },
        modelVersion: 'gemini-2.5-flash-preview-04-17',
      },
      {
        candidates: [{}],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 3,
          totalTokenCount: 23,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
        },
        modelVersion: 'gemini-2.5-flash-preview-04-17',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        data.forEach((item) => {
          controller.enqueue(item);
        });

        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "234"\n',
        // empty candidate content → empty text (not stop)
        'id: chat_1',
        'event: text',
        `data: ""\n`,
        // requireTerminalEvent: no finishReason → stream parsing error
        'id: chat_1',
        'event: error',
        `data: ${JSON.stringify({ body: { name: 'Stream parsing error', reason: 'unexpected_end' }, message: 'Stream ended unexpectedly', name: 'Stream parsing error', type: 'StreamChunkError' })}\n`,
      ].map((i) => i + '\n'),
    );
  });

  it('should handle groundingMetadata with image search results', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const rawChunks = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Here are images and web results' }],
            },
            finishReason: 'STOP',
            index: 0,
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://example.com/article',
                    title: 'example.com',
                  },
                },
                {
                  image: {
                    imageUri: 'https://example.com/photo.jpg',
                    sourceUri: 'https://example.com/page',
                    title: 'Example Photo',
                    domain: 'example.com',
                  },
                },
              ],
              webSearchQueries: ['example query'],
              imageSearchQueries: ['example image query'],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
        },
        modelVersion: 'gemini-3.1-flash-image-preview',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        rawChunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "Here are images and web results"\n',

        'id: chat_1',
        'event: grounding',
        `data: ${JSON.stringify({
          citations: [
            {
              favicon: 'example.com',
              title: 'example.com',
              url: 'https://example.com/article',
            },
          ],
          imageResults: [
            {
              domain: 'example.com',
              imageUri: 'https://example.com/photo.jpg',
              sourceUri: 'https://example.com/page',
              title: 'Example Photo',
            },
          ],
          imageSearchQueries: ['example image query'],
          searchQueries: ['example query'],
        })}\n`,

        'id: chat_1',
        'event: stop',
        `data: "STOP"\n`,

        'id: chat_1',
        'event: usage',
        `data: {"inputTextTokens":5,"outputImageTokens":0,"outputTextTokens":10,"totalInputTokens":5,"totalOutputTokens":10,"totalTokens":15}\n`,
      ].map((i) => i + '\n'),
    );
  });

  it('should handle groundingMetadata with only image chunks (no web chunks)', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const rawChunks = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Image results only' }],
            },
            finishReason: 'STOP',
            index: 0,
            groundingMetadata: {
              groundingChunks: [
                {
                  image: {
                    imageUri: 'https://img.example.com/cat.jpg',
                    sourceUri: 'https://example.com/cats',
                    title: 'Cat Photo',
                    domain: 'example.com',
                  },
                },
              ],
              imageSearchQueries: ['cute cats'],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 5,
          totalTokenCount: 8,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
        },
        modelVersion: 'gemini-3.1-flash-image-preview',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        rawChunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "Image results only"\n',

        'id: chat_1',
        'event: grounding',
        `data: ${JSON.stringify({
          imageResults: [
            {
              domain: 'example.com',
              imageUri: 'https://img.example.com/cat.jpg',
              sourceUri: 'https://example.com/cats',
              title: 'Cat Photo',
            },
          ],
          imageSearchQueries: ['cute cats'],
        })}\n`,

        'id: chat_1',
        'event: stop',
        `data: "STOP"\n`,

        'id: chat_1',
        'event: usage',
        `data: {"inputTextTokens":3,"outputImageTokens":0,"outputTextTokens":5,"totalInputTokens":3,"totalOutputTokens":5,"totalTokens":8}\n`,
      ].map((i) => i + '\n'),
    );
  });

  it('should filter empty strings from searchQueries in groundingMetadata', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const rawChunks = [
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'result' }],
            },
            finishReason: 'STOP',
            index: 0,
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
                    title: 'example.com',
                  },
                },
              ],
              webSearchQueries: ['', '杭州天气', 'Hangzhou weather'],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
          candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
        },
        modelVersion: 'gemini-3.1-flash-image-preview',
      },
    ];

    const mockGoogleStream = new ReadableStream({
      start(controller) {
        rawChunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

    const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: chat_1',
        'event: text',
        'data: "result"\n',

        'id: chat_1',
        'event: grounding',
        `data: ${JSON.stringify({
          citations: [
            {
              favicon: 'example.com',
              title: 'example.com',
              url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
            },
          ],
          searchQueries: ['杭州天气', 'Hangzhou weather'],
        })}\n`,

        'id: chat_1',
        'event: stop',
        `data: "STOP"\n`,

        'id: chat_1',
        'event: usage',
        `data: {"inputTextTokens":5,"outputImageTokens":0,"outputTextTokens":3,"totalInputTokens":5,"totalOutputTokens":3,"totalTokens":8}\n`,
      ].map((i) => i + '\n'),
    );
  });
});
