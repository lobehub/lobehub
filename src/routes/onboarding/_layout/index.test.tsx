import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnBoardingContainer from './index';

const mocks = vi.hoisted(() => ({
  finishOnboarding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/User/UserPanel/LangButton', () => ({
  default: () => <div>Lang Button</div>,
}));

vi.mock('@/features/User/UserPanel/ThemeButton', () => ({
  default: () => <div>Theme Button</div>,
}));

vi.mock('@/hooks/useIsDark', () => ({
  useIsDark: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ finishOnboarding: mocks.finishOnboarding }),
}));

const renderAt = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnBoardingContainer>
        <div>Onboarding Content</div>
      </OnBoardingContainer>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OnBoardingContainer', () => {
  it('renders header controls and step content', () => {
    renderAt('/onboarding');

    expect(screen.getByText('Lang Button')).toBeInTheDocument();
    expect(screen.getByText('Theme Button')).toBeInTheDocument();
    expect(screen.getByText('Onboarding Content')).toBeInTheDocument();
  });

  it('shows the skip affordance', () => {
    renderAt('/onboarding');

    expect(screen.getByText('flow.skip')).toBeInTheDocument();
  });

  it('finishes onboarding when skip is clicked', async () => {
    renderAt('/onboarding');

    fireEvent.click(screen.getByText('flow.skip'));

    expect(mocks.finishOnboarding).toHaveBeenCalled();
  });
});
