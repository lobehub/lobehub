/**
 * @vitest-environment happy-dom
 */
import type { InboundWebhookItem } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopicCell } from './cells';

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const item = (patch: Partial<InboundWebhookItem>) =>
  ({
    agent: { avatar: null, backgroundColor: null, id: 'agt_1', title: 'Helper' },
    topic: null,
    ...patch,
  }) as InboundWebhookItem;

afterEach(cleanup);

describe('TopicCell', () => {
  it("links a webhook to its calls, which name each run's topic, instead of a blank", () => {
    render(
      <TopicCell
        item={item({ source: { autoApprove: false, kind: 'generic', topicMode: 'new' } } as never)}
      />,
    );
    expect(screen.getByRole('link', { name: 'automations.target.webhookCalls' })).toHaveAttribute(
      'href',
      '/agent/agt_1/webhook',
    );
  });

  it('links an event subscription to its topic', () => {
    render(
      <TopicCell
        item={item({
          source: { arguments: {}, eventName: 'issue.created', kind: 'mcp_events' },
          topic: { id: 'tpc_1', title: 'CI watch' },
        } as never)}
      />,
    );
    expect(screen.getByRole('link', { name: 'CI watch' })).toBeInTheDocument();
  });
});
