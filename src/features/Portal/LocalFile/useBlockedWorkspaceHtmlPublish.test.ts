import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBlockedWorkspaceHtmlPublish } from './useBlockedWorkspaceHtmlPublish';

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  confirmModal: vi.fn(),
  debugLog: vi.fn(),
  notifyBlocked: vi.fn(),
  openConfirm: vi.fn(),
  prepare: vi.fn(),
  publishPrepared: vi.fn(),
  toastError: vi.fn(),
  translate: vi.fn((key: string, _options?: Record<string, unknown>) => key),
}));

vi.mock('debug', () => ({ default: () => mocks.debugLog }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: (...args: unknown[]) => mocks.confirmModal(...args),
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => mocks.translate(key, options),
  }),
}));
vi.mock('./copyWorkspaceHtmlArtifactIntoWorkspace', () => ({
  copyWorkspaceHtmlArtifactIntoWorkspace: (...args: unknown[]) => mocks.copy(...args),
}));
vi.mock('./prepareWorkspaceHtmlPublish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyWorkspaceHtmlPublishBlocked: (...args: unknown[]) => mocks.notifyBlocked(...args),
  prepareWorkspaceHtmlPublish: (...args: unknown[]) => mocks.prepare(...args),
  publishPreparedWorkspaceHtml: (...args: unknown[]) => mocks.publishPrepared(...args),
}));
vi.mock('./PublishHtmlArtifactConfirm', () => ({
  openWorkspaceHtmlPublishConfirm: (...args: unknown[]) => mocks.openConfirm(...args),
}));

const externalResource = {
  absolutePath: '/tmp/site/logo.png',
  contentType: 'image/png',
  hrefs: ['logo.png'],
};

