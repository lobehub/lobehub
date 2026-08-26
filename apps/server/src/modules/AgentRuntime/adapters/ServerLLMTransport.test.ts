import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { ServerLLMTransport } from './ServerLLMTransport';

const mockInitModelRuntimeFromDB = vi.hoisted(() => vi.fn().mockResolvedValue({ chat: vi.fn() }));

vi.mock('@/server/modules/ModelRuntime', () => ({
  // Real implementation is a pure fail-closed mapper (no I/O) — mirror it so
  // the assertions below can check the resulting shape reaches
  // `initModelRuntimeFromDB` exactly like the real helper produces.
  buildAgentShareModelRuntimeContext: (
    agentShare?: { agentId?: string | null; visitorUserId?: string | null } | null,
  ) => {
    if (!agentShare) return undefined;
    const { agentId, visitorUserId } = agentShare;
    if (!agentId || !visitorUserId) {
      throw new Error(
        "Share-visitor model runtime billing context is incomplete (missing agentId/visitorUserId); refusing to fall back to the creator's ordinary billing.",
      );
    }
    return { agentShare: { agentId, visitorUserId } };
  },
  initModelRuntimeFromDB: mockInitModelRuntimeFromDB,
}));

const baseCtx = (overrides: Partial<RuntimeExecutorContext>): RuntimeExecutorContext =>
  ({
    operationId: 'op-1',
    serverDB: { __brand: 'db' } as any,
    stepIndex: 0,
    ...overrides,
  }) as RuntimeExecutorContext;

// M9: `ctx.userId` is the *creator* for a share run (share visitors execute
// as the creator so billing/model access resolve from the creator's plan).
// Only `ctx.agentShare.visitorUserId` carries the real visitor. Dropping it
// here means every downstream billing hook (and the spend log it writes)
// loses the ability to tell visitors apart / attribute spend to anyone but
// the creator.
describe('ServerLLMTransport createModelRuntime', () => {
  it('forwards both the agentId and the real visitorUserId for a share run', async () => {
    const ctx = baseCtx({
      agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
      userId: 'creator-1',
    });
    const transport = new ServerLLMTransport(ctx);

    await (transport as any).createModelRuntime('lobehub');

    expect(mockInitModelRuntimeFromDB).toHaveBeenCalledWith(
      ctx.serverDB,
      'creator-1',
      'lobehub',
      undefined,
      { agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' } },
    );
  });

  it('passes no business context for a non-share run', async () => {
    const ctx = baseCtx({ userId: 'user-1' });
    const transport = new ServerLLMTransport(ctx);

    await (transport as any).createModelRuntime('lobehub');

    expect(mockInitModelRuntimeFromDB).toHaveBeenCalledWith(
      ctx.serverDB,
      'user-1',
      'lobehub',
      undefined,
      undefined,
    );
  });
});
