import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localFileKeys } from '@/libs/swr/keys';
import { createLocalFileScopeKey, createLocalFileTabId } from '@/store/chat/slices/portal/helpers';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

import Body from './Body';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    card: 'card',
    key: 'key',
    row: 'row',
    value: 'value',
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
  Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Image: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
  Markdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tabs: () => null,
}));

vi.mock('@/components/CodeEditorPane', () => ({
  default: () => <textarea data-testid="code-editor" />,
}));

vi.mock('@/components/HtmlPreview', () => ({
  InlineHtmlPreview: () => <iframe title="html-preview" />,
  isHtmlFile: () => false,
}));

vi.mock('@/components/Loading/CircleLoading', () => ({
  default: () => <div data-testid="loading" />,
}));

const mockUseClientDataSWR = vi.hoisted(() => vi.fn());
const mockProjectFileService = vi.hoisted(() => ({
  getLocalFilePreview: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mockUseClientDataSWR,
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: mockProjectFileService,
}));

vi.mock('@/utils/skillMarkdown', () => ({
  parseSkillMarkdownFrontmatter: (content: string) => ({ body: content }),
  parseSkillMarkdownMetadata: () => [],
}));

vi.mock('./MarkdownImage', () => ({
  default: () => null,
}));

const mockClearPortalStack = vi.hoisted(() => vi.fn());
const mockChatState = vi.hoisted(() => ({
  current: {} as Record<PropertyKey, unknown>,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<PropertyKey, unknown>) => unknown) =>
    selector(mockChatState.current),
}));

vi.mock('@/store/chat/selectors', () => {
  const getCurrentWorkingDirectory = (state: Record<PropertyKey, unknown>) => {
    const activeAgentId = state.activeAgentId as string | undefined;
    const activeTopicId = state.activeTopicId as string | undefined;
    const topicDataMap = state.topicDataMap as
      | Record<string, { items?: Array<{ id: string; metadata?: { workingDirectory?: string } }> }>
      | undefined;

    return topicDataMap?.[`agent_${activeAgentId}`]?.items?.find(
      (topic) => topic.id === activeTopicId,
    )?.metadata?.workingDirectory;
  };

  const openLocalFiles = (state: Record<PropertyKey, unknown>) => {
    const files =
      (state.openLocalFiles as
        | Array<{
            allowExternalFilePreview?: boolean;
            filePath: string;
            id?: string;
            workingDirectory: string;
          }>
        | undefined) ?? [];
    const workingDirectory = getCurrentWorkingDirectory(state);

    return workingDirectory
      ? files.filter(
          (file) => file.allowExternalFilePreview || file.workingDirectory === workingDirectory,
        )
      : files;
  };

  return {
    chatPortalSelectors: {
      currentLocalFile: (state: Record<PropertyKey, unknown>) => {
        const files = openLocalFiles(state);
        const activeLocalFileId = state.activeLocalFileId as string | undefined;
        const activeLocalFilePath = state.activeLocalFilePath as string | undefined;

        return (
          files.find((file) => file.id === activeLocalFileId) ??
          files.find((file) => file.filePath === activeLocalFilePath) ??
          files[0]
        );
      },
      openLocalFiles,
    },
  };
});

const projectAFileId = createLocalFileTabId({
  filePath: '/project-a/a.ts',
  workingDirectory: '/project-a',
});

const createChatState = (activeTopicId: 'topic-a' | 'topic-b') => ({
  activeAgentId: 'agent-1',
  activeLocalFileId: projectAFileId,
  activeLocalFileIdsByScope: {
    [createLocalFileScopeKey('/project-a')]: projectAFileId,
  },
  activeLocalFilePath: '/project-a/a.ts',
  activeTopicId,
  clearPortalStack: mockClearPortalStack,
  openLocalFiles: [
    {
      filePath: '/project-a/a.ts',
      id: projectAFileId,
      workingDirectory: '/project-a',
    },
  ],
  topicDataMap: {
    [topicMapKey({ agentId: 'agent-1' })]: {
      currentPage: 1,
      hasMore: false,
      items: [
        {
          id: 'topic-a',
          metadata: { workingDirectory: '/project-a' },
        },
        {
          id: 'topic-b',
          metadata: { workingDirectory: '/project-b' },
        },
      ],
      pageSize: 20,
      total: 2,
    },
  },
});

describe('LocalFile Body', () => {
  beforeEach(() => {
    mockClearPortalStack.mockClear();
    mockProjectFileService.getLocalFilePreview.mockClear();
    mockUseClientDataSWR.mockClear();
    mockUseClientDataSWR.mockReturnValue({
      isLoading: true,
      mutate: vi.fn(),
    });
  });

  it('closes the LocalFile portal when the current project has no visible local-file tabs', async () => {
    mockChatState.current = createChatState('topic-b');

    render(<Body />);

    await waitFor(() => {
      expect(mockClearPortalStack).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the LocalFile portal open when the current project has an active local-file tab', () => {
    mockChatState.current = createChatState('topic-a');

    render(<Body />);

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(mockClearPortalStack).not.toHaveBeenCalled();
  });

  it('keeps user-approved external preview tabs visible outside the current project scope', () => {
    const externalFileId = createLocalFileTabId({
      filePath: '/tmp/worktree-switcher-demo.html',
      workingDirectory: '/tmp',
    });
    mockChatState.current = {
      ...createChatState('topic-a'),
      activeLocalFileId: externalFileId,
      activeLocalFilePath: '/tmp/worktree-switcher-demo.html',
      openLocalFiles: [
        {
          allowExternalFilePreview: true,
          filePath: '/tmp/worktree-switcher-demo.html',
          id: externalFileId,
          workingDirectory: '/tmp',
        },
      ],
    };

    render(<Body />);

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(mockClearPortalStack).not.toHaveBeenCalled();
    expect(mockUseClientDataSWR).toHaveBeenCalledWith(
      localFileKeys.preview({
        allowExternalFile: true,
        filePath: '/tmp/worktree-switcher-demo.html',
        workingDirectory: '/tmp',
      }),
      expect.any(Function),
      { revalidateOnFocus: false },
    );

    const fetcher = mockUseClientDataSWR.mock.calls.at(-1)?.[1] as () => Promise<unknown>;
    void fetcher();
    expect(mockProjectFileService.getLocalFilePreview).toHaveBeenCalledWith({
      allowExternalFile: true,
      deviceId: undefined,
      path: '/tmp/worktree-switcher-demo.html',
      workingDirectory: '/tmp',
    });
  });
});
