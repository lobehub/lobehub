import { describe, expect, it } from 'vitest';

import { buildHeteroExecStdinPayload } from './execStdinPayload';

describe('buildHeteroExecStdinPayload', () => {
  it('returns a plain JSON string when no systemContext or images', () => {
    const payload = buildHeteroExecStdinPayload({ prompt: 'hello' });
    expect(payload).toBe(JSON.stringify('hello'));
    expect(JSON.parse(payload)).toBe('hello');
  });

  it('builds a content-block array with systemContext first', () => {
    const payload = buildHeteroExecStdinPayload({ prompt: 'hello', systemContext: 'ctx' });
    expect(JSON.parse(payload)).toEqual([
      { text: 'ctx', type: 'text' },
      { text: 'hello', type: 'text' },
    ]);
  });

  it('appends image blocks after the prompt', () => {
    const payload = buildHeteroExecStdinPayload({
      imageList: [{ id: 'file-1', url: 'https://x/a.png' }],
      prompt: 'look at this',
    });
    expect(JSON.parse(payload)).toEqual([
      { text: 'look at this', type: 'text' },
      { source: { id: 'file-1', type: 'url', url: 'https://x/a.png' }, type: 'image' },
    ]);
  });

  it('orders systemContext, prompt, then images', () => {
    const payload = buildHeteroExecStdinPayload({
      imageList: [{ id: 'file-1', url: 'https://x/a.png' }, { url: 'https://x/b.jpg' }],
      prompt: 'compare these',
      systemContext: 'ctx',
    });
    expect(JSON.parse(payload)).toEqual([
      { text: 'ctx', type: 'text' },
      { text: 'compare these', type: 'text' },
      { source: { id: 'file-1', type: 'url', url: 'https://x/a.png' }, type: 'image' },
      { source: { type: 'url', url: 'https://x/b.jpg' }, type: 'image' },
    ]);
  });

  it('treats an empty imageList like no images', () => {
    const payload = buildHeteroExecStdinPayload({ imageList: [], prompt: 'hello' });
    expect(payload).toBe(JSON.stringify('hello'));
  });

  it('runs referenced topics through the shared prompt engine', () => {
    const payload = buildHeteroExecStdinPayload({
      prompt: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
    });

    expect(JSON.parse(payload)).toEqual([
      expect.objectContaining({ text: expect.stringContaining('`lh topic view <topic-id>`') }),
      {
        text: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
        type: 'text',
      },
    ]);
  });
});
