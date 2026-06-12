import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentService as DocumentServiceType } from './index';

const mockMutate = vi.fn();

describe('DocumentService.updateDocument', () => {
  let DocumentService: typeof DocumentServiceType;
  let service: DocumentServiceType;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/libs/trpc/client', () => ({
      lambdaClient: {
        document: {
          updateDocument: {
            mutate: mockMutate,
          },
        },
      },
    }));
    ({ DocumentService } = await import('./index'));
    service = new DocumentService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends breakAutosaveWindow: true on first autosave for a doc id', async () => {
    mockMutate.mockResolvedValue({ historyAppended: true, id: 'doc-1', savedAt: undefined });

    await service.updateDocument({ editorData: 'data', id: 'doc-1', saveSource: 'autosave' });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ breakAutosaveWindow: true, id: 'doc-1' }),
    );
  });

  it('does not send breakAutosaveWindow on second autosave for same doc id', async () => {
    mockMutate.mockResolvedValue({ historyAppended: true, id: 'doc-1', savedAt: undefined });

    await service.updateDocument({ editorData: 'data1', id: 'doc-1', saveSource: 'autosave' });
    await service.updateDocument({ editorData: 'data2', id: 'doc-1', saveSource: 'autosave' });

    expect(mockMutate).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ breakAutosaveWindow: true }),
    );
  });

  it('retries breakAutosaveWindow on next autosave when first mutation fails', async () => {
    mockMutate
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue({ historyAppended: true, id: 'doc-2', savedAt: undefined });

    await expect(
      service.updateDocument({ editorData: 'data', id: 'doc-2', saveSource: 'autosave' }),
    ).rejects.toThrow('network error');

    await service.updateDocument({ editorData: 'data', id: 'doc-2', saveSource: 'autosave' });

    expect(mockMutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ breakAutosaveWindow: true, id: 'doc-2' }),
    );
  });

  it('never sends breakAutosaveWindow for non-autosave saves', async () => {
    mockMutate.mockResolvedValue({ historyAppended: true, id: 'doc-3', savedAt: undefined });

    await service.updateDocument({ editorData: 'data', id: 'doc-3', saveSource: 'manual' });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ breakAutosaveWindow: true }),
    );
  });

  it('non-autosave save does not consume the one-shot for the same doc id', async () => {
    mockMutate.mockResolvedValue({ historyAppended: true, id: 'doc-4', savedAt: undefined });

    await service.updateDocument({ editorData: 'data', id: 'doc-4', saveSource: 'manual' });
    await service.updateDocument({ editorData: 'data', id: 'doc-4', saveSource: 'autosave' });

    expect(mockMutate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ breakAutosaveWindow: true, id: 'doc-4' }),
    );
  });
});
