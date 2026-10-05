import { describe, expect, it, vi } from 'vitest';

import { saveDerivedFile, type SaveDerivedFileDeps } from './saveDerivedFile';

const createDeps = (overrides: Partial<SaveDerivedFileDeps> = {}) =>
  ({
    addToKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue({ knowledgeBaseIds: [], parentId: null }),
    uploadFile: vi.fn().mockResolvedValue({ id: 'file_new', url: 'files/new.png' }),
    ...overrides,
  }) as SaveDerivedFileDeps & Record<keyof SaveDerivedFileDeps, ReturnType<typeof vi.fn>>;

const params = {
  file: new File(['x'], 'sunset-resized.png', { type: 'image/png' }),
  metadata: { derivedFrom: { fileId: 'file_src', operation: 'resize' } },
  sourceId: 'file_src',
};

describe('saveDerivedFile', () => {
  it('files the edit into every library the original belongs to', async () => {
    const deps = createDeps({
      getFile: vi.fn().mockResolvedValue({ knowledgeBaseIds: ['kb_1', 'kb_2'], parentId: null }),
    });

    const result = await saveDerivedFile(deps, params);

    expect(result).toEqual({ id: 'file_new', url: 'files/new.png' });
    expect(deps.getFile).toHaveBeenCalledWith('file_src');
    expect(deps.addToKnowledgeBase).toHaveBeenCalledWith('kb_1', ['file_new']);
    expect(deps.addToKnowledgeBase).toHaveBeenCalledWith('kb_2', ['file_new']);
  });

  it('uses the folder reported by the server over the client hint', async () => {
    const deps = createDeps({
      getFile: vi.fn().mockResolvedValue({ knowledgeBaseIds: [], parentId: 'docs_server' }),
    });

    await saveDerivedFile(deps, { ...params, parentId: 'docs_client' });

    expect(deps.uploadFile).toHaveBeenCalledWith({
      file: params.file,
      metadata: params.metadata,
      parentId: 'docs_server',
    });
    expect(deps.addToKnowledgeBase).not.toHaveBeenCalled();
  });

  // Regression: a top-level upload defaults to private, hiding edits of a
  // public workspace image from collaborators who can see the original.
  it('keeps the visibility of the original', async () => {
    const deps = createDeps({
      getFile: vi
        .fn()
        .mockResolvedValue({ knowledgeBaseIds: [], parentId: null, visibility: 'public' }),
    });

    await saveDerivedFile(deps, params);

    expect(deps.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }));
  });

  it('still saves beside the client-known folder when the lookup fails', async () => {
    const deps = createDeps({ getFile: vi.fn().mockRejectedValue(new Error('offline')) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await saveDerivedFile(deps, { ...params, parentId: 'docs_client' });

    expect(result?.id).toBe('file_new');
    expect(deps.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'docs_client' }),
    );
  });

  it('keeps the saved file when adding it to a library fails', async () => {
    const deps = createDeps({
      addToKnowledgeBase: vi.fn().mockRejectedValue(new Error('denied')),
      getFile: vi.fn().mockResolvedValue({ knowledgeBaseIds: ['kb_1'], parentId: null }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(saveDerivedFile(deps, params)).resolves.toEqual({
      id: 'file_new',
      url: 'files/new.png',
    });
  });

  it('adds nothing to libraries when the upload does not complete', async () => {
    const deps = createDeps({
      getFile: vi.fn().mockResolvedValue({ knowledgeBaseIds: ['kb_1'], parentId: null }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    });

    expect(await saveDerivedFile(deps, params)).toBeUndefined();
    expect(deps.addToKnowledgeBase).not.toHaveBeenCalled();
  });
});
