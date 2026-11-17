/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import ProjectOwnedAgentRedirect from './ProjectOwnedAgentRedirect';

const toastInfo = vi.hoisted(() => vi.fn());

vi.mock(import('@lobehub/ui'), async (importOriginal) => ({
  ...(await importOriginal()),
  toast: { info: toastInfo } as any,
}));

const Where = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/agent/:aid/*"
          element={
            <ProjectOwnedAgentRedirect>
              <div data-testid="agent-page">agent page</div>
            </ProjectOwnedAgentRedirect>
          }
        />
        <Route element={<div data-testid="project-settings" />} path="/project/*" />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const setAgent = (ownerProjectId: string | null) =>
  useAgentStore.setState({
    agentMap: { agt_coord: { id: 'agt_coord', ownerProjectId } },
  });

describe('ProjectOwnedAgentRedirect', () => {
  beforeEach(() => toastInfo.mockReset());
  afterEach(() => useAgentStore.setState({ agentMap: {} }));

  it('sends a project-owned agent settings page to the project settings', () => {
    setAgent('prj_1');
    renderAt('/agent/agt_coord/instruction');

    expect(screen.getByTestId('location')).toHaveTextContent('/project/prj_1/settings/agent');
    expect(screen.queryByTestId('agent-page')).not.toBeInTheDocument();
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  it('keeps the IM platform when redirecting a channel page', () => {
    setAgent('prj_1');
    renderAt('/agent/agt_coord/channel/telegram');

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/project/prj_1/settings/agent?view=channel&platform=telegram',
    );
  });

  it('leaves the conversation of a project-owned agent in place', () => {
    setAgent('prj_1');
    renderAt('/agent/agt_coord/topics');

    expect(screen.getByTestId('agent-page')).toBeInTheDocument();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('leaves standalone agents on their own settings', () => {
    setAgent(null);
    renderAt('/agent/agt_coord/instruction');

    expect(screen.getByTestId('agent-page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/agent/agt_coord/instruction');
  });
});
