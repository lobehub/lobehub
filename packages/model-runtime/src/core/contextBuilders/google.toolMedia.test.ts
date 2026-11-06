// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage } from '../../types';
import * as imageToBase64Module from '../../utils/imageToBase64';
import type * as UriParser from '../../utils/uriParser';
import { buildGoogleMessages, GEMINI_MAGIC_THOUGHT_SIGNATURE } from './google';

vi.mock('../../utils/uriParser', async (importOriginal) => ({
  ...(await importOriginal<typeof UriParser>()),
  isPublicExternalUrl: vi.fn().mockReturnValue(false),
  validateExternalUrl: vi.fn().mockResolvedValue({ isValid: false, reason: 'mocked' }),
}));

vi.mock('../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

const readFileCall = (id: string, path: string) => ({
  function: { arguments: JSON.stringify({ path }), name: 'lobe-local-system____readFile' },
  id,
  type: 'function' as const,
});

const imageToolResult = (id: string, filename: string, url: string): OpenAIChatMessage => ({
  content: [
    { text: `[Image: ${filename}]`, type: 'text' },
    { image_url: { detail: 'auto', url }, type: 'image_url' },
  ],
  name: 'lobe-local-system____readFile',
  role: 'tool',
  tool_call_id: id,
});

describe('buildGoogleMessages tool media', () => {
  beforeEach(() => {
    vi.mocked(imageToBase64Module.imageUrlToBase64).mockResolvedValue({
      base64: PNG_BASE64,
      mimeType: 'image/png',
    });
  });

  it('sends readFile images as inline parts instead of URL text in the functionResponse', async () => {
    const contents = await buildGoogleMessages(
      [
        { content: 'What is in the images?', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            readFileCall('call_1', '/tmp/image1.png'),
            readFileCall('call_2', '/tmp/image2.png'),
          ],
        },
        imageToolResult('call_1', 'image1.png', 'https://app.lobehub.com/f/file_1'),
        imageToolResult('call_2', 'image2.png', 'https://app.lobehub.com/f/file_2'),
      ],
      { model: 'gemini-3.8-flash' },
    );

    expect(contents).toHaveLength(3);
    expect(contents[2]).toEqual({
      parts: [
        {
          functionResponse: {
            id: 'call_1',
            name: 'lobe-local-system____readFile',
            response: { result: '[Image: image1.png]' },
          },
        },
        {
          functionResponse: {
            id: 'call_2',
            name: 'lobe-local-system____readFile',
            response: { result: '[Image: image2.png]' },
          },
        },
        {
          text: 'Media output of tool call call_1 (lobe-local-system____readFile):',
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        },
        {
          inlineData: { data: PNG_BASE64, mimeType: 'image/png' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        },
        {
          text: 'Media output of tool call call_2 (lobe-local-system____readFile):',
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        },
        {
          inlineData: { data: PNG_BASE64, mimeType: 'image/png' },
          thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
        },
      ],
      role: 'user',
    });
    expect(JSON.stringify(contents[2].parts?.[0].functionResponse)).not.toContain('image_url');
    expect(imageToBase64Module.imageUrlToBase64).toHaveBeenCalledWith(
      'https://app.lobehub.com/f/file_1',
    );
  });

  it('keeps text-only tool results unchanged', async () => {
    const contents = await buildGoogleMessages([
      { content: 'Read it', role: 'user' },
      { content: '', role: 'assistant', tool_calls: [readFileCall('call_1', '/tmp/a.txt')] },
      {
        content: 'file body',
        name: 'lobe-local-system____readFile',
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ]);

    expect(contents[2].parts).toEqual([
      {
        functionResponse: {
          id: undefined,
          name: 'lobe-local-system____readFile',
          response: { result: 'file body' },
        },
      },
    ]);
  });

  it('degrades an unreachable tool image to a note instead of failing the request', async () => {
    vi.mocked(imageToBase64Module.imageUrlToBase64).mockRejectedValueOnce(
      new Error('fetch failed'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const contents = await buildGoogleMessages([
      { content: 'Look', role: 'user' },
      { content: '', role: 'assistant', tool_calls: [readFileCall('call_1', '/tmp/a.png')] },
      imageToolResult('call_1', 'a.png', 'https://app.lobehub.com/f/file_gone'),
    ]);

    expect(contents[2].parts).toEqual([
      {
        functionResponse: {
          id: undefined,
          name: 'lobe-local-system____readFile',
          response: { result: '[Image: a.png]\n\n[image unavailable: fetch failed]' },
        },
      },
    ]);
    warn.mockRestore();
  });

  it('notes an unsupported tool image instead of claiming it is attached', async () => {
    const contents = await buildGoogleMessages([
      { content: 'Look', role: 'user' },
      { content: '', role: 'assistant', tool_calls: [readFileCall('call_1', '/tmp/a.svg')] },
      {
        content: [{ image_url: { url: 'data:image/svg+xml;base64,PHN2Zy8+' }, type: 'image_url' }],
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ]);

    expect(contents[2].parts).toHaveLength(1);
    expect(contents[2].parts?.[0].functionResponse?.response).toEqual({
      result: '[image unavailable: unsupported format]',
    });
  });

  it('labels a media-only tool result so the model ties the media to the call', async () => {
    const contents = await buildGoogleMessages([
      { content: 'Shoot', role: 'user' },
      { content: '', role: 'assistant', tool_calls: [readFileCall('call_1', '/tmp/a.png')] },
      {
        content: [{ image_url: { url: `data:image/png;base64,${PNG_BASE64}` }, type: 'image_url' }],
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ]);

    expect(contents[2].parts?.[0].functionResponse?.response).toEqual({
      result: '[Media output attached below]',
    });
    expect(contents[2].parts?.at(-1)).toEqual({
      inlineData: { data: PNG_BASE64, mimeType: 'image/png' },
      thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
    });
  });
});
