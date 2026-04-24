/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Layout from './index';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  ShikiLobeTheme: {},
}));

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    Outlet: () => <div data-testid="agent-layout-outlet">outlet</div>,
  };
});

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/hooks/useInitAgentConfig', () => ({ useInitAgentConfig: vi.fn() }));
vi.mock('@/features/ProtocolUrlHandler', () => ({ default: () => null }));
vi.mock('./RegisterHotkeys', () => ({ default: () => null }));
vi.mock('./Sidebar', () => ({ default: () => <div data-testid="agent-layout-sidebar" /> }));
vi.mock('@/routes/(main)/agent/_layout/AgentIdSync', () => ({
  default: () => <div data-testid="agent-layout-agent-id-sync" />,
}));

describe('Agent layout', () => {
  it('renders sidebar and outlet', () => {
    render(<Layout />);

    expect(screen.getByTestId('agent-layout-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('agent-layout-outlet')).toBeInTheDocument();
  });

  it('mounts AgentIdSync in layout', () => {
    render(<Layout />);

    expect(screen.getByTestId('agent-layout-agent-id-sync')).toBeInTheDocument();
  });
});
