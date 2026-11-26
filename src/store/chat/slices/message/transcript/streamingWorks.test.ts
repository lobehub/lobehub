import type { UIChatMessage, WorkSummaryItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyStreamingWorks } from './streamingWorks';

const row = (id: string, extra: Partial<UIChatMessage> = {}) =>
  ({ content: '', id, role: 'assistant', updatedAt: 1, ...extra }) as UIChatMessage;

const work = (id: string, versionId: string) =>
  ({ id, version: { id: versionId } }) as unknown as WorkSummaryItem;

const stamped = { work: { rootOperationId: 'localrun_msg_1' } };

describe('applyStreamingWorks', () => {
  it('carries a Work registered mid-run onto the streamed row without its stale content', () => {
    const local = [row('msg_1', { content: 'streamed so far' }), row('msg_2')];
    const incoming = [
      row('msg_1', { content: 'lagging db', metadata: stamped, works: [work('wk_1', 'v1')] }),
    ];

    const merged = applyStreamingWorks(local, incoming);

    expect(merged[0]).toMatchObject({
      content: 'streamed so far',
      metadata: stamped,
      works: [work('wk_1', 'v1')],
    });
    expect(merged[1]).toBe(local[1]);
  });

  // The transcript sync drops a streaming fetch whose merge returns the same array.
  it('keeps the local array when the rows already show those Works', () => {
    const local = [row('msg_1', { metadata: stamped, works: [work('wk_1', 'v1')] })];
    const incoming = [row('msg_1', { metadata: stamped, works: [work('wk_1', 'v1')] })];

    expect(applyStreamingWorks(local, incoming)).toBe(local);
  });

  it('takes a newer Work version', () => {
    const local = [row('msg_1', { metadata: stamped, works: [work('wk_1', 'v1')] })];
    const incoming = [row('msg_1', { metadata: stamped, works: [work('wk_1', 'v2')] })];

    expect(applyStreamingWorks(local, incoming)[0].works).toEqual([work('wk_1', 'v2')]);
  });
});
