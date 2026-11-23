/** @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import Body from './Body';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('@/features/Acceptance/hooks', () => ({
  useVerifierTracing: () => ({
    data: { inputTokens: 321, model: 'test-model', outputTokens: 222 },
  }),
  useVerifyInstruction: () => ({}),
  useVerifyResults: () => ({ data: [] }),
  useVerifyState: () => ({ data: { verifyPlan: [{ id: 'item', verifierType: 'agent' }] } }),
}));
vi.mock('@/store/chat', () => ({ useChatStore: () => 'item' }));
vi.mock('@/services/verify', () => ({ verifyService: {} }));

it.each([false, true])('keeps the verifier model and gates its token count (%s)', (enabled) => {
  visibility.enabled = enabled;
  const { container } = render(<Body />);
  expect(container.textContent).toContain('test-model');
  expect(container.textContent?.includes('543')).toBe(enabled);
});
