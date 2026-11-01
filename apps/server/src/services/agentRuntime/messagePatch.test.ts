import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildMessagePatch, buildProjectedMessagePatch } from './messagePatch';

const message = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 1, id, role: 'assistant', updatedAt: 1 }) as UIChatMessage;

describe('buildMessagePatch', () => {
  it('emits only changed and appended rows with canonical anchors', () => {
    const before = [message('a', 'same'), message('b', 'old')];
    const after = [message('a', 'same'), message('b', 'new'), message('c', 'created')];

    expect(buildMessagePatch(before, after, 4)).toEqual({
      deletes: [],
      revision: 4,
      upserts: [
        { afterId: 'a', message: after[1] },
        { afterId: 'b', message: after[2] },
      ],
    });
  });

  it('emits deleted top-level envelopes', () => {
    expect(
      buildMessagePatch([message('a', 'a'), message('b', 'b')], [message('b', 'b')], 2),
    ).toEqual({
      deletes: ['a'],
      revision: 2,
      upserts: [],
    });
  });

  it('treats a changed nested envelope as one atomic upsert', () => {
    const before = [{ ...message('group', ''), compressedMessages: [message('a', 'old')] }];
    const after = [{ ...message('group', ''), compressedMessages: [message('a', 'new')] }];

    expect(buildMessagePatch(before, after, 1).upserts).toEqual([
      { afterId: null, message: after[0] },
    ]);
  });
});

describe('buildProjectedMessagePatch', () => {
  const toolRow = (id: string, content: string): UIChatMessage =>
    ({
      content,
      createdAt: 1,
      id,
      plugin: { apiName: 'crawlSinglePage', arguments: '{}', identifier: 'lobe-web-browsing' },
      pluginState: { results: [] },
      role: 'tool',
      updatedAt: 1,
    }) as UIChatMessage;

  it('ships the view model, not the stored tool body', () => {
    const { upserts } = buildProjectedMessagePatch(
      [],
      [toolRow('t1', 'THE WHOLE CRAWLED PAGE')],
      1,
    );

    expect(upserts).toHaveLength(1);
    expect(upserts[0].message.content).not.toContain('THE WHOLE CRAWLED PAGE');
    expect(upserts[0].message.payloadOmitted).toBeDefined();
    // The row still reads as "returned something" for the status icon.
    expect(upserts[0].message.contentLength).toBe('THE WHOLE CRAWLED PAGE'.length);
  });

  it('does not resend a row whose only change is projected away', () => {
    // Both bodies collapse to the same view model, so the diff must compare the
    // projected forms — otherwise every step reships a settled tool row.
    const patch = buildProjectedMessagePatch(
      [toolRow('t1', 'first body')],
      [toolRow('t1', 'first body')],
      2,
    );

    expect(patch.upserts).toEqual([]);
    expect(patch.deletes).toEqual([]);
  });
});
