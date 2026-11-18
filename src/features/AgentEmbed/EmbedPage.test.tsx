import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ getEmbedHostBridge: vi.fn() }));
vi.mock('./hostBridge', () => bridge);

const { default: AgentEmbedPage } = await import('./EmbedPage');

describe('AgentEmbedPage', () => {
  it('shows the unavailable state where the deployment has no embed chat, and starts the bridge after render', () => {
    render(
      <MemoryRouter initialEntries={['/embed/agent/my-bot']}>
        <Routes>
          <Route element={<AgentEmbedPage />} path={'/embed/agent/:slugOrId'} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('share.embed.unavailable.title')).toBeInTheDocument();
    expect(bridge.getEmbedHostBridge).toHaveBeenCalledTimes(1);
  });
});
