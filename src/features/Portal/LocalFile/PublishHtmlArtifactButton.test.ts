import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePublishHtmlArtifactModel } from './PublishHtmlArtifactButton';
import { createWorkspaceHtmlArtifactIdentifier } from './workspaceHtmlPath';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ bar: 'bar', url: 'url' }),
  cssVar: {
    colorBgContainer: 'var(--color-bg-container)',
    colorBorderSecondary: 'var(--color-border-secondary)',
    fontFamilyCode: 'monospace',
    fontSizeSM: 12,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  CopyButton: () => null,
  Flexbox: () => null,
  Tag: () => null,
  Text: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: () => null,
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/components/HtmlPreview', () => ({
  isHtmlFile: ({ path }: { path: string }) => path.endsWith('.html'),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agt_1' }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableArtifactDeployment: () => true },
}));

const getExisting = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/features/WorkspaceHtmlArtifactPublish', () => ({
  useWorkspaceHtmlArtifactPublish: () => ({ available: true, getExisting, publish }),
}));

const prepareWorkspaceHtmlPublish = vi.hoisted(() => vi.fn());

vi.mock('./prepareWorkspaceHtmlPublish', () => ({
  notifyWorkspaceHtmlPublishBlocked: vi.fn(),
  prepareWorkspaceHtmlPublish,
  publishPreparedWorkspaceHtml: async ({
    plan,
    publish: run,
    topicId,
  }: {
    plan: { gathered: { identifier: string } };
    publish: (input: { identifier: string; topicId: string }) => Promise<unknown>;
    topicId: string;
  }) => {
    try {
      return await run({ identifier: plan.gathered.identifier, topicId });
    } catch {
      return undefined;
    }
  },
}));

vi.mock('./PublishHtmlArtifactConfirm', () => ({
  openWorkspaceHtmlPublishConfirm: ({ onOk }: { onOk: () => void }) => onOk(),
}));

const modelProps = (filePath: string, workingDirectory: string) => ({
  content: '<html></html>',
  filePath,
  topicId: 'tpc_1',
  workingDirectory,
});

const gatheredFor = (relativePath: string) => ({
  entryPath: relativePath,
  files: [],
  identifier: createWorkspaceHtmlArtifactIdentifier(relativePath),
  missing: [],
  oversized: [],
  remotes: [],
  title: 'Demo',
  totalBytes: 0,
});

describe('usePublishHtmlArtifactModel', () => {
  beforeEach(() => {
    getExisting.mockReset().mockResolvedValue(null);
    publish.mockReset();
    prepareWorkspaceHtmlPublish.mockReset();
  });

  it('looks up deployments with the same canonical identifier gathering publishes', async () => {
    renderHook(() =>
      usePublishHtmlArtifactModel(modelProps('/private/tmp/ws/pages/index.html', '/tmp/ws')),
    );

    await waitFor(() => {
      expect(getExisting).toHaveBeenCalledWith({
        identifier: createWorkspaceHtmlArtifactIdentifier('pages/index.html'),
        topicId: 'tpc_1',
      });
    });
  });

  it('marks the current file live once its publish completes', async () => {
    prepareWorkspaceHtmlPublish.mockResolvedValue({
      gathered: gatheredFor('a.html'),
      packed: { html: '', sidecars: [] },
    });
    publish.mockResolvedValue({ publicUrl: 'https://pub.example.com/a' });

    const { result } = renderHook(() =>
      usePublishHtmlArtifactModel(modelProps('/ws/a.html', '/ws')),
    );
    act(() => {
      result.current.handlePublish();
    });

    await waitFor(() => {
      expect(result.current.publicUrl).toBe('https://pub.example.com/a');
    });
    expect(result.current.showLiveBar).toBe(true);
  });

  it('discards a publish result that finishes after switching to another file', async () => {
    prepareWorkspaceHtmlPublish.mockResolvedValue({
      gathered: gatheredFor('a.html'),
      packed: { html: '', sidecars: [] },
    });

    let resolvePublish: (value: { publicUrl: string }) => void = () => {};
    publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = resolve;
        }),
    );

    const { rerender, result } = renderHook((props) => usePublishHtmlArtifactModel(props), {
      initialProps: modelProps('/ws/a.html', '/ws'),
    });
    act(() => {
      result.current.handlePublish();
    });
    await waitFor(() => {
      expect(publish).toHaveBeenCalled();
    });

    rerender(modelProps('/ws/b.html', '/ws'));

    act(() => {
      resolvePublish({ publicUrl: 'https://pub.example.com/a' });
    });
    await waitFor(() => {
      expect(getExisting).toHaveBeenCalledTimes(2);
    });

    expect(result.current.publicUrl).toBeUndefined();
  });
});
