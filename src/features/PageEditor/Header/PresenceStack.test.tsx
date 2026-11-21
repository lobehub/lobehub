import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PresencePeer } from '../collab/presence';
import PresenceStack from './PresenceStack';

const mockPage: { current: { collab?: { status: string }; documentId: string } } = {
  current: { collab: { status: 'synced' }, documentId: 'doc-1' },
};
const mockDocument = { current: { agentEditing: false } };
const mockPresence = {
  getSection: vi.fn<(clientId: number) => string | undefined>(),
  hasCursor: vi.fn<(clientId: number) => boolean>(),
  jumpTo: vi.fn<(peer: PresencePeer) => boolean>(),
  peers: [] as PresencePeer[],
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { section?: string }) =>
      options?.section ? `${key}:${options.section}` : key,
  }),
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: any) => selector(mockPage.current),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector(mockDocument.current),
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: { isAgentEditing: () => (s: any) => s.agentEditing },
}));

vi.mock('../collab/usePagePresence', () => ({
  usePagePresence: () => mockPresence,
}));

const lin: PresencePeer = {
  away: false,
  clientId: 11,
  color: '#4f7cff',
  name: 'Lin Wei',
  userId: 'lin',
};
const jun: PresencePeer = {
  away: true,
  clientId: 12,
  color: '#1f9fb4',
  name: 'Jun Kim',
  userId: 'jun',
};

const openList = () =>
  fireEvent.click(screen.getByRole('button', { name: 'pageEditor.collab.presence.trigger' }));

describe('PresenceStack', () => {
  beforeEach(() => {
    mockPage.current = { collab: { status: 'synced' }, documentId: 'doc-1' };
    mockDocument.current = { agentEditing: false };
    mockPresence.peers = [lin, jun];
    mockPresence.getSection.mockReset().mockReturnValue('Rollout plan');
    mockPresence.hasCursor.mockReset().mockReturnValue(true);
    mockPresence.jumpTo.mockReset().mockReturnValue(true);
  });

  it('renders nothing when the page is not in a live room', () => {
    mockPage.current = { documentId: 'doc-1' };

    const { container } = render(<PresenceStack />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nobody else is here and the agent is idle', () => {
    mockPresence.peers = [];

    const { container } = render(<PresenceStack />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the agent alone while it edits', () => {
    mockPresence.peers = [];
    mockDocument.current = { agentEditing: true };

    render(<PresenceStack />);
    openList();

    expect(screen.getByText('pageEditor.collab.presence.agentStatus')).toBeInTheDocument();
  });

  it('lists each person with their section, and away people as away', () => {
    render(<PresenceStack />);
    openList();

    expect(
      screen.getByText('pageEditor.collab.presence.inSection:Rollout plan'),
    ).toBeInTheDocument();
    expect(screen.getByText('pageEditor.collab.presence.away')).toBeInTheDocument();
  });

  it('jumps to a person and closes the list when their row is clicked', () => {
    render(<PresenceStack />);
    openList();

    fireEvent.click(screen.getByRole('button', { name: /Lin Wei/ }));

    expect(mockPresence.jumpTo).toHaveBeenCalledWith(lin);
    expect(screen.queryByText('pageEditor.collab.presence.title')).not.toBeInTheDocument();
  });

  it('does not offer a jump for someone without a visible cursor', () => {
    mockPresence.hasCursor.mockReturnValue(false);
    mockPresence.peers = [lin];

    render(<PresenceStack />);
    openList();

    expect(screen.queryByRole('button', { name: /Lin Wei/ })).not.toBeInTheDocument();
    expect(screen.getByText('Lin Wei')).toBeInTheDocument();
  });
});
