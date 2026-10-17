import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { MessageContentProcessor } from '../MessageContent';

const createContext = (messages: UIChatMessage[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  isAborted: false,
  messages,
  metadata: { maxTokens: 100000, model: 'muse-wonder-1.0', provider: 'lobehub' },
});

const createProcessor = () =>
  new MessageContentProcessor({
    fileContext: { enabled: false },
    isCanUseVision: () => true,
    model: 'muse-wonder-1.0',
    provider: 'lobehub',
  });

const createUserMessage = (imageList: UIChatMessage['imageList']): UIChatMessage => ({
  content: 'Animate this',
  createdAt: Date.now(),
  id: 'msg-1',
  imageList,
  role: 'user',
  updatedAt: Date.now(),
});

describe('MessageContentProcessor unsupported image formats', () => {
  it('keeps an uploaded SVG out of image_url parts for a vision model', async () => {
    const result = await createProcessor().process(
      createContext([
        createUserMessage([
          {
            alt: 'Group 2.svg',
            id: 'file-svg',
            mimeType: 'image/svg+xml',
            url: 'https://example.com/group.svg',
          },
          {
            alt: 'photo.png',
            id: 'file-png',
            mimeType: 'image/png',
            url: 'https://example.com/photo.png',
          },
        ]),
      ]),
    );

    const content = result.messages[0].content as any[];
    expect(content.filter((part) => part.type === 'image_url')).toEqual([
      { image_url: { detail: 'auto', url: 'https://example.com/photo.png' }, type: 'image_url' },
    ]);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('image/svg+xml is not a supported vision input format');
  });

  it('downgrades an inline SVG data URI to text only', async () => {
    const result = await createProcessor().process(
      createContext([
        createUserMessage([
          { alt: 'inline.svg', id: 'file-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+' },
        ]),
      ]),
    );

    // Only text remains, so the processor collapses content to a plain string.
    expect(result.messages[0].content).toBe(
      'Animate this\n\n[image omitted: image/svg+xml is not a supported vision input format. Do not infer or describe the image. If the request depends on it, read the attached file with an available tool.]',
    );
  });

  it('keeps provider-specific and unknown image types for the provider to decide', async () => {
    const result = await createProcessor().process(
      createContext([
        createUserMessage([
          {
            alt: 'photo.heic',
            id: 'file-heic',
            mimeType: 'image/heic',
            url: 'https://example.com/photo.heic',
          },
          { alt: 'legacy', id: 'file-legacy', url: 'https://example.com/a' },
        ]),
      ]),
    );

    const content = result.messages[0].content as any[];
    expect(content).toEqual([
      { text: 'Animate this', type: 'text' },
      { image_url: { detail: 'auto', url: 'https://example.com/photo.heic' }, type: 'image_url' },
      { image_url: { detail: 'auto', url: 'https://example.com/a' }, type: 'image_url' },
    ]);
  });
});
