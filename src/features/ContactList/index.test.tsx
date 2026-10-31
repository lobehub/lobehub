/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactListBody } from './index';

const fetch = vi.hoisted(() => ({ error: undefined as unknown, mutate: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ pathname: '/' }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => fetch }));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => [], isAgentListInit: () => false },
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => createElement('div', {}, 'Loading contacts'),
}));
vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry?: () => void }) =>
    createElement('button', { onClick: onRetry, type: 'button' }, 'Retry contacts'),
}));

beforeEach(() => {
  fetch.error = undefined;
  fetch.mutate.mockReset();
});

describe('ContactListBody', () => {
  it('shows the skeleton while the first load is in flight', () => {
    render(createElement(ContactListBody));

    expect(screen.getByText('Loading contacts')).toBeInTheDocument();
  });

  it('shows a retryable error when the first load fails', () => {
    fetch.error = new Error('network');

    render(createElement(ContactListBody));

    expect(screen.queryByText('Loading contacts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry contacts'));
    expect(fetch.mutate).toHaveBeenCalled();
  });
});
