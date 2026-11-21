/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ByAgentMode, { DEVICE_PRESENCE_POLL_MS } from './index';

const mocks = vi.hoisted(() => ({ useDeviceList: vi.fn(() => ({})) }));

vi.mock('@/store/device', () => ({ useDeviceList: mocks.useDeviceList }));
vi.mock('../GroupedAccordion', () => ({ default: () => <div data-testid="accordion" /> }));
vi.mock('./GroupItem', () => ({ default: () => null }));

describe('ByAgentMode', () => {
  /** @example A device that drops while the sidebar stays open must turn its dots gray. */
  it('keeps the device list fresh while it is on screen, polling once for every dot', () => {
    render(<ByAgentMode />);

    expect(mocks.useDeviceList).toHaveBeenCalledTimes(1);
    expect(mocks.useDeviceList).toHaveBeenCalledWith({ refreshInterval: DEVICE_PRESENCE_POLL_MS });
  });
});
