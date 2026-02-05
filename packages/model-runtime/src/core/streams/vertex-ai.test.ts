import { describe, expect, it, vi } from 'vitest';

import * as uuidModule from '../../utils/uuid';
import { VertexAIStream } from './vertex-ai';

describe('VertexAIStream', () => {
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
                probabilityScore: 0.062_988_28,
                severity: 'HARM_SEVERY_NEGLIGIBLE',
                severityScore: 0.109_863_28,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.050_292_97,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.078_125,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.194_335_94,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.160_156_25,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.059_326_172,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.064_453_125,
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
                probabilityScore: 0.052_734_375,
                severity: 'HARM_SEVRITY_NEGLIGIBLE',
                severityScore: 0.086_425_78,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.071_777_344,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.095_214_844,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.164_062_5,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.104_980_47,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.075_683_594,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.053_466_797,
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

    const protocolStream = VertexAIStream(mockGoogleStream, {
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
                probabilityScore: 0.098_144_53,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.074_707_03,
              },
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.148_437_5,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.151_367_19,
              },
              {
                category: 'HARM_CATEGORY_HARASSMENT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.112_792_97,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.101_074_22,
              },
              {
                category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                probability: 'NEGLIGIBLE',
                probabilityScore: 0.048_828_125,
                severity: 'HARM_SEVERITY_NEGLIGIBLE',
                severityScore: 0.054_931_64,
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

    const protocolStream = VertexAIStream(mockGoogleStream, {
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

    const protocolStream = VertexAIStream(mockGoogleStream);

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

    const protocolStream = VertexAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      ['id: chat_1', 'event: text', 'data: "234"\n', 'id: chat_1', 'event: text', `data: ""\n`].map(
        (i) => i + '\n',
      ),
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

    const protocolStream = VertexAIStream(mockGoogleStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      ['id: chat_1', 'event: text', 'data: "234"\n', 'id: chat_1', 'event: stop', `data: ""\n`].map(
        (i) => i + '\n',
      ),
    );
  });
});
