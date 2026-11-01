import { describe, expect, it, vi } from 'vitest';

import { handleDeviceRowKeyDown } from '../deviceRowKeyDown';

const row = {};

const keyEvent = (key: string, target: unknown = row) => ({
  currentTarget: row as never,
  key,
  preventDefault: vi.fn(),
  target: target as never,
});

describe('handleDeviceRowKeyDown', () => {
  it.each(['Enter', ' '])('selects an online row on %j', (key) => {
    const onSelect = vi.fn();
    const event = keyEvent(key);

    handleDeviceRowKeyDown(event, { disabled: false, onSelect });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const onSelect = vi.fn();

    handleDeviceRowKeyDown(keyEvent('ArrowDown'), { disabled: false, onSelect });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not select an offline row', () => {
    const onSelect = vi.fn();

    handleDeviceRowKeyDown(keyEvent('Enter'), { disabled: true, onSelect });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves keys aimed at an inner control (Reconnect) to that control', () => {
    const onSelect = vi.fn();
    const event = keyEvent('Enter', {});

    handleDeviceRowKeyDown(event, { disabled: false, onSelect });

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
