import type { GenerateContentResponse } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import * as uuidModule from '../../../utils/uuid';
import { GoogleGenerativeAIStream, LOBE_ERROR_KEY } from './index';

/**
 * Helper function to decode stream chunks into string array
 */
async function decodeStreamChunks(stream: ReadableStream): Promise<string[]> {
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  // @ts-ignore
  for await (const chunk of stream) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }

  return chunks;
}

describe('GoogleGenerativeAIStream', () => {
  describe('Basic functionality', () => {
    it('should transform Google Generative AI stream to protocol stream', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('abcd1234');

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          // Text chunk
          controller.enqueue({
            text: 'Hello',
            candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' }, index: 0 }],
          } as unknown as GenerateContentResponse);

          // Function call chunk
          controller.enqueue({
            text: '',
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'testFunction',
                        args: { arg1: 'value1' },
                      },
                    },
                  ],
                  role: 'model',
                },
                index: 0,
              },
            ],
          } as unknown as GenerateContentResponse);

          // Final chunk with finishReason and usageMetadata to mark terminal event
          controller.enqueue({
            text: ' world!',
            candidates: [
              {
                content: { parts: [{ text: ' world!' }], role: 'model' },
                finishReason: 'STOP',
                index: 0,
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              totalTokenCount: 1,
              promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1 }],
            },
            modelVersion: 'gemini-test',
          } as unknown as GenerateContentResponse);

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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        // text
        'id: chat_1\n',
        'event: text\n',
        `data: "Hello"\n\n`,

        // tool call
        'id: chat_1\n',
        'event: tool_calls\n',
        `data: [{"function":{"arguments":"{\\"arg1\\":\\"value1\\"}","name":"testFunction"},"id":"testFunction_0_abcd1234","index":0,"type":"function"}]\n\n`,

        // text
        'id: chat_1\n',
        'event: text\n',
        `data: " world!"\n\n`,
        // stop
        'id: chat_1\n',
        'event: stop\n',
        `data: "STOP"\n\n`,
        // usage
        'id: chat_1\n',
        'event: usage\n',
        `data: {"inputTextTokens":1,"outputImageTokens":0,"outputTextTokens":0,"totalInputTokens":1,"totalOutputTokens":0,"totalTokens":1}\n\n`,
      ]);

      expect(onStartMock).toHaveBeenCalledTimes(1);
      expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
      expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
      expect(onToolCallMock).toHaveBeenCalledTimes(1);
      expect(onCompletionMock).toHaveBeenCalledTimes(1);
    });

    it('should handle empty stream', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('E5M9dFKw');
      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            candidates: [{ content: { role: 'model' }, finishReason: 'STOP', index: 0 }],
            usageMetadata: {
              promptTokenCount: 0,
              cachedContentTokenCount: 0,
              totalTokenCount: 0,
              promptTokensDetails: [
                { modality: 'TEXT', tokenCount: 0 },
                { modality: 'IMAGE', tokenCount: 0 },
              ],
            },
            modelVersion: 'gemini-test',
          } as unknown as GenerateContentResponse);

          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        'id: chat_E5M9dFKw\n',
        'event: stop\n',
        `data: "STOP"\n\n`,
        'id: chat_E5M9dFKw\n',
        'event: usage\n',
        `data: {"inputCachedTokens":0,"inputImageTokens":0,"inputTextTokens":0,"outputImageTokens":0,"outputTextTokens":0,"totalInputTokens":0,"totalOutputTokens":0,"totalTokens":0}\n\n`,
      ]);
    });

    it('should return undefined data without text', async () => {
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
          text: '234',
          usageMetadata: {
            promptTokenCount: 19,
            candidatesTokenCount: 3,
            totalTokenCount: 122,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
            thoughtsTokenCount: 100,
          },
          modelVersion: 'gemini-2.5-flash-preview-04-17',
        },
        {
          text: '',
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
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
            candidatesTokenCount: 3,
            totalTokenCount: 122,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
            candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 3 }],
            thoughtsTokenCount: 100,
          },
          modelVersion: 'gemini-2.5-flash-preview-04-17',
        },
        {
          text: '567890\n',
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
            totalTokenCount: 131,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
            candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 11 }],
            thoughtsTokenCount: 100,
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: text',
          'data: "234"\n',

          'id: chat_1',
          'event: text',
          'data: ""\n',

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
          `data: {"inputTextTokens":19,"outputImageTokens":0,"outputReasoningTokens":100,"outputTextTokens":11,"totalInputTokens":19,"totalOutputTokens":111,"totalTokens":131}\n`,
        ].map((i) => i + '\n'),
      );
    });
  });

  describe('Reasoning and Thought', () => {
    it('should handle thought candidate part', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: '**Understanding the Conditional Logic**\n\n', thought: true }],
                role: 'model',
              },
              index: 0,
            },
          ],
          text: '**Understanding the Conditional Logic**\n\n',
          usageMetadata: {
            promptTokenCount: 38,
            candidatesTokenCount: 7,
            totalTokenCount: 301,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 38 }],
            thoughtsTokenCount: 256,
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: '**Finalizing Interpretation**\n\n', thought: true }],
                role: 'model',
              },
              index: 0,
            },
          ],
          text: '**Finalizing Interpretation**\n\n',
          usageMetadata: {
            promptTokenCount: 38,
            candidatesTokenCount: 13,
            totalTokenCount: 355,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 38 }],
            thoughtsTokenCount: 304,
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: '简单来说，' }],
                role: 'model',
              },
              index: 0,
            },
          ],
          text: '简单来说，',
          usageMetadata: {
            promptTokenCount: 38,
            candidatesTokenCount: 16,
            totalTokenCount: 358,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 38 }],
            thoughtsTokenCount: 304,
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
        },
        {
          candidates: [
            {
              content: { parts: [{ text: '文本内容。' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          text: '文本内容。',
          usageMetadata: {
            promptTokenCount: 38,
            candidatesTokenCount: 19,
            totalTokenCount: 361,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 38 }],
            thoughtsTokenCount: 304,
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Understanding the Conditional Logic**\\n\\n","inReasoning":true,"partType":"text"}\n',

          'id: chat_1',
          'event: reasoning_part',
          `data: {"content":"**Finalizing Interpretation**\\n\\n","inReasoning":true,"partType":"text"}\n`,

          'id: chat_1',
          'event: text',
          'data: "简单来说，"\n',

          'id: chat_1',
          'event: text',
          'data: "文本内容。"\n',
          // stop
          'id: chat_1',
          'event: stop',
          `data: "STOP"\n`,
          // usage
          'id: chat_1',
          'event: usage',
          `data: {"inputTextTokens":38,"outputImageTokens":0,"outputReasoningTokens":304,"outputTextTokens":19,"totalInputTokens":38,"totalOutputTokens":323,"totalTokens":361}\n`,
        ].map((i) => i + '\n'),
      );
    });

    it('should handle stop with content and thought', async () => {
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
          text: '234',
          usageMetadata: {
            promptTokenCount: 19,
            candidatesTokenCount: 3,
            totalTokenCount: 122,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
            thoughtsTokenCount: 100,
          },
          modelVersion: 'gemini-2.5-flash-preview-04-17',
        },
        {
          text: '567890\n',
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
            totalTokenCount: 131,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 19 }],
            candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 11 }],
            thoughtsTokenCount: 100,
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: text',
          'data: "234"\n',

          'id: chat_1',
          'event: text',
          'data: "567890\\n"\n',
          // stop
          'id: chat_1',
          'event: stop',
          `data: "STOP"\n`,
          // usage
          'id: chat_1',
          'event: usage',
          `data: {"inputTextTokens":19,"outputImageTokens":0,"outputReasoningTokens":100,"outputTextTokens":11,"totalInputTokens":19,"totalOutputTokens":111,"totalTokens":131}\n`,
        ].map((i) => i + '\n'),
      );
    });
  });

  describe('Usage and Token counting', () => {
    it('should handle token count', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = {
        candidates: [{ content: { role: 'model' }, finishReason: 'STOP', index: 0 }],
        usageMetadata: {
          promptTokenCount: 266,
          totalTokenCount: 266,
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 8 },
            { modality: 'IMAGE', tokenCount: 258 },
          ],
        },
        modelVersion: 'gemini-2.0-flash-exp',
      };

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);

          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        // stop
        'id: chat_1\n',
        'event: stop\n',
        `data: "STOP"\n\n`,
        // usage
        'id: chat_1\n',
        'event: usage\n',
        `data: {"inputImageTokens":258,"inputTextTokens":8,"outputImageTokens":0,"outputTextTokens":0,"totalInputTokens":266,"totalOutputTokens":0,"totalTokens":266}\n\n`,
      ]);
    });

    it('should handle token count with cached token count', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = {
        candidates: [{ content: { role: 'model' }, finishReason: 'STOP', index: 0 }],
        usageMetadata: {
          promptTokenCount: 15725,
          candidatesTokenCount: 1053,
          totalTokenCount: 16778,
          cachedContentTokenCount: 14286,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 15725 }],
          cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 14286 }],
        },
        modelVersion: 'gemini-2.0-flash-exp',
      };

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);

          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        // stop
        'id: chat_1\n',
        'event: stop\n',
        `data: "STOP"\n\n`,
        // usage
        'id: chat_1\n',
        'event: usage\n',
        `data: {"inputCacheMissTokens":1439,"inputCachedTokens":14286,"inputTextTokens":15725,"outputImageTokens":0,"outputTextTokens":1053,"totalInputTokens":15725,"totalOutputTokens":1053,"totalTokens":16778}\n\n`,
      ]);
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
          text: '234',
          usageMetadata: {
            promptTokenCount: 20,
            totalTokenCount: 20,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
          },
          modelVersion: 'gemini-2.0-flash-exp-image-generation',
        },
        {
          text: '567890\n',
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

      const chunks = await decodeStreamChunks(protocolStream);

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
  });

  describe('Special content types', () => {
    it('should handle image', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAA' } }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 6,
          totalTokenCount: 6,
          promptTokensDetails: [
            { modality: 'TEXT', tokenCount: 6 },
            { modality: 'IMAGE', tokenCount: 0 },
          ],
        },
        modelVersion: 'gemini-2.0-flash-exp',
      };

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);

          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        // image
        'id: chat_1\n',
        'event: base64_image\n',
        `data: "data:image/png;base64,iVBORw0KGgoAA"\n\n`,
        // stop
        'id: chat_1\n',
        'event: stop\n',
        `data: "STOP"\n\n`,
        // usage
        'id: chat_1\n',
        'event: usage\n',
        `data: {"inputImageTokens":0,"inputTextTokens":6,"outputImageTokens":0,"outputTextTokens":0,"totalInputTokens":6,"totalOutputTokens":0,"totalTokens":6}\n\n`,
      ]);
    });

    it('should handle groundingMetadata', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          text: '123',
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '123',
                  },
                ],
                role: 'model',
              },
              index: 0,
              groundingMetadata: {},
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            candidatesTokenCount: 18,
            totalTokenCount: 27,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 9,
              },
            ],
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
        },
        {
          text: '45678',
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '45678',
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
              groundingMetadata: {
                searchEntryPoint: {
                  renderedContent: 'content\n',
                },
                groundingChunks: [
                  {
                    web: {
                      uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF9wXG1234545',
                      title: 'npmjs.com',
                    },
                  },
                  {
                    web: {
                      uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF9wXE9288334',
                      title: 'google.dev',
                    },
                  },
                ],
                groundingSupports: [
                  {
                    segment: {
                      startIndex: 63,
                      endIndex: 67,
                      text: '1。',
                    },
                    groundingChunkIndices: [0],
                    confidenceScores: [1],
                  },
                  {
                    segment: {
                      startIndex: 69,
                      endIndex: 187,
                      text: 'SDK。',
                    },
                    groundingChunkIndices: [1],
                    confidenceScores: [1],
                  },
                ],
                webSearchQueries: ['sdk latest version'],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            candidatesTokenCount: 122,
            totalTokenCount: 131,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 9,
              },
            ],
          },
          modelVersion: 'models/gemini-2.5-flash-preview-04-17',
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: text',
          'data: "123"\n',

          'id: chat_1',
          'event: text',
          'data: "45678"\n',

          'id: chat_1',
          'event: grounding',
          `data: {\"citations\":[{\"favicon\":\"npmjs.com\",\"title\":\"npmjs.com\",\"url\":\"https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF9wXG1234545\"},{\"favicon\":\"google.dev\",\"title\":\"google.dev\",\"url\":\"https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF9wXE9288334\"}],\"searchQueries\":[\"sdk latest version\"]}\n`,
          // stop
          'id: chat_1',
          'event: stop',
          `data: "STOP"\n`,
          // usage
          'id: chat_1',
          'event: usage',
          `data: {"inputTextTokens":9,"outputImageTokens":0,"outputTextTokens":122,"totalInputTokens":9,"totalOutputTokens":122,"totalTokens":131}\n`,
        ].map((i) => i + '\n'),
      );
    });
  });

  describe('Tool calls', () => {
    it('should handle tool calls with thoughtSignature', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('abcd1234');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'grep____searchGitHub____mcp',
                      args: {
                        query: '"version":',
                        repo: 'lobehub/lobe-chat',
                        path: 'package.json',
                      },
                    },
                    thoughtSignature: '123',
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'UVcdaZ26ILac_uMP9ZOeiQ0',
          usageMetadata: {
            promptTokenCount: 1171,
            candidatesTokenCount: 41,
            totalTokenCount: 1408,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1171 }],
            thoughtsTokenCount: 196,
          },
        },
        {
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'UVcdaZ26ILac_uMP9ZOeiQ0',
          usageMetadata: {
            promptTokenCount: 1171,
            candidatesTokenCount: 41,
            totalTokenCount: 1408,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1171 }],
            thoughtsTokenCount: 196,
          },
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          'data: [{"function":{"arguments":"{\\"query\\":\\"\\\\\\\"version\\\\\\":\\",\\"repo\\":\\"lobehub/lobe-chat\\",\\"path\\":\\"package.json\\"}","name":"grep____searchGitHub____mcp"},"id":"grep____searchGitHub____mcp_0_abcd1234","index":0,"thoughtSignature":"123","type":"function"}]\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":1171,"outputImageTokens":0,"outputReasoningTokens":196,"outputTextTokens":41,"totalInputTokens":1171,"totalOutputTokens":237,"totalTokens":1408}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should handle parallel tool calls', async () => {
      vi.spyOn(uuidModule, 'nanoid')
        .mockReturnValueOnce('1')
        .mockReturnValueOnce('abcd1234')
        .mockReturnValueOnce('efgh5678');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'get_current_temperature',
                      args: {
                        location: 'Paris',
                      },
                    },
                    thoughtSignature: 'ErEDCq4DAdHtim...',
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 72,
            candidatesTokenCount: 18,
            totalTokenCount: 167,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 72,
              },
            ],
            thoughtsTokenCount: 77,
          },
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'UDcdaZviO4jojMcPycPDkQY',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'get_current_temperature',
                      args: {
                        location: 'London',
                      },
                    },
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 72,
            candidatesTokenCount: 36,
            totalTokenCount: 185,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 72,
              },
            ],
            thoughtsTokenCount: 77,
          },
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'UDcdaZviO4jojMcPycPDkQY',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '',
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 72,
            candidatesTokenCount: 36,
            totalTokenCount: 185,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 72,
              },
            ],
            thoughtsTokenCount: 77,
          },
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'UDcdaZviO4jojMcPycPDkQY',
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          'data: [{"function":{"arguments":"{\\"location\\":\\"Paris\\"}","name":"get_current_temperature"},"id":"get_current_temperature_0_abcd1234","index":0,"thoughtSignature":"ErEDCq4DAdHtim...","type":"function"}]\n',

          'id: chat_1',
          'event: tool_calls',
          'data: [{"function":{"arguments":"{\\"location\\":\\"London\\"}","name":"get_current_temperature"},"id":"get_current_temperature_0_efgh5678","index":0,"type":"function"}]\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":72,"outputImageTokens":0,"outputReasoningTokens":77,"outputTextTokens":36,"totalInputTokens":72,"totalOutputTokens":113,"totalTokens":185}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should handle sequential tool calls with thinking in separate chunks', async () => {
      // This test simulates a real-world scenario where Gemini returns:
      // 1. Multiple thinking chunks (thought: true)
      // 2. First tool call in one chunk
      // 3. Second tool call in another chunk
      // 4. Final empty text with finishReason
      // Each tool call should be treated as a separate call, not concatenated
      vi.spyOn(uuidModule, 'nanoid')
        .mockReturnValueOnce('test')
        .mockReturnValueOnce('tool_id_1')
        .mockReturnValueOnce('tool_id_2');

      const data = [
        // Chunk 0-3: Thinking chunks (omitted for brevity, just showing final chunks)
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "**Planning the Solution**\n\nI'm solidifying my plan...",
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'JMxUadDKN8KMjMcPk-LP4Qw',
          usageMetadata: {
            promptTokenCount: 10250,
            totalTokenCount: 10250,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10250 }],
          },
        },
        // Chunk 4: First tool call (createPlan)
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'lobe-gtd____createPlan____builtin',
                      args: {
                        goal: 'Fix Linear API Argument Validation Error',
                        description: 'Investigate the Linear API error.',
                        context: 'The user is encountering a validation error.',
                      },
                    },
                    thoughtSignature: 'EoIYCv8XAXLI2nx+C18votz5l0A...',
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'JMxUadDKN8KMjMcPk-LP4Qw',
          usageMetadata: {
            promptTokenCount: 10250,
            candidatesTokenCount: 131,
            totalTokenCount: 11111,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10250 }],
            thoughtsTokenCount: 730,
          },
        },
        // Chunk 5: Second tool call (createTodos) - different function, same streaming response
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'lobe-gtd____createTodos____builtin',
                      args: {
                        adds: [
                          'Verify Linear GraphQL API requirements',
                          'Determine if code needs to look up Team UUID',
                          'Provide corrected code',
                        ],
                      },
                    },
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'JMxUadDKN8KMjMcPk-LP4Qw',
          usageMetadata: {
            promptTokenCount: 10250,
            candidatesTokenCount: 213,
            totalTokenCount: 11193,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10250 }],
            thoughtsTokenCount: 730,
          },
        },
        // Chunk 6: Empty text with finishReason
        {
          candidates: [
            {
              content: {
                parts: [{ text: '' }],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'JMxUadDKN8KMjMcPk-LP4Qw',
          usageMetadata: {
            promptTokenCount: 10250,
            candidatesTokenCount: 213,
            totalTokenCount: 11193,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10250 }],
            thoughtsTokenCount: 730,
          },
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

      const chunks = await decodeStreamChunks(protocolStream);

      // Verify the output contains two separate tool_calls events
      expect(chunks).toEqual(
        [
          // Thinking chunk
          'id: chat_test',
          'event: reasoning_part',
          'data: {"content":"**Planning the Solution**\\n\\nI\'m solidifying my plan...","inReasoning":true,"partType":"text"}\n',

          // First tool call (createPlan)
          'id: chat_test',
          'event: tool_calls',
          'data: [{"function":{"arguments":"{\\"goal\\":\\"Fix Linear API Argument Validation Error\\",\\"description\\":\\"Investigate the Linear API error.\\",\\"context\\":\\"The user is encountering a validation error.\\"}","name":"lobe-gtd____createPlan____builtin"},"id":"lobe-gtd____createPlan____builtin_0_tool_id_1","index":0,"thoughtSignature":"EoIYCv8XAXLI2nx+C18votz5l0A...","type":"function"}]\n',

          // Second tool call (createTodos) - should be a SEPARATE event with index:0
          'id: chat_test',
          'event: tool_calls',
          'data: [{"function":{"arguments":"{\\"adds\\":[\\"Verify Linear GraphQL API requirements\\",\\"Determine if code needs to look up Team UUID\\",\\"Provide corrected code\\"]}","name":"lobe-gtd____createTodos____builtin"},"id":"lobe-gtd____createTodos____builtin_0_tool_id_2","index":0,"type":"function"}]\n',

          // Stop and usage
          'id: chat_test',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_test',
          'event: usage',
          'data: {"inputTextTokens":10250,"outputImageTokens":0,"outputReasoningTokens":730,"outputTextTokens":213,"totalInputTokens":10250,"totalOutputTokens":943,"totalTokens":11193}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should handle thoughtSignature with empty text', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '你好！很高兴为你服务。请问有什么我可以帮你的吗？\n\n无论是回答问题、协助写作、翻译，还是随便聊聊，我都随时待命！',
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 35,
            totalTokenCount: 712,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 1,
              },
            ],
            thoughtsTokenCount: 676,
          },
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'lTcdaf_1FrONjMcP24Sz6QQ',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '',
                    thoughtSignature: 'Ep8YCpwYAdHtim...',
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 35,
            totalTokenCount: 712,
            promptTokensDetails: [
              {
                modality: 'TEXT',
                tokenCount: 1,
              },
            ],
            thoughtsTokenCount: 676,
          },
          modelVersion: 'gemini-3-pro-preview',
          responseId: 'lTcdaf_1FrONjMcP24Sz6QQ',
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

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: content_part',
          'data: {"content":"你好！很高兴为你服务。请问有什么我可以帮你的吗？\\n\\n无论是回答问题、协助写作、翻译，还是随便聊聊，我都随时待命！","partType":"text"}\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":1,"outputImageTokens":0,"outputReasoningTokens":676,"outputTextTokens":35,"totalInputTokens":1,"totalOutputTokens":711,"totalTokens":712}\n',
        ].map((i) => i + '\n'),
      );
    });
  });

  describe('Error handling', () => {
    it('should handle promptFeedback with blockReason (PROHIBITED_CONTENT)', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = {
        promptFeedback: {
          blockReason: 'PROHIBITED_CONTENT',
        },
        usageMetadata: {
          promptTokenCount: 4438,
          totalTokenCount: 4438,
          promptTokensDetails: [{ modality: 'TEXT', tokenCount: 4438 }],
        },
        modelVersion: 'gemini-2.5-pro',
        responseId: 'THOUaKaNOeiGz7IPjL_VgQc',
      };

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        'id: chat_1\n',
        'event: error\n',
        `data: {"body":{"context":{"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"}},"message":"Your request may contain prohibited content. Please adjust your request to comply with the usage guidelines.","provider":"google"},"type":"ProviderBizError"}\n\n`,
      ]);
    });

    it('should pass through injected lobe error marker', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const errorPayload = { message: 'internal error', code: 123 };

      const mockGoogleStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ [LOBE_ERROR_KEY]: errorPayload });
          controller.close();
        },
      });

      const protocolStream = GoogleGenerativeAIStream(mockGoogleStream);

      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual([
        'id: chat_1\n',
        'event: error\n',
        `data: ${JSON.stringify(errorPayload)}\n\n`,
      ]);
    });
  });

  describe('Thought filtering logic', () => {
    it('should keep text and thoughtSignature when both exist in parts', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Here is my answer',
                    thoughtSignature: 'sig123',
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
            candidatesTokenCount: 5,
            totalTokenCount: 15,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
            thoughtsTokenCount: 50,
          },
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
      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: content_part',
          'data: {"content":"Here is my answer","partType":"text","thoughtSignature":"sig123"}\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":10,"outputImageTokens":0,"outputReasoningTokens":50,"outputTextTokens":5,"totalInputTokens":10,"totalOutputTokens":55,"totalTokens":15}\n',
        ].map((i) => i + '\n'),
      );
    });
  });

  describe('Multimodal parts (reasoning_part and content_part)', () => {
    it('should handle mixed reasoning text and reasoning image parts', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "**Clarifying the Core Concept**\n\nI'm now focusing on the visual metaphor. I plan to depict Agent Runtime as a software environment that manages and executes agents' tasks, similar to how an operating system functions. I aim to create an informative and intuitive infographic.\n\n\n",
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '**Developing Visual Representation**\n\nI\'m now iterating on the visual representation. The "command center" metaphor is proving useful. I\'m focusing on the interplay of the core components: the central engine coordinates perception, memory, planning, and action, with tools and plugins as extensions. The goal is to clearly show the flow of information through the system, from input to output, using visual cues. The aesthetic aims for a futuristic, tech-inspired look with glowing lines and circuit board elements, using a palette of blues, purples, and oranges.\n\n\n',
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "**Constructing the Architecture**\n\nI'm presently building out the architecture of the infographic. I've broken down \"Agent Runtime\" into its core components and I'm designing the visual relationships between them.  The central engine will be the focal point, with modules for perception, memory, planning, action, and tools radiating outwards. My aim is to illustrate the workflow from input to output clearly. I'll utilize arrows to represent the flow of data and instructions between each module.\n\n\n",
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: '/9j/4AAQSkZJRgABAQEBLAEsAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQBiUgnjeAMHrkrk/mMk8k57YpwnCsBtzkcgk+/ONuO3QE4JJ3ccuJ373EbEg5KgDkAg4xtySNrHv14HYm9ne7au7JpLRfm+vn63Emtk9FZWv1t+Ntt9L9Wj//2Q==',
                    },
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '**Constructing an Infographic**\n\nI\'ve successfully created an infographic depicting an "Agent Runtime." The design employs a tech-inspired circuit board aesthetic, placing the core engine at the center. I\'ve clearly represented six essential modules: perception, memory, planning, action, tools, and learning. Arrows and text annotations vividly illustrate the data flow and processing.\n\n\n',
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "**Defining Agent Runtime Modules**\n\nI'm making progress clarifying the architecture of an \"Agent Runtime\" system. I've designed an infographic with a circuit board aesthetic, centered on the core engine. Six key modules are now visualized: perception, memory, planning, action, tools, and learning. I've incorporated arrows and annotations to show data flow effectively.\n\n\n",
                    thought: true,
                  },
                ],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            totalTokenCount: 9,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: '/9j/4AAQSkZJRgABAQEBLAEsAAD/2wBDAAEBAQEBAQEBA2Q==',
                    },
                    thoughtSignature:
                      'EueybArjsmwB0e2Kby+QPRkacnmPuV+CqMr6tiey3M5BHLHgIiggQOMeFmnKzsoux6PI6dQMgmdbXE1OTLLcWUmUD1CgFn+C2VdI09FpHrVhxVAtSk/zFVSlsjfCuANxtkP8tCDppVZqIya0QYjzg5K1fEO0m42CZX2/MHyqL8NjzR0lT8ENdoV3RSaK2tXqPH45uIb6nGeBSuX1n2EUMzO',
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            candidatesTokenCount: 1358,
            totalTokenCount: 1728,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
            candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
            thoughtsTokenCount: 361,
          },
          modelVersion: 'gemini-3-pro-image-preview',
          responseId: 'MRYkaeWsL5bSjMcPlsLRiQo',
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
      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          // First reasoning text
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Clarifying the Core Concept**\\n\\nI\'m now focusing on the visual metaphor. I plan to depict Agent Runtime as a software environment that manages and executes agents\' tasks, similar to how an operating system functions. I aim to create an informative and intuitive infographic.\\n\\n\\n","inReasoning":true,"partType":"text"}\n',

          // Second reasoning text
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Developing Visual Representation**\\n\\nI\'m now iterating on the visual representation. The \\"command center\\" metaphor is proving useful. I\'m focusing on the interplay of the core components: the central engine coordinates perception, memory, planning, and action, with tools and plugins as extensions. The goal is to clearly show the flow of information through the system, from input to output, using visual cues. The aesthetic aims for a futuristic, tech-inspired look with glowing lines and circuit board elements, using a palette of blues, purples, and oranges.\\n\\n\\n","inReasoning":true,"partType":"text"}\n',

          // Third reasoning text
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Constructing the Architecture**\\n\\nI\'m presently building out the architecture of the infographic. I\'ve broken down \\"Agent Runtime\\" into its core components and I\'m designing the visual relationships between them.  The central engine will be the focal point, with modules for perception, memory, planning, action, and tools radiating outwards. My aim is to illustrate the workflow from input to output clearly. I\'ll utilize arrows to represent the flow of data and instructions between each module.\\n\\n\\n","inReasoning":true,"partType":"text"}\n',

          // First reasoning image
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"/9j/4AAQSkZJRgABAQEBLAEsAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQBiUgnjeAMHrkrk/mMk8k57YpwnCsBtzkcgk+/ONuO3QE4JJ3ccuJ373EbEg5KgDkAg4xtySNrHv14HYm9ne7au7JpLRfm+vn63Emtk9FZWv1t+Ntt9L9Wj//2Q==","inReasoning":true,"mimeType":"image/jpeg","partType":"image"}\n',

          // Fourth reasoning text
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Constructing an Infographic**\\n\\nI\'ve successfully created an infographic depicting an \\"Agent Runtime.\\" The design employs a tech-inspired circuit board aesthetic, placing the core engine at the center. I\'ve clearly represented six essential modules: perception, memory, planning, action, tools, and learning. Arrows and text annotations vividly illustrate the data flow and processing.\\n\\n\\n","inReasoning":true,"partType":"text"}\n',

          // Fifth reasoning text
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"**Defining Agent Runtime Modules**\\n\\nI\'m making progress clarifying the architecture of an \\"Agent Runtime\\" system. I\'ve designed an infographic with a circuit board aesthetic, centered on the core engine. Six key modules are now visualized: perception, memory, planning, action, tools, and learning. I\'ve incorporated arrows and annotations to show data flow effectively.\\n\\n\\n","inReasoning":true,"partType":"text"}\n',

          // Content image (with thoughtSignature but not thought:true)
          'id: chat_1',
          'event: content_part',
          'data: {"content":"/9j/4AAQSkZJRgABAQEBLAEsAAD/2wBDAAEBAQEBAQEBA2Q==","mimeType":"image/jpeg","partType":"image","thoughtSignature":"EueybArjsmwB0e2Kby+QPRkacnmPuV+CqMr6tiey3M5BHLHgIiggQOMeFmnKzsoux6PI6dQMgmdbXE1OTLLcWUmUD1CgFn+C2VdI09FpHrVhxVAtSk/zFVSlsjfCuANxtkP8tCDppVZqIya0QYjzg5K1fEO0m42CZX2/MHyqL8NjzR0lT8ENdoV3RSaK2tXqPH45uIb6nGeBSuX1n2EUMzO"}\n',

          // stop
          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          // usage
          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":9,"outputImageTokens":1120,"outputReasoningTokens":361,"outputTextTokens":238,"totalInputTokens":9,"totalOutputTokens":1719,"totalTokens":1728}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should handle content text and image parts without reasoning', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'This is the description: ',
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
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
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
                      data: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
                    },
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
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: ' an example.',
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
            candidatesTokenCount: 10,
            totalTokenCount: 15,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }],
            candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
          },
          modelVersion: 'gemini-3-pro-image-preview',
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
      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: content_part',
          'data: {"content":"This is the description: ","partType":"text"}\n',

          'id: chat_1',
          'event: content_part',
          'data: {"content":"iVBORw0KGgoAAAANSUhEUgAAAAUA","mimeType":"image/png","partType":"image"}\n',

          'id: chat_1',
          'event: content_part',
          'data: {"content":" an example.","partType":"text"}\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":5,"outputImageTokens":0,"outputTextTokens":10,"totalInputTokens":5,"totalOutputTokens":10,"totalTokens":15}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should handle mixed reasoning and content parts in single chunk', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Analyzing the request...',
                    thought: true,
                  },
                  {
                    text: 'Here is the answer: ',
                  },
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: 'base64data',
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
            candidatesTokenCount: 20,
            totalTokenCount: 30,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }],
            thoughtsTokenCount: 5,
          },
          modelVersion: 'gemini-3-pro-image-preview',
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
      const chunks = await decodeStreamChunks(protocolStream);

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: reasoning_part',
          'data: {"content":"Analyzing the request...","inReasoning":true,"partType":"text"}\n',

          'id: chat_1',
          'event: content_part',
          'data: {"content":"Here is the answer: ","partType":"text"}\n',

          'id: chat_1',
          'event: content_part',
          'data: {"content":"base64data","mimeType":"image/png","partType":"image"}\n',

          'id: chat_1',
          'event: stop',
          'data: "STOP"\n',

          'id: chat_1',
          'event: usage',
          'data: {"inputTextTokens":10,"outputImageTokens":0,"outputReasoningTokens":5,"outputTextTokens":20,"totalInputTokens":10,"totalOutputTokens":25,"totalTokens":30}\n',
        ].map((i) => i + '\n'),
      );
    });

    it('should NOT use multimodal processing if only thoughtsTokenCount is present in metadata but no thought parts', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const data = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello world' }],
                role: 'model',
              },
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 2,
            totalTokenCount: 17,
            thoughtsTokenCount: 5,
          },
          modelVersion: 'gemini-2.5-flash',
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
      const chunks = await decodeStreamChunks(protocolStream);

      // Should use 'text' event, not 'content_part'
      expect(chunks).toContain('event: text\n');
      expect(chunks).not.toContain('event: content_part\n');
    });
  });
});
