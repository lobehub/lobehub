// @vitest-environment node
import type { GenerateContentResponse } from '@google/genai';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_ERROR_KEY } from '../../core/streams';
import { AgentRuntimeErrorType } from '../../types/error';
import * as debugStreamModule from '../../utils/debugStream';
import { LobeGoogleAI } from './index';

const provider = 'google';
const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeGoogleAI;

beforeEach(() => {
  instance = new LobeGoogleAI({ apiKey: 'test' });

  // Use vi.spyOn to mock the chat.completions.create method
  const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
  vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeGoogleAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const instance = new LobeGoogleAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeGoogleAI);

      // expect(instance.baseURL).toEqual(defaultBaseURL);
    });
  });

  describe('chat', () => {
    it('should return a StreamingTextResponse on successful API call', async () => {
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });
    it('should handle text messages correctly', async () => {
      // Mock Google AI SDK's generateContentStream method to return a successful response stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );

      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      expect(result).toBeInstanceOf(Response);
      // Additional assertions can be added, such as verifying the returned stream content
    });

    it('should withGrounding', () => {
      const data = [
        {
          candidates: [{ content: { parts: [{ text: 'As' }], role: 'model' } }],
          usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
          modelVersion: 'gemini-2.0-flash',
        },
        {
          candidates: [
            {
              content: { parts: [{ text: ' of February 22, 2025, "Ne Zha ' }], role: 'model' },
              safetyRatings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'MEDIUM' },
                { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
              ],
            },
          ],
          usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
          modelVersion: 'gemini-2.0-flash',
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: '2" has grossed the following:\n\n*   **Worldwide:** $1' }],
                role: 'model',
              },
              safetyRatings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
              ],
            },
          ],
          usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
          modelVersion: 'gemini-2.0-flash',
        },
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '.66 billion\n*   **China:** $1.82 billion (CN¥12.35 billion)\n*   **US &',
                  },
                ],
                role: 'model',
              },
              safetyRatings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
              ],
            },
          ],
          usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
          modelVersion: 'gemini-2.0-flash',
        },
        {
          candidates: [
            {
              content: { parts: [{ text: ' Canada:** $24,744,753\n' }], role: 'model' },
              finishReason: 'STOP',
              safetyRatings: [
                { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', probability: 'NEGLIGIBLE' },
              ],
              groundingMetadata: {
                searchEntryPoint: {
                  renderedContent:
                    '<style>\n.container {\n  align-items: center;\n  border-radius: 8px;\n  display: flex;\n  font-family: Google Sans, Roboto, sans-serif;\n  font-size: 14px;\n  line-height: 20px;\n  padding: 8px 12px;\n}\n.chip {\n  display: inline-block;\n  border: solid 1px;\n  border-radius: 16px;\n  min-width: 14px;\n  padding: 5px 16px;\n  text-align: center;\n  user-select: none;\n  margin: 0 8px;\n  -webkit-tap-highlight-color: transparent;\n}\n.carousel {\n  overflow: auto;\n  scrollbar-width: none;\n  white-space: nowrap;\n  margin-right: -12px;\n}\n.headline {\n  display: flex;\n  margin-right: 4px;\n}\n.gradient-container {\n  position: relative;\n}\n.gradient {\n  position: absolute;\n  transform: translate(3px, -9px);\n  height: 36px;\n  width: 9px;\n}\n@media (prefers-color-scheme: light) {\n  .container {\n    background-color: #fafafa;\n    box-shadow: 0 0 0 1px #0000000f;\n  }\n  .headline-label {\n    color: #1f1f1f;\n  }\n  .chip {\n    background-color: #ffffff;\n    border-color: #d2d2d2;\n    color: #5e5e5e;\n    text-decoration: none;\n  }\n  .chip:hover {\n    background-color: #f2f2f2;\n  }\n  .chip:focus {\n    background-color: #f2f2f2;\n  }\n  .chip:active {\n    background-color: #d8d8d8;\n    border-color: #b6b6b6;\n  }\n  .logo-dark {\n    display: none;\n  }\n  .gradient {\n    background: linear-gradient(90deg, #fafafa 15%, #fafafa00 100%);\n  }\n}\n@media (prefers-color-scheme: dark) {\n  .container {\n    background-color: #1f1f1f;\n    box-shadow: 0 0 0 1px #ffffff26;\n  }\n  .headline-label {\n    color: #fff;\n  }\n  .chip {\n    background-color: #2c2c2c;\n    border-color: #3c4043;\n    color: #fff;\n    text-decoration: none;\n  }\n  .chip:hover {\n    background-color: #353536;\n  }\n  .chip:focus {\n    background-color: #353536;\n  }\n  .chip:active {\n    background-color: #464849;\n    border-color: #53575b;\n  }\n  .logo-light {\n    display: none;\n  }\n  .gradient {\n    background: linear-gradient(90deg, #1f1f1f 15%, #1f1f1f00 100%);\n  }\n}\n</style>\n<div class="container">\n  <div class="headline">\n    <svg class="logo-light" width="18" height="18" viewBox="9 9 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">\n      <path fill-rule="evenodd" clip-rule="evenodd" d="M42.8622 27.0064C42.8622 25.7839 42.7525 24.6084 42.5487 23.4799H26.3109V30.1568H35.5897C35.1821 32.3041 33.9596 34.1222 32.1258 35.3448V39.6864H37.7213C40.9814 36.677 42.8622 32.2571 42.8622 27.0064V27.0064Z" fill="#4285F4"/>\n      <path fill-rule="evenodd" clip-rule="evenodd" d="M26.3109 43.8555C30.9659 43.8555 34.8687 42.3195 37.7213 39.6863L32.1258 35.3447C30.5898 36.3792 28.6306 37.0061 26.3109 37.0061C21.8282 37.0061 18.0195 33.9811 16.6559 29.906H10.9194V34.3573C13.7563 39.9841 19.5712 43.8555 26.3109 43.8555V43.8555Z" fill="#34A853"/>\n      <path fill-rule="evenodd" clip-rule="evenodd" d="M16.6559 29.8904C16.3111 28.8559 16.1074 27.7588 16.1074 26.6146C16.1074 25.4704 16.3111 24.3733 16.6559 23.3388V18.8875H10.9194C9.74388 21.2072 9.06992 23.8247 9.06992 26.6146C9.06992 29.4045 9.74388 32.022 10.9194 34.3417L15.3864 30.8621L16.6559 29.8904V29.8904Z" fill="#FBBC05"/>\n      <path fill-rule="evenodd" clip-rule="evenodd" d="M26.3109 16.2386C28.85 16.2386 31.107 17.1164 32.9095 18.8091L37.8466 13.8719C34.853 11.082 30.9659 9.3736 26.3109 9.3736C19.5712 9.3736 13.7563 13.245 10.9194 18.8875L16.6559 23.3388C18.0195 19.2636 21.8282 16.2386 26.3109 16.2386V16.2386Z" fill="#EA4335"/>\n    </svg>\n    <svg class="logo-dark" width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">\n      <circle cx="24" cy="23" fill="#FFF" r="22"/>\n      <path d="M33.76 34.26c2.75-2.56 4.49-6.37 4.49-11.26 0-.89-.08-1.84-.29-3H24.01v5.99h8.03c-.4 2.02-1.5 3.56-3.07 4.56v.75l3.91 2.97h.88z" fill="#4285F4"/>\n      <path d="M15.58 25.77A8.845 8.845 0 0 0 24 31.86c1.92 0 3.62-.46 4.97-1.31l4.79 3.71C31.14 36.7 27.65 38 24 38c-5.93 0-11.01-3.4-13.45-8.36l.17-1.01 4.06-2.85h.8z" fill="#34A853"/>\n      <path d="M15.59 20.21a8.864 8.864 0 0 0 0 5.58l-5.03 3.86c-.98-2-1.53-4.25-1.53-6.64 0-2.39.55-4.64 1.53-6.64l1-.22 3.81 2.98.22 1.08z" fill="#FBBC05"/>\n      <path d="M24 14.14c2.11 0 4.02.75 5.52 1.98l4.36-4.36C31.22 9.43 27.81 8 24 8c-5.93 0-11.01 3.4-13.45 8.36l5.03 3.85A8.86 8.86 0 0 1 24 14.14z" fill="#EA4335"/>\n    </svg>\n    <div class="gradient-container"><div class="gradient"></div></div>\n  </div>\n  <div class="carousel">\n    <a class="chip" href="https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQXblrycKK-4Q61T9-BeH_jYKcMfCwyI0-TGMMzPcvZuXVtBjnsxXJkWcxxay0giciDNQ5g4dfD8SdUuBIlBLFQE7Fuc8e50WZuKO9u3HVjQXMznQxtzcQ4fHUn1lDlsvKiurKnD-G-Sl6s7_8h3JNMJSsObKg79sP0vQ_f9N7ib5s3tuF35FglH1NLaiTvdpM1DVhaHZc2In94_hV3W-_k=">Nezha Reborn 2 box office</a>\n  </div>\n</div>\n',
                },
                groundingChunks: [
                  {
                    web: {
                      uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQXblrz3Up-UZrEsLlT8zPkpwbakcjDZbojH5RuXL0HAa_0rHfG1WE5h6jADFSzcMxKNZcit_n7OaxnTvZNjp9WFL4NNJmjkqQRJoK_XdeVsnbshWJpm9TJL7KNNwzAl254th8cHxTsQIOPoNxsnrXeebIlMDVb8OuFWfCWUToiRxhv1_Vo=',
                      title: 'screenrant.com',
                    },
                  },
                  {
                    web: {
                      uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQXblry4I3hWcwVL-mI75BJYSy72Lb97KF50N2p5PWvH8vuLQQgekFmlw9PDiJ3KouByidcMsja_7IJ3F1S0PguLC0r_uxbcAGfFvJzbiMNdWOhQ7xDSJqObd_mCUa-VFpYzm6cd',
                      title: 'imdb.com',
                    },
                  },
                ],
                groundingSupports: [
                  {
                    segment: {
                      startIndex: 64,
                      endIndex: 96,
                      text: '*   **Worldwide:** $1.66 billion',
                    },
                    groundingChunkIndices: [0],
                    confidenceScores: [0.95218265],
                  },
                  {
                    segment: {
                      startIndex: 146,
                      endIndex: 178,
                      text: '*   **US & Canada:** $24,744,753',
                    },
                    groundingChunkIndices: [1],
                    confidenceScores: [0.7182074],
                  },
                ],
                retrievalMetadata: {},
                webSearchQueries: ['Nezha Reborn 2 box office'],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 79,
            totalTokenCount: 86,
            promptTokensDetails: [{ modality: 'TEXT', tokenCount: 7 }],
            candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 79 }],
          },
          modelVersion: 'gemini-2.0-flash',
        },
      ];
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });

      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );
    });

    it('should call debugStream in DEBUG mode', async () => {
      // Set environment variable to enable DEBUG mode
      process.env.DEBUG_GOOGLE_CHAT_COMPLETION = '1';

      // Mock Google AI SDK's generateContentStream method to return a successful response stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Debug mode test');
          controller.close();
        },
      });
      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );
      const debugStreamSpy = vi
        .spyOn(debugStreamModule, 'debugStream')
        .mockImplementation(() => Promise.resolve());

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      expect(debugStreamSpy).toHaveBeenCalled();

      // Clean up environment variable
      delete process.env.DEBUG_GOOGLE_CHAT_COMPLETION;
    });

    describe('Error', () => {
      it('should throw InvalidGoogleAPIKey error on API_KEY_INVALID error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType, error: { message }, provider });
        }
      });

      it('should throw LocationNotSupportError error on location not support error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] User location is not supported for the API use.`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({ errorType: 'LocationNotSupportError', error: { message }, provider });
        }
      });

      it('should throw BizError error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            error: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                'domain': 'googleapis.com',
                'metadata': {
                  service: 'generativelanguage.googleapis.com',
                },
                'reason': 'Error',
              },
            ],
            provider,
          });
        }
      });

      it('should throw DefaultError error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            error: {
              message: `API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com}}]`,
              statusCode: 400,
              statusCodeText: '[400 Bad Request]',
            },
            provider,
          });
        }
      });

      it('should return GoogleBizError with an openai error response when APIError is thrown', async () => {
        // Arrange
        const apiError = new Error('Error message');

        // Use vi.spyOn to mock the chat.completions.create method
        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            error: { message: 'Error message' },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should throw AgentRuntimeError with NoOpenAIAPIKey if no apiKey is provided', async () => {
        try {
          new LobeGoogleAI({});
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });

      it('should return OpenAIBizError with the cause when OpenAI.APIError is thrown with cause', async () => {
        // Arrange
        const errorInfo = {
          stack: 'abc',
          cause: {
            message: 'api is undefined',
          },
        };
        const apiError = new OpenAI.APIError(400, errorInfo, 'module error', {});

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            error: {
              message: `400 {"stack":"abc","cause":{"message":"api is undefined"}}`,
            },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should return AgentRuntimeError for non-OpenAI errors', async () => {
        // Arrange
        const genericError = new Error('Generic Error');

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(
          genericError,
        );

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            provider,
            error: {
              message: 'Generic Error',
            },
          });
        }
      });
    });
  });

  describe('private method', () => {
    describe('createEnhancedStream', () => {
      it('should handle stream cancellation with data gracefully', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          yield { text: ' world' };
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then cancel to trigger error chunk
        chunks.push((await reader.read()).value);
        abortController.abort();

        // Read all remaining chunks
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        // Batch-assert the entire chunks array
        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { name: 'Stream cancelled', provider, reason: 'aborted' },
              message: 'Stream cancelled',
              name: 'Stream cancelled',
              type: AgentRuntimeErrorType.StreamChunkError,
            },
          },
        ]);
      });

      it('should handle stream cancellation without data', async () => {
        const mockStream = (async function* () {
          // Empty stream
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();

        // Cancel immediately
        abortController.abort();

        // Should be closed without any chunks
        const chunk = await reader.read();
        expect(chunk.done).toBe(true);
      });

      it('should handle AbortError with data', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          throw new Error('aborted');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then collect remaining chunks (error included)
        chunks.push((await reader.read()).value);
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        // Assert both data and error chunk together
        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { name: 'Stream cancelled', provider, reason: 'aborted' },
              message: 'Stream cancelled',
              name: 'Stream cancelled',
              type: AgentRuntimeErrorType.StreamChunkError,
            },
          },
        ]);
      });

      it('should handle AbortError without data', async () => {
        const mockStream = (async function* () {
          throw new Error('aborted');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read error chunk
        const chunk1 = await reader.read();
        chunks.push(chunk1.value);

        // Stream should be closed
        const chunk2 = await reader.read();
        expect(chunk2.done).toBe(true);

        expect(chunks[0][LOBE_ERROR_KEY]).toEqual({
          body: {
            message: 'aborted',
            name: 'AbortError',
            provider,
            stack: expect.any(String),
          },
          message: 'aborted',
          name: 'AbortError',
          type: AgentRuntimeErrorType.StreamChunkError,
        });
      });

      it('should handle other stream parsing errors', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          throw new Error('Network error');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then collect remaining chunks (parsing error)
        chunks.push((await reader.read()).value);
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { message: 'Network error', provider },
              message: 'Network error',
              name: 'Stream parsing error',
              type: AgentRuntimeErrorType.ProviderBizError,
            },
          },
        ]);
      });
    });
  });
});

describe('thinkingConfig includeThoughts logic', () => {
  it('should enable thinking when thinkingBudget is set', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.5-pro',
      thinkingBudget: 5000,
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should enable thinking when thinkingLevel is set', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro',
      thinkingLevel: 'high',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should enable thinking for gemini-3-pro-image models', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro-image-preview',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should enable thinking for thinking-enabled models', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.0-flash-thinking-exp',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should disable thinking when resolvedThinkingBudget is 0', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.5-flash-lite',
      thinkingBudget: 0,
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBeUndefined();
  });

  it('should add thinkingLevel to config for 3.x models when provided', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro',
      thinkingLevel: 'high',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.thinkingConfig?.thinkingLevel).toBe('high');
  });
});
