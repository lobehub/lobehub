/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentLikeButton from './AgentLikeButton';

const service = vi.hoisted(() => ({
  like: vi.fn(),
  summaries: vi.fn(),
  unlike: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/services/agentLike', () => ({ agentLikeService: service }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: toastError },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

const renderButton = () =>
  render(<AgentLikeButton agentId={'agt_neko'} workspaceId={'ws_1'} />, { wrapper });

describe('AgentLikeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips optimistically and settles on the server count', async () => {
    service.summaries.mockResolvedValue({ agt_neko: { liked: false, total: 2 } });
    let resolveLike!: (value: { liked: boolean; total: number }) => void;
    service.like.mockReturnValue(new Promise((resolve) => (resolveLike = resolve)));

    renderButton();
    const button = await screen.findByRole('button', { name: 'agentViewAll.like.add' });
    expect(button.textContent).toBe('2');

    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('3');
    expect(service.like).toHaveBeenCalledWith('agt_neko');

    await act(async () => resolveLike({ liked: true, total: 5 }));
    await waitFor(() => expect(button.textContent).toBe('5'));
  });

  it('shows no count before the first like and restores the server state on failure', async () => {
    service.summaries.mockResolvedValue({});
    service.like.mockRejectedValue(new Error('boom'));

    renderButton();
    const button = await screen.findByRole('button', { name: 'agentViewAll.like.add' });
    expect(button.textContent).toBe('');

    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('agentViewAll.like.failed'));
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(button.textContent).toBe('');
    expect(service.summaries).toHaveBeenCalledTimes(2);
  });
});
