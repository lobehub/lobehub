import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Usage from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/LobeIcons', () => ({ ModelIcon: () => null }));
vi.mock('@/store/agent', () => ({ useAgentStore: () => undefined }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {},
  builtinAgentSelectors: {},
}));
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {},
  useAiInfraStore: () => undefined,
}));
vi.mock('@/store/global', () => ({ useGlobalStore: () => false }));
vi.mock('@/store/global/selectors', () => ({ systemStatusSelectors: {} }));
vi.mock('../../../../store', () => ({
  contextSelectors: {},
  useConversationStore: () => undefined,
}));
vi.mock('./UsageDetail', () => ({ default: () => <span>122,084</span> }));

describe('Usage', () => {
  const renderUsage = () =>
    render(
      <Usage
        model="gpt-5"
        performance={{ tps: 42.5 }}
        provider="openai"
        usage={{ cost: 1.5, totalTokens: 122_084 }}
      />,
    );

  it('keeps model, speed, tokens and cost in one start-aligned row', () => {
    const { container } = renderUsage();
    const row = container.firstElementChild as HTMLElement;

    expect(row.textContent?.replaceAll(/\s/g, '')).toBe(
      'gpt-5·42.5messages.tokenDetails.speed.tps.title·122,084·1.50',
    );

    const stats = [
      screen.getByText('gpt-5'),
      screen.getByText('42.5'),
      screen.getByText('122,084'),
    ];
    for (const stat of stats) {
      // A direct child of the row, not of a second cluster that could be pushed away.
      expect(stat.closest('div')?.parentElement).toBe(row);
    }
  });
});
