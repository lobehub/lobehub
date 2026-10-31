/**
 * @vitest-environment happy-dom
 *
 * The local-file portal preview is a replica: a reload paints the last text
 * preview from IndexedDB while the device / sandbox confirms it. Only text
 * previews under the size cap are persisted, without the short-lived
 * `resourceBaseUrl` token; Blob-backed and oversized previews stay in memory.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { cloudSandboxService } from '@/services/cloudSandbox';
import { LocalFileResponseError } from '@/services/electron/localFileService';
import { projectFileService } from '@/services/projectFile';

import {
  initialLocalFilePreviewState,
  localFilePreviewKey,
  localFilePreviewResource,
  type LocalFilePreviewTarget,
  MAX_PERSISTED_PREVIEW_CHARS,
  MAX_PERSISTED_PREVIEWS,
  useLocalFilePreview,
  useLocalFilePreviewStore,
} from './index';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: { getLocalFilePreview: vi.fn() },
}));

vi.mock('@/services/cloudSandbox', () => ({
  cloudSandboxService: { callTool: vi.fn() },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const NOTES: LocalFilePreviewTarget = {
  deviceId: 'device-a',
  filePath: '/repo/notes.md',
  workingDirectory: '/repo',
};

const textPreview = (content: string, extra: Record<string, unknown> = {}) =>
  ({ content, contentType: 'text/markdown', type: 'text', ...extra }) as const;

const renderPreview = (target: LocalFilePreviewTarget) =>
  renderHook(
    () => ({
      preview: useLocalFilePreview(target),
      sync: useLocalFilePreviewStore.getState().useFetchPreview(target),
    }),
    { wrapper },
  );

describe('local file preview replica', () => {
  const scopes = new Set<string>();
  const keys = new Set<string>();
  let scope = '';

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const storedRow = (target: LocalFilePreviewTarget) => {
    const key = localFilePreviewKey(target);
    keys.add(key);
    return localFilePreviewResource.storage!.get({ queryKey: key, scope });
  };

  const seedRow = (target: LocalFilePreviewTarget, data: unknown) => {
    const key = localFilePreviewKey(target);
    keys.add(key);
    return localFilePreviewResource.storage!.set({ queryKey: key, scope }, {
      data,
      updatedAt: 1,
    } as never);
  };

  beforeEach(() => {
    useScope(`local-file-user-${randomUUID()}:personal`);
    act(() => useLocalFilePreviewStore.setState(initialLocalFilePreviewState));
    vi.mocked(projectFileService.getLocalFilePreview).mockReset();
    vi.mocked(cloudSandboxService.callTool).mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        [...keys].map((key) =>
          localFilePreviewResource.storage!.remove({ queryKey: key, scope: value }),
        ),
      ),
    );
    scopes.clear();
    keys.clear();
    vi.restoreAllMocks();
  });

  it('paints the persisted text preview after a reload, then swaps in the fresh read', async () => {
    await seedRow(NOTES, textPreview('# v1'));
    let answer: (preview: unknown) => void = () => {};
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );

    const { result } = renderPreview(NOTES);

    await waitFor(() => expect(result.current.preview).toEqual(textPreview('# v1')));
    expect(result.current.sync.isLoading).toBe(false);
    expect(result.current.sync.isValidating).toBe(true);
    expect(projectFileService.getLocalFilePreview).toHaveBeenCalledWith({
      allowExternalFile: undefined,
      deviceId: 'device-a',
      path: '/repo/notes.md',
      workingDirectory: '/repo',
    });

    await act(async () => {
      answer(textPreview('# v2'));
    });

    await waitFor(() => expect(result.current.preview).toEqual(textPreview('# v2')));
    await waitFor(async () => expect((await storedRow(NOTES))?.data).toEqual(textPreview('# v2')));
  });

  it('keys previews by device and working directory', async () => {
    const otherDevice = { ...NOTES, deviceId: 'device-b' };
    await seedRow(NOTES, textPreview('device a'));
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise(() => {}) as never,
    );

    const { result } = renderPreview(otherDevice);

    await waitFor(() => expect(result.current.sync.isHydrated).toBe(true));
    expect(result.current.preview).toBeUndefined();
    expect(result.current.sync.isLoading).toBe(true);
    expect(localFilePreviewKey(NOTES)).not.toBe(localFilePreviewKey(otherDevice));
    expect(localFilePreviewKey(NOTES)).not.toBe(
      localFilePreviewKey({ ...NOTES, workingDirectory: '/other' }),
    );
  });

  it.each(['local', 'sandbox:build'])(
    'reads a device whose id is %s from that device, not a reserved source',
    async (deviceId) => {
      const target = { ...NOTES, deviceId };
      vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue(
        textPreview('on device') as never,
      );

      const { result } = renderPreview(target);

      await waitFor(() => expect(result.current.preview).toEqual(textPreview('on device')));
      expect(projectFileService.getLocalFilePreview).toHaveBeenCalledWith({
        allowExternalFile: undefined,
        deviceId,
        path: '/repo/notes.md',
        workingDirectory: '/repo',
      });
      expect(cloudSandboxService.callTool).not.toHaveBeenCalled();
      expect(localFilePreviewKey(target)).not.toBe(
        localFilePreviewKey({ ...NOTES, deviceId: undefined }),
      );
    },
  );

  it('never persists the preview token URL', async () => {
    const html = { ...NOTES, filePath: '/repo/index.html' };
    vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue(
      textPreview('<p>hi</p>', {
        contentType: 'text/html',
        resourceBaseUrl: 'localfile://session-token/',
      }) as never,
    );

    const { result } = renderPreview(html);

    await waitFor(() =>
      expect(result.current.preview).toMatchObject({
        resourceBaseUrl: 'localfile://session-token/',
      }),
    );
    await waitFor(async () =>
      expect((await storedRow(html))?.data).toEqual({
        content: '<p>hi</p>',
        contentType: 'text/html',
        type: 'text',
      }),
    );
  });

  it('keeps image previews in memory only', async () => {
    const image = { ...NOTES, filePath: '/repo/logo.png' };
    const blob = new Blob(['png'], { type: 'image/png' });
    vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue({
      blob,
      contentType: 'image/png',
      type: 'image',
    } as never);

    const { result } = renderPreview(image);

    await waitFor(() => expect(result.current.preview).toMatchObject({ type: 'image' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await storedRow(image)).toBeUndefined();
  });

  it('drops the stored row once a file grows past the cap', async () => {
    await seedRow(NOTES, textPreview('small'));
    vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue(
      textPreview('x'.repeat(MAX_PERSISTED_PREVIEW_CHARS + 1)) as never,
    );

    const { result } = renderPreview(NOTES);

    await waitFor(() =>
      expect((result.current.preview as { content: string } | undefined)?.content.length).toBe(
        MAX_PERSISTED_PREVIEW_CHARS + 1,
      ),
    );
    await waitFor(async () => expect(await storedRow(NOTES)).toBeUndefined());
  });

  it('reads sandbox files through the sandbox tool', async () => {
    const sandbox = {
      filePath: '/workspace/a.txt',
      sandboxTopicId: 'topic-1',
      workingDirectory: '',
    };
    vi.mocked(cloudSandboxService.callTool).mockResolvedValue({
      result: { content: 'from sandbox', mimeType: 'text/plain' },
      success: true,
    } as never);

    const { result } = renderPreview(sandbox);

    await waitFor(() =>
      expect(result.current.preview).toEqual({
        content: 'from sandbox',
        contentType: 'text/plain',
        type: 'text',
      }),
    );
    expect(cloudSandboxService.callTool).toHaveBeenCalledWith(
      'readLocalFile',
      { fullContent: true, path: '/workspace/a.txt' },
      { topicId: 'topic-1' },
    );
    expect(projectFileService.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('keeps sandbox previews out of durable storage', async () => {
    const sandbox = {
      filePath: '/workspace/a.txt',
      sandboxTopicId: 'topic-1',
      workingDirectory: '',
    };
    // A row left behind by an older build must not paint a recycled sandbox's file.
    await seedRow(sandbox, textPreview('stale sandbox copy'));
    let answer: (value: unknown) => void = () => {};
    vi.mocked(cloudSandboxService.callTool).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );

    const { result } = renderPreview(sandbox);

    await waitFor(() => expect(result.current.sync.isHydrated).toBe(true));
    expect(result.current.preview).toBeUndefined();

    await act(async () => {
      answer({ result: { content: 'from sandbox', mimeType: 'text/plain' }, success: true });
    });
    await waitFor(() => expect(result.current.preview).toMatchObject({ content: 'from sandbox' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect((await storedRow(sandbox))?.data).toEqual(textPreview('stale sandbox copy'));
  });

  it('bounds the number of persisted previews per scope', () => {
    expect(localFilePreviewResource.maxPersistedEntries).toBe(MAX_PERSISTED_PREVIEWS);
    expect(MAX_PERSISTED_PREVIEWS).toBeGreaterThan(0);
  });

  it('folds a saved body into the preview and its stored row', async () => {
    vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue(
      textPreview('before') as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('before')));

    act(() => useLocalFilePreviewStore.getState().beginSave(NOTES)('after'));

    expect(result.current.preview).toEqual(textPreview('after'));
    await waitFor(async () => expect((await storedRow(NOTES))?.data).toEqual(textPreview('after')));
  });

  it('does not let a read started before a save replace the saved content', async () => {
    await seedRow(NOTES, textPreview('v1'));
    let answer: (preview: unknown) => void = () => {};
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('v1')));

    // The mount-time read is still in flight when the user saves.
    act(() => useLocalFilePreviewStore.getState().beginSave(NOTES)('saved'));
    // …and it settles afterwards with the pre-save file.
    await act(async () => {
      answer(textPreview('v1'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.preview).toEqual(textPreview('saved'));
    await waitFor(async () => expect((await storedRow(NOTES))?.data).toEqual(textPreview('saved')));
  });

  it('keeps the fresh read metadata (HTML base URL) when a save races it', async () => {
    const PAGE: LocalFilePreviewTarget = {
      filePath: '/repo/index.html',
      workingDirectory: '/repo',
    };
    // The persisted copy carries no short-lived `resourceBaseUrl`.
    await seedRow(PAGE, textPreview('<p>v1</p>', { contentType: 'text/html' }));
    let answer: (preview: unknown) => void = () => {};
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const { result } = renderPreview(PAGE);
    await waitFor(() => expect(result.current.preview?.type).toBe('text'));

    act(() => useLocalFilePreviewStore.getState().beginSave(PAGE)('<p>saved</p>'));
    await act(async () => {
      answer(
        textPreview('<p>v1</p>', {
          contentType: 'text/html',
          resourceBaseUrl: 'lobe-local://preview/token/',
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.preview).toEqual(
      textPreview('<p>saved</p>', {
        contentType: 'text/html',
        resourceBaseUrl: 'lobe-local://preview/token/',
      }),
    );
  });

  it.each([404, 403])('evicts the cached text when the file read answers %i', async (status) => {
    await seedRow(NOTES, textPreview('# obsolete'));
    let fail: (error: unknown) => void = () => {};
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((_, reject) => (fail = reject)) as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('# obsolete')));

    await act(async () => {
      fail(new LocalFileResponseError(status));
    });

    await waitFor(() => expect(result.current.preview).toBeUndefined());
    expect(result.current.sync.error).toBeInstanceOf(LocalFileResponseError);
    await waitFor(async () => expect(await storedRow(NOTES)).toBeUndefined());
  });

  it.each([404, 403])(
    'keeps the saved content when a read started before the save answers %i',
    async (status) => {
      // The persisted preview belongs to a file that was deleted meanwhile.
      await seedRow(NOTES, textPreview('# cached'));
      let fail: (error: unknown) => void = () => {};
      vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
        () => new Promise((_, reject) => (fail = reject)) as never,
      );
      const { result } = renderPreview(NOTES);
      await waitFor(() => expect(result.current.preview).toEqual(textPreview('# cached')));

      // The user saves (recreating the file) while the mount-time read is pending…
      act(() => useLocalFilePreviewStore.getState().beginSave(NOTES)('saved'));
      // …and the older read then settles with the pre-save 404 / 403.
      await act(async () => {
        fail(new LocalFileResponseError(status));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(result.current.preview).toEqual(textPreview('saved'));
      expect(result.current.sync.error).toBeUndefined();
      expect((await storedRow(NOTES))?.data).toEqual(textPreview('saved'));
    },
  );

  it('still evicts the row when a save under another identity races a terminal read', async () => {
    const first = scope;
    await seedRow(NOTES, textPreview('# forbidden'));
    const fails: ((error: unknown) => void)[] = [];
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((_, reject) => fails.push(reject)) as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('# forbidden')));

    // The read started under the first identity; the same file is saved under another…
    useScope(`local-file-user-${randomUUID()}:personal`);
    // (where the same file is open with a cached preview too)
    await seedRow(NOTES, textPreview('# other identity'));
    const { result: other } = renderPreview(NOTES);
    await waitFor(() => expect(other.current.preview).toEqual(textPreview('# other identity')));
    act(() => useLocalFilePreviewStore.getState().beginSave(NOTES)('saved elsewhere'));
    expect(other.current.preview).toEqual(textPreview('saved elsewhere'));
    // …so the first identity's 403 must still purge its own stored row.
    await act(async () => {
      fails[0](new LocalFileResponseError(403));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    useScope(first);
    await waitFor(async () => expect(await storedRow(NOTES)).toBeUndefined());
  });

  it('keeps the cached text when the file read fails transiently', async () => {
    await seedRow(NOTES, textPreview('# cached'));
    let fail: (error: unknown) => void = () => {};
    vi.mocked(projectFileService.getLocalFilePreview).mockImplementation(
      () => new Promise((_, reject) => (fail = reject)) as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('# cached')));

    await act(async () => {
      fail(new LocalFileResponseError(500));
    });
    await waitFor(() => expect(result.current.sync.error).toBeInstanceOf(LocalFileResponseError));

    expect(result.current.preview).toEqual(textPreview('# cached'));
    expect((await storedRow(NOTES))?.data).toEqual(textPreview('# cached'));
  });

  it('drops a save that settles under another identity', async () => {
    vi.mocked(projectFileService.getLocalFilePreview).mockResolvedValue(
      textPreview('before') as never,
    );
    const { result } = renderPreview(NOTES);
    await waitFor(() => expect(result.current.preview).toEqual(textPreview('before')));

    // The save starts under this identity…
    const commit = useLocalFilePreviewStore.getState().beginSave(NOTES);
    // …and settles after an account / workspace switch.
    useScope(`local-file-user-${randomUUID()}:personal`);
    act(() => commit('saved under the previous identity'));

    expect(result.current.preview).toEqual(textPreview('before'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await storedRow(NOTES)).toBeUndefined();
  });
});
