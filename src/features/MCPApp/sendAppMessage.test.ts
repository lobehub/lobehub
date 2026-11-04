import type { SendMessageParams } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { sendAppMessage } from './sendAppMessage';

describe('sendAppMessage', () => {
  it('does not acknowledge a send that finishes without accepting the message', async () => {
    // Gateway task creation can fail internally without rejecting the outer send.
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(sendAppMessage(send, 'Follow up', 'weather')).resolves.toBe(false);
  });

  it('acknowledges acceptance without waiting for the agent run to finish', async () => {
    let params!: SendMessageParams;
    const send = vi.fn((value: SendMessageParams) => {
      params = value;
      return new Promise<void>(() => {});
    });
    const result = sendAppMessage(send, 'Follow up', 'weather');

    expect(params.message).toBe('Follow up');
    expect(params.metadata?.mcpAppSource).toEqual({ identifier: 'weather' });
    expect(params.onMessageAccepted).toBeTypeOf('function');
    params.onMessageAccepted?.();

    await expect(result).resolves.toBe(true);
  });

  it('sends as a separate turn that leaves the composer draft alone', async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await sendAppMessage(send, 'Follow up', 'weather');

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ preserveComposer: true }));
  });

  it('lets the caller cancel the send until it is accepted', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const view = new AbortController();

    await sendAppMessage(send, 'Follow up', 'weather', view.signal);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ signal: view.signal }));
  });

  it('does not acknowledge before the acceptance callback fires', async () => {
    let params!: SendMessageParams;
    const send = vi.fn((value: SendMessageParams) => {
      params = value;
      return new Promise<void>(() => {});
    });
    const settled = vi.fn();
    const result = sendAppMessage(send, 'Follow up', 'weather').then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    expect(params.onMessageAccepted).toBeTypeOf('function');
    params.onMessageAccepted?.();
    await result;
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('reports a rejection before acceptance', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Could not create task'));

    await expect(sendAppMessage(send, 'Follow up', 'weather')).rejects.toThrow(
      'Could not create task',
    );
  });

  it('keeps an accepted message successful if the subsequent run fails', async () => {
    const send = vi.fn(async (params: SendMessageParams) => {
      params.onMessageAccepted?.();
      throw new Error('Agent run failed after storing the message');
    });

    await expect(sendAppMessage(send, 'Follow up', 'weather')).resolves.toBe(true);
  });
});
