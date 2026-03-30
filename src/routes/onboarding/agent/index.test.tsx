import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderAgentRoute = async (enabled: boolean) => {
  vi.resetModules();
  vi.doMock('@/features/Onboarding/Agent', () => ({
    default: () => <div>Agent onboarding</div>,
  }));
  vi.doMock('@/routes/onboarding/config', () => ({
    AGENT_ONBOARDING_ENABLED: enabled,
  }));

  const { default: AgentOnboardingRoute } = await import('./index');

  render(
    <MemoryRouter initialEntries={['/onboarding/agent']}>
      <Routes>
        <Route element={<AgentOnboardingRoute />} path="/onboarding/agent" />
        <Route element={<div>Classic onboarding</div>} path="/onboarding/classic" />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  vi.doUnmock('@/features/Onboarding/Agent');
  vi.doUnmock('@/routes/onboarding/config');
});

describe('AgentOnboardingRoute', () => {
  it('renders the agent onboarding page when the feature is enabled', async () => {
    await renderAgentRoute(true);

    expect(screen.getByText('Agent onboarding')).toBeInTheDocument();
  });

  it('redirects to classic onboarding when the feature is disabled', async () => {
    await renderAgentRoute(false);

    expect(screen.getByText('Classic onboarding')).toBeInTheDocument();
  });
});
