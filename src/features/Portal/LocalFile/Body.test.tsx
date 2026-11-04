import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalFileScopeKey, createLocalFileTabId } from '@/store/chat/slices/portal/helpers';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

import Body from './Body';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      createStaticStyles: () => ({
        card: 'card',
        key: 'key',
        row: 'row',
        value: 'value',
      }),
      cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
      cssVar: {
        colorBgContainer: 'var(--color-bg-container)',
        colorBorderSecondary: 'var(--color-border-secondary)',
        colorTextSecondary: 'var(--color-text-secondary)',
        fontFamilyCode: 'monospace',
      },
    }),
    () => ({
      ActionIcon: () => null,
      Center: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
      Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Icon: () => null,
      Image: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
      Markdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
      Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    }),
    () => ({
      Tabs: () => null,
      Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
      ToggleGroup: () => null,
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/CodeEditorPane', () => ({
  default: () => <textarea data-testid="code-editor" />,
}));

const mockIsHtmlFile = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/components/HtmlPreview', () => ({
  InlineHtmlPreview: ({ baseUrl }: { baseUrl?: string }) => (
    <iframe data-base-url={baseUrl} title="html-preview" />
  ),
  isHtmlFile: mockIsHtmlFile,
}));

vi.mock('@/components/Loading/CircleLoading', () => ({
  default: () => <div data-testid="loading" />,
}));

const mockUseClientDataSWR = vi.hoisted(() => vi.fn());
const mockProjectFileService = vi.hoisted(() => ({
  getLocalFilePreview: vi.fn(),
  // The toolbar breadcrumb reads the project index to offer sibling files.
  getProjectFileIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mockUseClientDataSWR,
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: mockProjectFileService,
}));

const mockUseFetchPreview = vi.hoisted(() => vi.fn());
const mockPreview = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('@/store/localFilePreview', () => ({
  useLocalFilePreview: (target: unknown) => (target ? mockPreview.current : undefined),
  useLocalFilePreviewStore: (selector: (state: unknown) => unknown) =>
    selector({
      beginSave: vi.fn(() => vi.fn()),
      refreshPreview: vi.fn(),
      useFetchPreview: mockUseFetchPreview,
    }),
}));

const syncResult = (overrides: Record<string, unknown> = {}) => ({
  error: undefined,
  isHydrated: true,
  isLoading: false,
  isValidating: false,
  revalidate: vi.fn(),
  ...overrides,
});

vi.mock('@/utils/skillMarkdown', () => ({
  parseSkillMarkdownFrontmatter: (content: string) => ({ body: content }),
  parseSkillMarkdownMetadata: () => [],
}));

vi.mock('./MarkdownImage', () => ({
  default: () => null,
}));

vi.mock('./PublishHtmlArtifactButton', () => ({
  PublishHtmlArtifactLiveBar: () => null,
  PublishHtmlArtifactProvider: ({ children }: { children: ReactNode }) => children,
  PublishHtmlArtifactTrigger: () => null,
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
      localFileBuffer: (tabId: string) => (state: Record<PropertyKey, unknown>) =>
        (state.localFileBuffers as Record<string, string> | undefined)?.[tabId],
      openLocalFiles,
    },
    // The HTML preview reaches the project-file index, which only keeps itself
    // live while a run is writing to the tree. No run in these cases.
    operationSelectors: {
      isAgentRuntimeRunning: () => false,
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
  saveLocalFile: vi.fn(),
  setLocalFileBuffer: vi.fn(),
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
    mockIsHtmlFile.mockReset();
    mockIsHtmlFile.mockReturnValue(false);
    mockUseClientDataSWR.mockClear();
    mockUseClientDataSWR.mockReturnValue({ isLoading: true, mutate: vi.fn() });
    mockPreview.current = undefined;
    mockUseFetchPreview.mockReset();
    mockUseFetchPreview.mockReturnValue(syncResult({ isLoading: true }));
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
    expect(mockUseFetchPreview).toHaveBeenCalledWith(
      {
        allowExternalFile: true,
        deviceId: undefined,
        filePath: '/tmp/worktree-switcher-demo.html',
        sandboxTopicId: undefined,
        workingDirectory: '/tmp',
      },
      true,
    );
  });

  it('paints nothing — not a spinner — while the persisted preview is still being read', () => {
    mockChatState.current = createChatState('topic-a');
    mockUseFetchPreview.mockReturnValue(syncResult({ isHydrated: false, isLoading: true }));

    render(<Body />);

    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByText('workingPanel.localFile.error')).toBeNull();
  });

  it('paints the persisted text preview before the refresh answers', () => {
    mockChatState.current = createChatState('topic-a');
    mockPreview.current = { content: 'cached', contentType: 'text/plain', type: 'text' };
    mockUseFetchPreview.mockReturnValue(syncResult({ isValidating: true }));

    render(<Body />);

    expect(screen.getByTestId('code-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('keeps a cached text preview on screen when the background refresh fails', () => {
    mockChatState.current = createChatState('topic-a');
    mockPreview.current = { content: 'cached', contentType: 'text/plain', type: 'text' };
    mockUseFetchPreview.mockReturnValue(syncResult({ error: new Error('Failed to fetch') }));

    render(<Body />);

    expect(screen.getByTestId('code-editor')).toBeInTheDocument();
    expect(screen.queryByText('workingPanel.localFile.error')).toBeNull();
  });

  it('surfaces a refresh failure over a cached non-text preview', () => {
    mockChatState.current = createChatState('topic-a');
    mockPreview.current = { blob: new Blob(['png']), contentType: 'image/png', type: 'image' };
    mockUseFetchPreview.mockReturnValue(syncResult({ error: new Error('File not found') }));

    render(<Body />);

    expect(screen.getByText('workingPanel.localFile.error')).toBeInTheDocument();
  });

  it('passes the HTML preview its resource base URL', () => {
    const htmlFileId = createLocalFileTabId({
      filePath: '/project-a/pages/index.html',
      workingDirectory: '/project-a',
    });
    mockIsHtmlFile.mockReturnValue(true);
    mockChatState.current = {
      ...createChatState('topic-a'),
      activeLocalFileId: htmlFileId,
      activeLocalFilePath: '/project-a/pages/index.html',
      openLocalFiles: [
        {
          filePath: '/project-a/pages/index.html',
          id: htmlFileId,
          workingDirectory: '/project-a',
        },
      ],
    };
    mockPreview.current = {
      content: '<link rel="stylesheet" href="../assets/app.css">',
      contentType: 'text/html',
      resourceBaseUrl: 'localfile://preview-session/pages/',
      type: 'text',
    };
    mockUseFetchPreview.mockReturnValue(syncResult());

    render(<Body />);

    expect(screen.getByTitle('html-preview')).toHaveAttribute(
      'data-base-url',
      'localfile://preview-session/pages/',
    );
  });
});
