import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAgentInput } from './buildAgentInput';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x10]);

describe('buildAgentInput', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'build-agent-input-'));
  });

  afterEach(async () => {
    await rm(tmp, { force: true, recursive: true });
    vi.restoreAllMocks();
  });

  describe('claude-code', () => {
    it('wraps a plain-string prompt as a single text block in stream-json', async () => {
      const plan = await buildAgentInput('claude-code', 'hello world');
      expect(plan.args).toEqual([]);
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg).toEqual({
        message: { content: [{ text: 'hello world', type: 'text' }], role: 'user' },
        type: 'user',
      });
    });

    it('preserves user-specified content-block order', async () => {
      const plan = await buildAgentInput('claude-code', [
        {
          source: { data: PNG_BYTES.toString('base64'), mediaType: 'image/png', type: 'base64' },
          type: 'image',
        },
        { text: 'after', type: 'text' },
      ]);
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content.map((b: any) => b.type)).toEqual(['image', 'text']);
    });

    it('inlines base64 image bytes with the correct media_type field', async () => {
      const plan = await buildAgentInput('claude-code', [
        { text: 'see', type: 'text' },
        {
          source: { data: PNG_BYTES.toString('base64'), mediaType: 'image/png', type: 'base64' },
          type: 'image',
        },
      ]);
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[1]).toEqual({
        source: {
          data: PNG_BYTES.toString('base64'),
          media_type: 'image/png',
          type: 'base64',
        },
        type: 'image',
      });
    });

    it('reads a path source from disk and inlines as base64', async () => {
      const filePath = path.join(tmp, 'fixture.png');
      await writeFile(filePath, PNG_BYTES);

      const plan = await buildAgentInput('claude-code', [
        { source: { path: filePath, type: 'path' }, type: 'image' },
      ]);
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[0]).toEqual({
        source: {
          data: PNG_BYTES.toString('base64'),
          media_type: 'image/png',
          type: 'base64',
        },
        type: 'image',
      });
    });

    it('falls back to byte sniffing when the URL response Content-Type is generic (octet-stream)', async () => {
      // CDNs / object stores commonly default to application/octet-stream when
      // they strip the original Content-Type. Trusting that header verbatim
      // would serialize `media_type: "application/octet-stream"` into stream-
      // json, which Claude API rejects — sniff the bytes instead.
      const fetcher = vi.fn(
        async () =>
          new Response(PNG_BYTES, {
            headers: { 'content-type': 'application/octet-stream' },
            status: 200,
          }),
      ) as unknown as typeof fetch;

      const plan = await buildAgentInput(
        'claude-code',
        [{ source: { type: 'url', url: 'https://x/y' }, type: 'image' }],
        { fetcher },
      );
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[0].source.media_type).toBe('image/png');
    });

    it('upgrades a base64 source declared as octet-stream to its sniffed image type', async () => {
      const plan = await buildAgentInput('claude-code', [
        {
          source: {
            data: PNG_BYTES.toString('base64'),
            mediaType: 'application/octet-stream',
            type: 'base64',
          },
          type: 'image',
        },
      ]);
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[0].source.media_type).toBe('image/png');
    });

    it('prefers the URL extension hint over a generic Content-Type header', async () => {
      const fetcher = vi.fn(
        async () =>
          // No content-type at all + bytes are unrecognized — but URL has .jpg.
          new Response(Buffer.from('garbage'), {
            headers: { 'content-type': 'application/octet-stream' },
            status: 200,
          }),
      ) as unknown as typeof fetch;

      const plan = await buildAgentInput(
        'claude-code',
        [{ source: { type: 'url', url: 'https://x/photo.jpg' }, type: 'image' }],
        { fetcher },
      );
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[0].source.media_type).toBe('image/jpeg');
    });

    it('fetches a URL via the injected fetcher and caches the bytes when cacheDir is set', async () => {
      const fetcher = vi.fn(
        async () =>
          new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' }, status: 200 }),
      ) as unknown as typeof fetch;

      const plan = await buildAgentInput(
        'claude-code',
        [{ source: { id: 'img-1', type: 'url', url: 'https://x/y.png' }, type: 'image' }],
        { cacheDir: tmp, fetcher },
      );
      const msg = JSON.parse(plan.stdin.trim());
      expect(msg.message.content[0].source.data).toBe(PNG_BYTES.toString('base64'));
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Second call hits the disk cache → fetcher must not be invoked again.
      await buildAgentInput(
        'claude-code',
        [{ source: { id: 'img-1', type: 'url', url: 'https://x/y.png' }, type: 'image' }],
        { cacheDir: tmp, fetcher },
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('codex', () => {
    it('puts text on stdin and emits no --image flags when there are no images', async () => {
      const plan = await buildAgentInput('codex', 'just text');
      expect(plan.stdin).toBe('just text');
      expect(plan.args).toEqual([]);
    });

    it('joins multiple text blocks with double newlines on stdin', async () => {
      const plan = await buildAgentInput('codex', [
        { text: 'first', type: 'text' },
        { text: 'second', type: 'text' },
      ]);
      expect(plan.stdin).toBe('first\n\nsecond');
    });

    it('materializes base64 images into cacheDir and emits --image <path> per image', async () => {
      const plan = await buildAgentInput(
        'codex',
        [
          { text: 'inspect', type: 'text' },
          {
            source: { data: PNG_BYTES.toString('base64'), mediaType: 'image/png', type: 'base64' },
            type: 'image',
          },
        ],
        { cacheDir: tmp },
      );

      expect(plan.stdin).toBe('inspect');
      expect(plan.args[0]).toBe('--image');
      const imagePath = plan.args[1]!;
      expect(imagePath.startsWith(tmp)).toBe(true);
      expect(imagePath.endsWith('.png')).toBe(true);
      const written = await readFile(imagePath);
      expect(written.equals(PNG_BYTES)).toBe(true);
    });

    it('passes a path-source image straight through without re-materializing', async () => {
      const filePath = path.join(tmp, 'on-disk.png');
      await writeFile(filePath, PNG_BYTES);

      const plan = await buildAgentInput(
        'codex',
        [{ source: { path: filePath, type: 'path' }, type: 'image' }],
        { cacheDir: tmp },
      );
      expect(plan.args).toEqual(['--image', filePath]);
    });
  });

  it('throws on unknown agent types', async () => {
    await expect(buildAgentInput('kimi-cli', 'hi')).rejects.toThrow(/unsupported agent type/);
  });
});
