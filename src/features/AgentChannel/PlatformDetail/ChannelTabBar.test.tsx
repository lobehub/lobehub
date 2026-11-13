/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import agentEn from '../../../../packages/locales/src/default/agent';
import { ChannelTabBar } from './ChannelTabBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (agentEn as Record<string, string>)[key] ?? key }),
}));

describe('ChannelTabBar', () => {
  it('marks a tab that holds unsaved changes, so leaving it does not look like saving it', () => {
    render(
      <ChannelTabBar
        active="connect"
        issues={[]}
        pending={['wake']}
        tabs={['connect', 'access', 'wake']}
        onChange={() => {}}
      />,
    );

    const marks = screen.getAllByRole('img', { name: agentEn['channel.tab.unsaved'] });
    expect(marks).toHaveLength(1);
    expect(marks[0].closest('[role="tab"]')).toHaveTextContent(agentEn['channel.tab.wake']);
  });

  it('shows no mark when nothing is pending', () => {
    render(
      <ChannelTabBar active="connect" issues={[]} tabs={['connect', 'wake']} onChange={() => {}} />,
    );

    expect(screen.queryByRole('img', { name: agentEn['channel.tab.unsaved'] })).toBeNull();
  });
});
