/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { UsageLog } from '@/types/usage/usageRecord';

import { GroupBy } from '../../../../types';
import ActiveModels from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model }: { model: string }) => <span>{model}</span>,
  ProviderIcon: ({ provider }: { provider: string }) => <span>{provider}</span>,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button type="button" />,
  Avatar: ({ avatar, title }: { avatar?: string | null; title?: string }) => (
    <span aria-label={title} data-testid="active-user-avatar">
      {avatar}
    </span>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: () => null,
}));

vi.mock('@/components/StatisticCard', () => ({
  default: ({ statistic }: { statistic: { description?: ReactNode; value?: ReactNode } }) => (
    <div>
      <span>{statistic.value}</span>
      {statistic.description}
    </div>
  ),
}));

vi.mock('@/components/StatisticCard/TitleWithPercentage', () => ({
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));

const usageLog: UsageLog[] = [
  {
    date: 1,
    day: '2026-05-27',
    records: [
      {
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        id: 'record-1',
        model: 'gpt-5-mini',
        provider: 'openai',
        spend: 1,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalTokens: 30,
        type: 'chat',
        updatedAt: new Date('2026-05-27T00:00:00.000Z'),
        userId: 'user-1',
      },
    ],
    totalRequests: 1,
    totalSpend: 1,
    totalTokens: 30,
  },
];

describe('ActiveModels', () => {
  it('uses the resolved user name as the avatar fallback when the user has no avatar URL', () => {
    render(
      <ActiveModels
        data={usageLog}
        groupBy={GroupBy.User}
        resolveUser={() => ({ avatar: null, name: 'Ada Lovelace' })}
      />,
    );

    expect(screen.getByTestId('active-user-avatar')).toHaveTextContent('Ada Lovelace');
  });
});
