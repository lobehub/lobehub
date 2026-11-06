import { describe, expect, it } from 'vitest';

import { type ChatStoreState } from '@/store/chat';

import { PortalViewType } from '../initialState';
import { portalThreadSelectors } from './thread';

const state = (partial: Partial<ChatStoreState>) =>
  ({ portalStack: [], threadMaps: {}, ...partial }) as unknown as ChatStoreState;

describe('portalThreadSelectors.isPortalThreadKeptOnTopic', () => {
  it("drops a thread another topic's list holds", () => {
    const s = state({ portalThreadId: 'thd_a', threadMaps: { tpc_a: [{ id: 'thd_a' } as any] } });

    expect(portalThreadSelectors.isPortalThreadKeptOnTopic('tpc_b')(s)).toBe(false);
    expect(portalThreadSelectors.isPortalThreadKeptOnTopic('tpc_a')(s)).toBe(true);
  });

  it('reads the thread the pane shows, not only the legacy field', () => {
    const s = state({
      portalStack: [{ threadId: 'thd_a', type: PortalViewType.Thread }],
      threadMaps: { tpc_a: [{ id: 'thd_a' } as any] },
    });

    expect(portalThreadSelectors.isPortalThreadKeptOnTopic('tpc_b')(s)).toBe(false);
  });

  it('keeps a deep-linked thread no loaded list knows yet', () => {
    const s = state({ portalThreadId: 'thd_new', threadMaps: { tpc_a: [{ id: 'thd_a' } as any] } });

    expect(portalThreadSelectors.isPortalThreadKeptOnTopic('tpc_b')(s)).toBe(true);
  });

  it('drops the thread when there is no topic or no thread', () => {
    expect(
      portalThreadSelectors.isPortalThreadKeptOnTopic(null)(state({ portalThreadId: 'thd_a' })),
    ).toBe(false);
    expect(portalThreadSelectors.isPortalThreadKeptOnTopic('tpc_a')(state({}))).toBe(false);
  });
});
