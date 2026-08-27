import { describe, expect, it, vi } from 'vitest';

import {
  createDelegatedPrincipal,
  createOwnerPrincipal,
} from '@/server/services/executionPrincipal';

import type { RuntimeExecutorContext } from '../context';
import { ServerSubAgentTransport } from './ServerSubAgentTransport';

const subAgentParams = {
  agentId: 'creator-agent',
  instruction: 'do the task',
  parentMessageId: 'msg-1',
  parentOperationId: 'op-1',
  topicId: 'topic-1',
} as any;

const visitorPrincipal = createDelegatedPrincipal({
  actorUserId: 'visitor-1',
  delegation: { agentId: 'creator-agent', grants: {}, shareId: 'share-1' },
  resourceOwnerUserId: 'creator-user',
});

describe('ServerSubAgentTransport', () => {
  // Agent share C3 (defensive layer): `ctx.principal.delegation` is only ever
  // set for a share-visitor run. Without this check a `callSubAgent`/
  // `callAgent` child would run with no shareGate of its own — the creator's
  // full, unrestricted tool/file/memory surface.
  it('rejects execSubAgent for a share-visitor run without invoking the callback', async () => {
    const execSubAgent = vi.fn().mockResolvedValue({ success: true });
    const ctx = {
      execSubAgent,
      principal: visitorPrincipal,
    } as unknown as RuntimeExecutorContext;

    const result = await new ServerSubAgentTransport(ctx).execSubAgent(subAgentParams);

    expect(execSubAgent).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/shared-agent visitor/i);
  });

  it('rejects execVirtualSubAgent for a share-visitor run without invoking the callback', async () => {
    const execVirtualSubAgent = vi.fn().mockResolvedValue({ success: true });
    const ctx = {
      execVirtualSubAgent,
      principal: visitorPrincipal,
    } as unknown as RuntimeExecutorContext;

    const result = await new ServerSubAgentTransport(ctx).execVirtualSubAgent(subAgentParams);

    expect(execVirtualSubAgent).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/shared-agent visitor/i);
  });

  it('delegates execSubAgent to the injected callback for a normal (non-share) run', async () => {
    const execSubAgent = vi.fn().mockResolvedValue({ success: true, threadId: 'thread-1' });
    const ctx = {
      execSubAgent,
      principal: createOwnerPrincipal('user-1'),
    } as unknown as RuntimeExecutorContext;

    const result = await new ServerSubAgentTransport(ctx).execSubAgent(subAgentParams);

    expect(execSubAgent).toHaveBeenCalledWith(subAgentParams);
    expect(result).toEqual({ success: true, threadId: 'thread-1' });
  });

  it('returns a fallback (not an exception) when no callback is injected', async () => {
    const ctx = {
      principal: createOwnerPrincipal('user-1'),
    } as unknown as RuntimeExecutorContext;

    const result = await new ServerSubAgentTransport(ctx).execSubAgent(subAgentParams);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available/i);
  });
});
