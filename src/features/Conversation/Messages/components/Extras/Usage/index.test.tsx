/** @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import Usage from './index';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('@/store/agent', () => ({ useAgentStore: () => undefined }));
vi.mock('@/store/aiInfra', () => ({ aiModelSelectors: {}, useAiInfraStore: () => undefined }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => true }));
vi.mock('../../../../store', () => ({ contextSelectors: {}, useConversationStore: () => 'chat' }));
vi.mock('@/components/LobeIcons', () => ({ ModelIcon: () => null }));
vi.mock('./UsageDetail', () => ({ default: () => <span>543 tokens</span> }));
vi.mock('@/utils/usageCredits', () => ({
  formatUsageCost: () => '31 credits',
  isUsageCreditsEnabled: () => true,
}));

it.each([false, true])('gates diagnostics in the developer footer (%s)', (enabled) => {
  visibility.enabled = enabled;
  const { container } = render(
    <Usage
      model="test-model"
      performance={{ tps: 777 }}
      provider="openai"
      usage={{ cost: 0.31, totalTokens: 543 }}
    />,
  );
  expect(container.textContent?.includes('543 tokens')).toBe(enabled);
  expect(container.textContent?.includes('777')).toBe(enabled);
  if (!enabled) expect(container.textContent).toContain('31 credits');
});

it('shows a charge even without a token total', () => {
  visibility.enabled = false;
  const { container } = render(
    <Usage model="test-model" provider="openai" usage={{ cost: 0.001 }} />,
  );
  expect(container.textContent).toContain('31 credits');
});

it('shows no charge for a message that cost nothing', () => {
  visibility.enabled = false;
  const { container } = render(
    <Usage model="test-model" provider="openai" usage={{ cost: 0, totalTokens: 543 }} />,
  );
  expect(container.textContent).not.toContain('credits');
  expect(container.textContent).not.toContain('543 tokens');
});
