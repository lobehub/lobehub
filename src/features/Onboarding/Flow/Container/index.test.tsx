import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnBoardingContainer from './index';

const mocks = vi.hoisted(() => ({
  onSkip: vi.fn().mockResolvedValue(undefined),
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

const renderAt = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OnBoardingContainer onSkip={mocks.onSkip}>
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

  it('delegates to the provided onSkip handler when skip is clicked', () => {
    renderAt('/onboarding');

    fireEvent.click(screen.getByText('flow.skip'));

    expect(mocks.onSkip).toHaveBeenCalled();
  });
});
