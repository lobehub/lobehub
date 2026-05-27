import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentBody from './Body';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    content: 'content',
  }),
  cssVar: {
    colorBgContainer: 'var(--color-bg-container)',
    colorBorderSecondary: 'var(--color-border-secondary)',
    colorTextSecondary: 'var(--color-text-secondary)',
    fontFamilyCode: 'monospace',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextArea: () => <textarea />,
}));

vi.mock('./EditorCanvas', () => ({
  default: () => <div data-testid="editor-canvas" />,
}));

vi.mock('./TodoList', () => ({
  default: () => <div data-testid="todo-list" />,
}));

vi.mock('@/features/FloatingChatPanel', () => ({
  default: () => <div data-testid="floating-chat-panel" />,
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    activeTopicId: 'topic-1',
    portalStack: [
      {
        agentDocumentId: 'agent-document-1',
        documentId: 'document-1',
        type: 'document',
      },
    ],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector(mockChatState.current),
}));

const mockAgentState = vi.hoisted(() => ({
  current: {
    activeAgentId: 'agent-1',
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector(mockAgentState.current),
}));

const mockDocumentState = vi.hoisted(() => ({
  current: {
    documents: {
      'document-1': {},
    },
    performSave: vi.fn(),
    updateSkillFrontmatter: vi.fn(),
  },
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector(mockDocumentState.current),
}));

const mockUserState = vi.hoisted(() => ({
  current: {
    preference: {
      lab: {
        enableAgentDocumentFloatingChatPanel: false,
      },
    },
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector(mockUserState.current),
}));

describe('DocumentBody', () => {
  beforeEach(() => {
    mockAgentState.current.activeAgentId = 'agent-1';
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = false;
  });

  it('does not render FloatingChatPanel when the lab feature is disabled', () => {
    render(<DocumentBody />);

    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });

  it('renders FloatingChatPanel when the lab feature is enabled', () => {
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = true;

    render(<DocumentBody />);

    expect(screen.getByTestId('floating-chat-panel')).toBeDefined();
  });
});
