import type { InboundWebhookItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  feedbackForCheckedItem,
  feedbackForCheckError,
  feedbackForDeleteError,
} from './checkFeedback';

const row = (patch: Partial<InboundWebhookItem>): InboundWebhookItem => ({
  agent: null,
  canCheck: true,
  canManage: true,
  connector: null,
  createdAt: '2026-11-13T08:00:00.000Z',
  creatorId: 'user_1',
  expiresAt: null,
  id: 'wh_1',
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: null,
  name: 'issue.created',
  source: { arguments: {}, eventName: 'issue.created', kind: 'mcp_events' },
  status: 'active',
  topic: null,
  ...patch,
});

const trpcError = (code: string) => ({ data: { code } });

describe('feedbackForCheckedItem', () => {
  it('confirms a healthy subscription', () => {
    expect(feedbackForCheckedItem(row({}))).toEqual({
      key: 'automations.check.healthy',
      type: 'success',
    });
  });

  it('names the problem a check found instead of calling the check failed', () => {
    expect(feedbackForCheckedItem(row({ lastError: 'auth', status: 'error' }))).toEqual({
      key: 'automations.check.problem',
      reasonKey: 'automations.error.auth',
      type: 'error',
    });
    expect(
      feedbackForCheckedItem(row({ lastError: 'delivery_suspended', status: 'error' })),
    ).toMatchObject({ reasonKey: 'automations.error.delivery_suspended', type: 'error' });
  });

  it('warns rather than errs when the subscription works but a run was skipped', () => {
    expect(feedbackForCheckedItem(row({ lastError: 'wake_cap' }))).toMatchObject({
      reasonKey: 'automations.error.wake_cap',
      type: 'warning',
    });
  });
});

describe('feedbackForCheckError', () => {
  it('maps each refusal in the contract to its own message', () => {
    expect(feedbackForCheckError(trpcError('TOO_MANY_REQUESTS'))).toEqual({
      key: 'automations.check.tooSoon',
      type: 'info',
    });
    expect(feedbackForCheckError(trpcError('FORBIDDEN')).key).toBe(
      'automations.actions.noPermission',
    );
    expect(feedbackForCheckError(trpcError('NOT_FOUND'))).toEqual({
      key: 'automations.check.notFound',
      refresh: true,
      type: 'error',
    });
    expect(feedbackForCheckError(trpcError('BAD_REQUEST')).key).toBe(
      'automations.check.unsupported',
    );
  });

  it('falls back to a check failure for anything else', () => {
    expect(feedbackForCheckError(new Error('network'))).toEqual({
      key: 'automations.check.failed',
      type: 'error',
    });
  });
});

describe('feedbackForDeleteError', () => {
  it('treats a row that is already gone as done and refreshes the list', () => {
    expect(feedbackForDeleteError(trpcError('NOT_FOUND'))).toEqual({
      key: 'automations.delete.alreadyGone',
      refresh: true,
      type: 'info',
    });
  });

  it('separates a permission refusal from other failures', () => {
    expect(feedbackForDeleteError(trpcError('FORBIDDEN')).key).toBe(
      'automations.actions.noPermission',
    );
    expect(feedbackForDeleteError(new Error('x')).key).toBe('automations.delete.failed');
  });
});
