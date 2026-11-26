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

  it('names the Channel Thread a subscription posts to, linking to it', () => {
    render(
      <TopicCell
        item={item({
          channel: {
            id: 'chn_1',
            projectId: null,
            threadId: 'cht_1',
            threadTitle: 'Nightly',
            title: 'Builds',
          },
          source: {
            arguments: {},
            delivery: { channelId: 'chn_1', threadId: 'cht_1' },
            eventName: 'issue.created',
            kind: 'mcp_events',
          },
          topic: { id: 'tpc_1', title: 'Hidden channel topic' },
        } as never)}
      />,
    );
    expect(screen.getByRole('link', { name: 'automations.target.channelThread' })).toHaveAttribute(
      'href',
      '/channels/chn_1/threads/cht_1',
    );
    expect(screen.queryByText('Hidden channel topic')).toBeNull();
  });

  it('names a Channel the viewer is not in without linking to it', () => {
    render(
      <TopicCell
        item={item({
          channel: null,
          source: {
            arguments: {},
            delivery: { channelId: 'chn_private' },
            eventName: 'issue.created',
            kind: 'mcp_events',
          },
        } as never)}
      />,
    );
    expect(screen.getByText('automations.target.channelHidden')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
