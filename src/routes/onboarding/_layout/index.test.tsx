import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import OnBoardingContainer from './index';

vi.mock('@/features/User/UserPanel/LangButton', () => ({
  default: () => <div>Lang Button</div>,
}));

vi.mock('@/features/User/UserPanel/ThemeButton', () => ({
  default: () => <div>Theme Button</div>,
}));

vi.mock('@/hooks/useIsDark', () => ({
  useIsDark: () => false,
}));

describe('OnBoardingContainer', () => {
  it('renders onboarding content without footer copyright', () => {
    render(
      <MemoryRouter>
        <OnBoardingContainer>
          <div>Onboarding Content</div>
        </OnBoardingContainer>
      </MemoryRouter>,
    );

    expect(screen.getByText('Lang Button')).toBeInTheDocument();
    expect(screen.getByText('Theme Button')).toBeInTheDocument();
    expect(screen.getByText('Onboarding Content')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'agent.skipOnboarding' })).not.toBeInTheDocument();
    expect(screen.queryByText('© 2026 LobeHub. All rights reserved.')).not.toBeInTheDocument();
  });

  it('shows skip onboarding on agent onboarding route', () => {
    render(
      <MemoryRouter initialEntries={['/onboarding/agent']}>
        <OnBoardingContainer>
          <div>Onboarding Content</div>
        </OnBoardingContainer>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'agent.skipOnboarding' })).toBeInTheDocument();
  });
});
