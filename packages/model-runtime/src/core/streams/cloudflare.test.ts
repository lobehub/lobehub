// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as desensitizeTool from '../../utils/desensitizeUrl';
import { CloudflareStreamTransformer, desensitizeCloudflareUrl, fillUrl } from './cloudflare';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cloudflareHelpers', () => {
  describe('CloudflareStreamTransformer', () => {
    let transformer: CloudflareStreamTransformer;
    beforeEach(() => {
      transformer = new CloudflareStreamTransformer();
    });

    describe('parseChunk', () => {
      let chunks: string[];
      let controller: TransformStreamDefaultController;

      beforeEach(() => {
        chunks = [];
        controller = Object.create(TransformStreamDefaultController.prototype);
        vi.spyOn(controller, 'enqueue').mockImplementation((chunk) => {
          chunks.push(chunk);
        });
      });

      it('should parse chunk', () => {
        // Arrange
        const chunk = 'data: {"key": "value", "response": "response1"}';
        const textDecoder = new TextDecoder();

        // Act
        transformer['parseChunk'](chunk, controller);

        // Assert
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe('event: text\n');
        expect(chunks[1]).toBe('data: "response1"\n\n');
      });

      it('should not replace `data` in text', () => {
        // Arrange
        const chunk = 'data: {"key": "value", "response": "data: a"}';
        const textDecoder = new TextDecoder();

        // Act
        transformer['parseChunk'](chunk, controller);

        // Assert
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe('event: text\n');
        expect(chunks[1]).toBe('data: "data: a"\n\n');
      });
    });

    describe('transform', () => {
      const textDecoder = new TextDecoder();
      const textEncoder = new TextEncoder();
      let chunks: string[];

      beforeEach(() => {
        chunks = [];
        vi.spyOn(
          transformer as any as {
            parseChunk: (chunk: string, controller: TransformStreamDefaultController) => void;
          },
          'parseChunk',
        ).mockImplementation((chunk: string, _) => {
          chunks.push(chunk);
        });
      });

      it('should split single chunk', async () => {
        // Arrange
        const chunk = textEncoder.encode('data: {"key": "value", "response": "response1"}\n\n');

        // Act
        await transformer.transform(chunk, undefined!);

        // Assert
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toBe('data: {"key": "value", "response": "response1"}');
      });

      it('should split multiple chunks', async () => {
        // Arrange
        const chunk = textEncoder.encode(
          'data: {"key": "value", "response": "response1"}\n\n' +
            'data: {"key": "value", "response": "response2"}\n\n',
        );

        // Act
        await transformer.transform(chunk, undefined!);

        // Assert
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe('data: {"key": "value", "response": "response1"}');
        expect(chunks[1]).toBe('data: {"key": "value", "response": "response2"}');
      });

      it('should ignore empty chunk', async () => {
        // Arrange
        const chunk = textEncoder.encode('\n\n');

        // Act
        await transformer.transform(chunk, undefined!);

        // Assert
        expect(chunks.join()).toBe('');
      });

      it('should split and concat delayed chunks', async () => {
        // Arrange
        const chunk1 = textEncoder.encode('data: {"key": "value", "respo');
        const chunk2 = textEncoder.encode('nse": "response1"}\n\ndata: {"key": "val');
        const chunk3 = textEncoder.encode('ue", "response": "response2"}\n\n');

        // Act & Assert
        await transformer.transform(chunk1, undefined!);
        expect(transformer['parseChunk']).not.toHaveBeenCalled();
        expect(chunks.length).toBe(0);
        expect(transformer['buffer']).toBe('data: {"key": "value", "respo');

        await transformer.transform(chunk2, undefined!);
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toBe('data: {"key": "value", "response": "response1"}');
        expect(transformer['buffer']).toBe('data: {"key": "val');

        await transformer.transform(chunk3, undefined!);
        expect(chunks.length).toBe(2);
        expect(chunks[1]).toBe('data: {"key": "value", "response": "response2"}');
        expect(transformer['buffer']).toBe('');
      });

      it('should ignore standalone [DONE]', async () => {
        // Arrange
        const chunk = textEncoder.encode('data: [DONE]\n\n');

        // Act
        await transformer.transform(chunk, undefined!);

        // Assert
        expect(transformer['parseChunk']).not.toHaveBeenCalled();
        expect(chunks.length).toBe(0);
        expect(transformer['buffer']).toBe('');
      });

      it('should ignore [DONE] in chunk', async () => {
        // Arrange
        const chunk = textEncoder.encode(
          'data: {"key": "value", "response": "response1"}\n\ndata: [DONE]\n\n',
        );

        // Act
        await transformer.transform(chunk, undefined!);

        // Assert
        expect(chunks.length).toBe(1);
        expect(chunks[0]).toBe('data: {"key": "value", "response": "response1"}');
        expect(transformer['buffer']).toBe('');
      });
    });
  });

  describe('fillUrl', () => {
    it('should return URL with account id', () => {
      const url = fillUrl('80009000a000b000c000d000e000f000');
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/80009000a000b000c000d000e000f000/ai/run/',
      );
    });
  });

  describe('maskAccountId', () => {
    describe('desensitizeAccountId', () => {
      it('should replace account id with **** in official API endpoint', () => {
        const url =
          'https://api.cloudflare.com/client/v4/accounts/80009000a000b000c000d000e000f000/ai/run/';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe('https://api.cloudflare.com/client/v4/accounts/****/ai/run/');
      });

      it('should replace account id with **** in custom API endpoint', () => {
        const url =
          'https://api.cloudflare.com/custom/prefix/80009000a000b000c000d000e000f000/custom/suffix/';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe('https://api.cloudflare.com/custom/prefix/****/custom/suffix/');
      });
    });

    describe('desensitizeCloudflareUrl', () => {
      it('should mask account id in official API endpoint', () => {
        const url =
          'https://api.cloudflare.com/client/v4/accounts/80009000a000b000c000d000e000f000/ai/run/';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe('https://api.cloudflare.com/client/v4/accounts/****/ai/run/');
      });

      it('should call desensitizeUrl for custom API endpoint', () => {
        const url = 'https://custom.url/path';
        vi.spyOn(desensitizeTool, 'desensitizeUrl').mockImplementation(
          (_) => 'https://custom.mocked.url',
        );
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(desensitizeTool.desensitizeUrl).toHaveBeenCalledWith('https://custom.url');
        expect(maskedUrl).toBe('https://custom.mocked.url/path');
      });

      it('should mask account id in custom API endpoint', () => {
        const url =
          'https://custom.url/custom/prefix/80009000a000b000c000d000e000f000/custom/suffix/';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe('https://cu****om.url/custom/prefix/****/custom/suffix/');
      });

      it('should mask account id in custom API endpoint with query params', () => {
        const url =
          'https://custom.url/custom/prefix/80009000a000b000c000d000e000f000/custom/suffix/?query=param';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe(
          'https://cu****om.url/custom/prefix/****/custom/suffix/?query=param',
        );
      });

      it('should mask account id in custom API endpoint with port', () => {
        const url =
          'https://custom.url:8080/custom/prefix/80009000a000b000c000d000e000f000/custom/suffix/';
        const maskedUrl = desensitizeCloudflareUrl(url);
        expect(maskedUrl).toBe('https://cu****om.url:****/custom/prefix/****/custom/suffix/');
      });
    });
  });
});
