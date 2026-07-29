import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import { createGatewayEventRouter } from './gatewayEventRouter';

const evt = (operationId: string, type = 'stream_chunk'): AgentStreamEvent =>
  ({ operationId, stepIndex: 0, timestamp: 0, type }) as unknown as AgentStreamEvent;

describe('createGatewayEventRouter', () => {
  it('routes owner-op events to the owner handler', () => {
    const ownerHandler = vi.fn();
    const createMemberHandler = vi.fn();

    const route = createGatewayEventRouter({
      createMemberHandler,
      ownerHandler,
      ownerOperationId: 'op_owner',
    });

    const e = evt('op_owner');
    route(e);

    expect(ownerHandler).toHaveBeenCalledWith(e);
    expect(createMemberHandler).not.toHaveBeenCalled();
  });

  it('lazily creates one member handler per distinct operationId and reuses it', () => {
    const ownerHandler = vi.fn();
    const memberHandler = vi.fn();
    const createMemberHandler = vi.fn(() => memberHandler);

    const route = createGatewayEventRouter({
      createMemberHandler,
      ownerHandler,
      ownerOperationId: 'op_owner',
    });

    route(evt('op_member_a'));
    route(evt('op_member_a'));

    expect(createMemberHandler).toHaveBeenCalledTimes(1);
    expect(createMemberHandler).toHaveBeenCalledWith('op_member_a');
    expect(memberHandler).toHaveBeenCalledTimes(2);
    expect(ownerHandler).not.toHaveBeenCalled();
  });

  it('keeps separate handlers per member operation', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const createMemberHandler = vi.fn((opId: string) => (opId === 'op_a' ? handlerA : handlerB));

    const route = createGatewayEventRouter({
      createMemberHandler,
      ownerHandler: vi.fn(),
      ownerOperationId: 'op_owner',
    });

    const a = evt('op_a');
    const b = evt('op_b');
    route(a);
    route(b);

    expect(createMemberHandler).toHaveBeenCalledTimes(2);
    expect(handlerA).toHaveBeenCalledWith(a);
    expect(handlerB).toHaveBeenCalledWith(b);
  });

  it('interleaves owner and member events without cross-talk', () => {
    const ownerHandler = vi.fn();
    const memberHandler = vi.fn();
    const createMemberHandler = vi.fn(() => memberHandler);

    const route = createGatewayEventRouter({
      createMemberHandler,
      ownerHandler,
      ownerOperationId: 'op_owner',
    });

    route(evt('op_owner', 'stream_start'));
    route(evt('op_member', 'stream_start'));
    route(evt('op_owner', 'stream_chunk'));
    route(evt('op_member', 'stream_chunk'));

    expect(ownerHandler).toHaveBeenCalledTimes(2);
    expect(memberHandler).toHaveBeenCalledTimes(2);
  });

  it('falls back to the owner handler when an event has no operationId', () => {
    const ownerHandler = vi.fn();
    const createMemberHandler = vi.fn();

    const route = createGatewayEventRouter({
      createMemberHandler,
      ownerHandler,
      ownerOperationId: 'op_owner',
    });

    const e = { stepIndex: 0, timestamp: 0, type: 'stream_chunk' } as unknown as AgentStreamEvent;
    route(e);

    expect(ownerHandler).toHaveBeenCalledWith(e);
    expect(createMemberHandler).not.toHaveBeenCalled();
  });
});
