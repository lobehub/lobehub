import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditingIndicator from './EditingIndicator';

const mockPage: { current: Record<string, unknown> } = { current: {} };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./store', () => ({
  usePageEditorStore: (selector: any) => selector(mockPage.current),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector({}),
}));

vi.mock('@/store/document/slices/editor', () => ({
  editorSelectors: {
    isAgentEditing: () => () => true,
    saveBlockedByLock: () => () => false,
  },
}));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({ useAuthorInfo: () => undefined }));
vi.mock('./usePageLockedByOther', () => ({ usePageLockedByOther: () => false }));
vi.mock('./usePageLockedBySelf', () => ({ usePageLockedBySelf: () => false }));

describe('EditingIndicator while the agent edits', () => {
  beforeEach(() => {
    mockPage.current = { documentId: 'doc-1', isWorkspacePage: true };
  });

  it('says the agent is editing on a page without a live room', () => {
    render(<EditingIndicator />);

    expect(screen.getByText('pageEditor.agentEditing')).toBeInTheDocument();
  });

  it('leaves the agent to the presence stack in a live room', () => {
    mockPage.current = { ...mockPage.current, collab: { status: 'synced' } };

    render(<EditingIndicator />);

    expect(screen.queryByText('pageEditor.agentEditing')).not.toBeInTheDocument();
  });
});
