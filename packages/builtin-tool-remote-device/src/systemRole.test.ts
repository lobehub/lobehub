import { describe, expect, it } from 'vitest';

import { generateSystemPrompt } from './systemRole';

describe('generateSystemPrompt', () => {
  it('lists a sleeping managed cloud device as an online cloud device', () => {
    const prompt = generateSystemPrompt([
      {
        deviceId: 'c1',
        hostname: 'cloud-host',
        lastSeen: '2026-01-01T00:00:00.000Z',
        managed: true,
        online: false,
        platform: 'linux',
      },
      {
        deviceId: 'd1',
        hostname: 'offline-desktop',
        lastSeen: '2026-01-01T00:00:00.000Z',
        online: false,
        platform: 'darwin',
      },
    ]);

    expect(prompt).toContain('<device id="c1" name="cloud-host" os="linux" kind="cloud" />');
    expect(prompt).not.toContain('offline-desktop');
    expect(prompt).not.toContain('No devices are currently online');
  });
});
