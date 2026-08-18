// Client integration of round-boundary cursor pagination (LOBE-13229 /
// LOBE-12011): eligibility gating, paged key separation, and payload shapes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveGatewayModeEnabled } from '@/helpers/gatewayMode';
import { isMessageListKey, normalizeMessageListQueryContext } from '@/libs/swr/keys';
import { messageService } from '@/services/message';

import {
  clearMessageWindowStarts,
  fetchPagedMessageWindow,
  getMessageListPayload,
  getMessageWindowStart,
  isPagedMessageListContext,
  runPagedMessageListQuery,
  setMessageWindowStart,
  toPagedMessageListContext,
} from './pagedMessageList';

vi.mock('@/helpers/gatewayMode', () => ({ resolveGatewayModeEnabled: vi.fn() }));
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => ({}) } }));
vi.mock('@/services/message', () => ({
  messageService: { getMessagesByCursor: vi.fn() },
}));

const mockGateway = vi.mocked(resolveGatewayModeEnabled);
const mockGetMessagesByCursor = vi.mocked(messageService.getMessagesByCursor);

beforeEach(() => {
  vi.clearAllMocks();
  mockGateway.mockReturnValue(true);
  clearMessageWindowStarts();
});

describe('isPagedMessageListContext', () => {
  const mainline = { agentId: 'agt_1', topicId: 'tpc_1' };

  it('is eligible for a mainline topic context in gateway mode', () => {
    expect(isPagedMessageListContext(mainline)).toBe(true);
  });

  it('rejects every non-mainline variant (cursor query covers mainline only)', () => {
    expect(isPagedMessageListContext({ ...mainline, threadId: 'thr_1' })).toBe(false);
    expect(isPagedMessageListContext({ ...mainline, groupId: 'grp_1' })).toBe(false);
    expect(isPagedMessageListContext({ ...mainline, topicShareId: 'shr_1' })).toBe(false);
    expect(isPagedMessageListContext({ agentId: 'agt_1', topicId: null })).toBe(false);
  });

  it('rejects legacy client mode — the client resends the transcript there', () => {
    mockGateway.mockReturnValue(false);
    expect(isPagedMessageListContext(mainline)).toBe(false);
  });
});

describe('paged key separation', () => {
  const context = { agentId: 'agt_1', topicId: 'tpc_1' };

  it('the paged context normalizes to a distinct canonical context', () => {
    const plain = normalizeMessageListQueryContext(context);
    const paged = normalizeMessageListQueryContext(toPagedMessageListContext(context));

    expect(plain).not.toHaveProperty('paged');
    expect(paged).toMatchObject({ paged: true });
    expect(JSON.stringify(plain)).not.toBe(JSON.stringify(paged));
  });

  it('isMessageListKey invalidation matches BOTH variants by topicId', () => {
    const plainKey = ['message:list', normalizeMessageListQueryContext(context), 2];
    const pagedKey = [
      'message:list',
      normalizeMessageListQueryContext(toPagedMessageListContext(context)),
      2,
    ];
    const predicate = (ctx: any) => ctx.agentId === 'agt_1' && ctx.topicId === 'tpc_1';

    expect(isMessageListKey(plainKey, predicate)).toBe(true);
    expect(isMessageListKey(pagedKey, predicate)).toBe(true);
  });
});

describe('window fetches', () => {
  const anchor = { createdAt: '2026-01-01T00:00:00.000001Z', id: 'msg_1' };

  it('fetches the newest window without an anchor by default and remembers windowStart', async () => {
    mockGetMessagesByCursor.mockResolvedValue({
      hasMore: true,
      messages: [],
      nextCursor: anchor,
      windowStart: anchor,
    });

    await runPagedMessageListQuery({ agentId: 'agt_a', topicId: 'tpc_a' });

    expect(mockGetMessagesByCursor).toHaveBeenCalledWith({
      agentId: 'agt_a',
      anchor: null,
      topicId: 'tpc_a',
    });
    // The returned windowStart becomes the anchor for later window re-fetches.
    expect(getMessageWindowStart({ agentId: 'agt_a', topicId: 'tpc_a' })).toEqual(anchor);
  });

  it('anchors on the registered windowStart for whole-window revalidation', async () => {
    const context = { agentId: 'agt_b', topicId: 'tpc_b' };
    setMessageWindowStart(context, anchor);
    mockGetMessagesByCursor.mockResolvedValue({
      hasMore: true,
      messages: [],
      nextCursor: anchor,
      windowStart: anchor,
    });

    await fetchPagedMessageWindow(context);

    expect(mockGetMessagesByCursor).toHaveBeenCalledWith({
      agentId: 'agt_b',
      anchor,
      topicId: 'tpc_b',
    });
  });

  it('passes skipWorks through for mid-stream refetches', async () => {
    mockGetMessagesByCursor.mockResolvedValue({
      hasMore: false,
      messages: [],
      nextCursor: null,
      windowStart: null,
    });

    await fetchPagedMessageWindow({ agentId: 'agt_c', topicId: 'tpc_c' }, { skipWorks: true });

    expect(mockGetMessagesByCursor).toHaveBeenCalledWith({
      agentId: 'agt_c',
      anchor: null,
      skipWorks: true,
      topicId: 'tpc_c',
    });
  });

  it('scopes windowStart per conversation identity', () => {
    setMessageWindowStart({ agentId: 'agt_x', topicId: 'tpc_x' }, anchor);
    expect(getMessageWindowStart({ agentId: 'agt_x', topicId: 'tpc_x' })).toEqual(anchor);
    expect(getMessageWindowStart({ agentId: 'agt_x', topicId: 'tpc_y' })).toBeNull();
  });
});

describe('getMessageListPayload', () => {
  it('passes a legacy array through with no page metadata', () => {
    const messages = [{ id: 'msg_1' }] as any;
    expect(getMessageListPayload(messages)).toEqual({ messages, page: null });
  });

  it('unwraps a paged payload and exposes it as the page', () => {
    const page = {
      hasMore: true,
      messages: [{ id: 'msg_1' }] as any,
      nextCursor: { createdAt: 'c', id: 'msg_1' },
      windowStart: { createdAt: 'c', id: 'msg_1' },
    };
    expect(getMessageListPayload(page)).toEqual({ messages: page.messages, page });
  });
});
