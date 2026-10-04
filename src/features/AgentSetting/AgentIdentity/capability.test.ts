import { describe, expect, it } from 'vitest';

import { describeAccountCapability } from './capability';

describe('describeAccountCapability', () => {
  it('says a dedicated number can receive but not send while its 10DLC campaign is pending', () => {
    expect(
      describeAccountCapability({
        capabilities: { receive: true, send: false },
        metadata: { sendBlockedReason: 'messaging_campaign_not_approved' },
      }),
    ).toEqual({
      labels: [
        { key: 'identity.capability.receive', tone: 'success' },
        { key: 'identity.capability.sendBlocked', tone: 'warning' },
      ],
      sendBlockedKey: 'identity.capability.sendBlocked.campaign',
    });
  });

  it('falls back to a generic explanation when no reason is recorded', () => {
    expect(
      describeAccountCapability({ capabilities: { receive: true, send: false }, metadata: {} })
        .sendBlockedKey,
    ).toBe('identity.capability.sendBlocked.generic');
  });

  it('shows both capabilities and no explanation once the account may send', () => {
    expect(describeAccountCapability({ capabilities: { receive: true, send: true } })).toEqual({
      labels: [
        { key: 'identity.capability.receive', tone: 'success' },
        { key: 'identity.capability.send', tone: 'success' },
      ],
    });
  });
});
