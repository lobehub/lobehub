import { describe, expect, it, vi } from 'vitest';

import { createShellWorkScan } from './shellWorkScan';

const shell = (command: string) => JSON.stringify({ command });

const setup = (registered = 1) => {
  const deps = {
    persist: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue({ failed: 0, registered, rootOperationId: 'root' }),
    topicId: 'tpc_1',
  };
  return { deps, scan: createShellWorkScan(deps) };
};

describe('createShellWorkScan', () => {
  it('registers an artboard create as soon as its result lands, anchored to the issuing message', async () => {
    const { deps, scan } = setup();

    scan.track(
      'call_1',
      'msg_step1',
      shell('"$LOBEHUB_CLI" artboard create --task T-1 --ops @a.json'),
    );
    scan.resolve('call_1', 'msg_tool1', false);
    await vi.waitFor(() => expect(deps.refresh).toHaveBeenCalledWith('tpc_1'));

    expect(deps.persist).toHaveBeenCalledWith('msg_step1');
    expect(deps.persist.mock.invocationCallOrder[0]).toBeLessThan(
      deps.register.mock.invocationCallOrder[0],
    );
    expect(deps.register).toHaveBeenCalledWith({
      anchorMessageId: 'msg_step1',
      messageIds: ['msg_tool1'],
      topicId: 'tpc_1',
    });
  });

  // The group shows the cards of its LATEST stamped message, so a completion scan
  // stamping the final message would hide the card the live scan put up.
  it('keeps the completion scan on the live anchor instead of the final message', async () => {
    const { deps, scan } = setup();

    scan.track('call_1', 'msg_step1', shell('lh artboard create --title X'));
    scan.resolve('call_1', 'msg_tool1', false);
    await scan.complete('msg_final', ['msg_tool1', 'msg_tool2']);

    expect(deps.register).toHaveBeenCalledWith({
      anchorMessageId: 'msg_step1',
      messageIds: ['msg_tool1', 'msg_tool2'],
      topicId: 'tpc_1',
    });
  });

  it('leaves other commands and failed calls to the completion scan on the final message', async () => {
    const { deps, scan } = setup();

    scan.track('call_1', 'msg_step1', shell('lh artboard files write art_1 pages/a.html'));
    scan.resolve('call_1', 'msg_tool1', false);
    scan.track('call_2', 'msg_step2', shell('lh artboard create --title X'));
    scan.resolve('call_2', 'msg_tool2', true);
    await scan.complete('msg_final', ['msg_tool1', 'msg_tool2']);

    expect(deps.register).toHaveBeenCalledTimes(1);
    expect(deps.register).toHaveBeenCalledWith({
      anchorMessageId: 'msg_final',
      messageIds: ['msg_tool1', 'msg_tool2'],
      topicId: 'tpc_1',
    });
  });

  // The executor bounds its own write drain before completing; a live scan stuck
  // behind a write that never settles must not hold the run open.
  it('completes without waiting on a live scan whose writes never settle', async () => {
    const { deps, scan } = setup();
    deps.persist.mockReturnValue(new Promise<void>(() => {}));

    scan.track('call_1', 'msg_step1', shell('lh artboard create --title X'));
    scan.resolve('call_1', 'msg_tool1', false);
    await scan.complete('msg_final', ['msg_tool1']);

    expect(deps.register).toHaveBeenCalledWith({
      anchorMessageId: 'msg_step1',
      messageIds: ['msg_tool1'],
      topicId: 'tpc_1',
    });
  });
});
