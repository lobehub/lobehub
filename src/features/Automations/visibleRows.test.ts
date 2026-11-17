import type { InboundWebhookItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { visibleAutomations } from './visibleRows';

const subscription = {
  id: 'sub',
  source: { arguments: {}, eventName: 'issue.created', kind: 'mcp_events' },
} as InboundWebhookItem;
const webhook = {
  id: 'hook',
  source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
} as InboundWebhookItem;

describe('visibleAutomations', () => {
  it("leaves an agent's custom webhooks to its Webhook tab", () => {
    expect(visibleAutomations([subscription, webhook], 'agt_1')).toEqual([subscription]);
  });

  it('lists everything in Settings → Automations', () => {
    expect(visibleAutomations([subscription, webhook])).toEqual([subscription, webhook]);
    expect(visibleAutomations(undefined)).toEqual([]);
  });
});