const readyPlan = (resources = [externalResource], missing: string[] = []) =>
  ({
    gathered: {
      entryPath: 'index.html',
      files: [
        {
          content: '<html><img src="logo.png"></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
      ],
      identifier: 'copied',
      missing,
      resources,
      title: 'Demo',
    },
    packed: { html: '<html></html>', inlinedPaths: [], sidecars: [], unresolvedHrefs: [] },
  }) as never;

const ready = readyPlan();

const input = {
  close: vi.fn(),
  copyFile: vi.fn(),
  filePath: '/tmp/site/index.html',
  hasExisting: false,
  plan: {
    blocked: 'outside-workspace' as const,
    escaped: [{ absolutePath: '/tmp/site/logo.png', hrefs: ['logo.png'] }],
    gathered: {
      entryPath: 'index.html',
      files: [
        {
          content: '<html><img src="logo.png"></html>',
          contentType: 'text/html',
          encoding: 'utf8' as const,
          path: 'index.html',
        },
      ],
    } as never,
  },
  publish: vi.fn(),
  topicId: 'topic-1',
  workingDirectory: '/project',
  writeFile: vi.fn(),
};

const copied = {
  entryPath: '/project/.lobe-artifacts/copied/index.html',
  failed: [],
  htmlContent: '<html><img src="logo.png"></html>',
  targetDirectory: '/project/.lobe-artifacts/copied',
};

describe('useBlockedWorkspaceHtmlPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publishPrepared.mockResolvedValue({ id: 'published' });
  });

  it('copies immediately when closure discovery adds no files, then safely prepares', async () => {
    mocks.prepare.mockResolvedValueOnce(ready).mockResolvedValueOnce(ready);
    mocks.copy.mockResolvedValue(copied);
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    await act(() => result.current.handleContinue());

    expect(mocks.prepare.mock.calls[0][0]).toEqual(
      expect.objectContaining({ allowExternalReads: true, filePath: '/tmp/site/index.html' }),
    );
    expect(mocks.copy).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlFilePath: '/tmp/site/index.html',
        resources: [externalResource],
        writeFile: input.writeFile,
      }),
    );
    expect(mocks.prepare.mock.calls[1][0]).toEqual({
      deviceId: undefined,
      filePath: copied.entryPath,
      sandboxTopicId: undefined,
      workingDirectory: '/project',
    });
    expect(mocks.openConfirm).toHaveBeenCalledOnce();
  });

  it('hands the confirmed plan to runPublish instead of publishing inline', async () => {
    mocks.prepare.mockResolvedValueOnce(ready).mockResolvedValueOnce(ready);
    mocks.copy.mockResolvedValue(copied);
    const runPublish = vi.fn();
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish({ ...input, runPublish }));

    await act(() => result.current.handleContinue());
    mocks.openConfirm.mock.calls[0][0].onOk();

    expect(runPublish).toHaveBeenCalledWith({
      plan: ready,
      successMessage: 'workingPanel.localFile.publish.outsideWorkspace.copiedToast',
    });
    expect(mocks.publishPrepared).not.toHaveBeenCalled();
  });

  it('shows newly discovered closure files and requires a second click before copying', async () => {
    const localResource = {
      absolutePath: '/project/assets/app.css',
      contentType: 'text/css',
      hrefs: ['/assets/app.css'],
      text: 'body{}',
    };
    const closure = readyPlan([externalResource, localResource]);
    mocks.prepare
      .mockResolvedValueOnce(closure)
      .mockResolvedValueOnce(closure)
      .mockResolvedValueOnce(ready);
    mocks.copy.mockResolvedValue(copied);
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    await act(() => result.current.handleContinue());

    expect(mocks.copy).not.toHaveBeenCalled();
    expect(result.current.resources).toEqual([
      externalResource,
      expect.objectContaining({ ...localResource, source: 'workspace' }),
    ]);

    await act(() => result.current.handleContinue());

    expect(mocks.copy).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [externalResource, localResource] }),
    );
    expect(mocks.openConfirm).toHaveBeenCalledOnce();
  });

  it('hard-blocks when the safe prepare still has missing files', async () => {
    mocks.prepare
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(readyPlan([externalResource], ['gone.png']));
    mocks.copy.mockResolvedValue(copied);
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    await act(() => result.current.handleContinue());

    expect(mocks.openConfirm).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'workingPanel.localFile.publish.outsideWorkspace.stillBlocked',
    );
    expect(mocks.debugLog).toHaveBeenCalledWith(expect.any(String), ['gone.png']);
  });

  it('does not reopen a confirm after the user cancels a pending closure read', async () => {
    let resolvePrepare: (value: typeof ready) => void = () => {};
    mocks.prepare.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePrepare = resolve;
      }),
    );
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.handleContinue();
    });
    act(() => result.current.cancel());
    await act(async () => {
      resolvePrepare(ready);
      await pending!;
    });

    expect(input.close).toHaveBeenCalledOnce();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.openConfirm).not.toHaveBeenCalled();
  });

  it('clears resource-copy failures so a second attempt can succeed', async () => {
    mocks.prepare
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready);
    mocks.copy.mockResolvedValueOnce({ failed: [externalResource] }).mockResolvedValueOnce(copied);
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    await act(() => result.current.handleContinue());
    expect(result.current.failed).toEqual([externalResource]);

    await act(() => result.current.handleContinue());
    expect(result.current.failed).toEqual([]);
    expect(mocks.copy).toHaveBeenCalledTimes(2);
    expect(mocks.openConfirm).toHaveBeenCalledOnce();
  });

  it('requires warning confirmation before using the external publish reader', async () => {
    mocks.prepare.mockResolvedValue(ready);
    const { result } = renderHook(() => useBlockedWorkspaceHtmlPublish(input));

    act(() => result.current.handleForceChange(true));
    expect(result.current.force).toBe(false);
    act(() => mocks.confirmModal.mock.calls[0][0].onOk());
    expect(result.current.force).toBe(true);

    await act(() => result.current.handleContinue());

    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ allowExternalReads: true, filePath: '/tmp/site/index.html' }),
    );
    expect(mocks.openConfirm).toHaveBeenCalledOnce();
  });
});
