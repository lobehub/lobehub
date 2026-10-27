import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preparePageConversation } from './pageConversation';

const { documentState, prepare, warning } = vi.hoisted(() => ({
  documentState: { activeDocumentId: 'doc_active' as string | undefined },
  prepare: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { warning } }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/store/document', () => ({ useDocumentStore: { getState: () => documentState } }));
vi.mock('@/store/document/preparePageForAgent', () => ({ preparePageForAgent: prepare }));

describe('preparePageConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepare.mockResolvedValue('ready');
  });

  it('falls back to the open page and gets it ready', async () => {
    expect(await preparePageConversation({ scope: 'page' })).toBe('doc_active');
    expect(prepare).toHaveBeenCalledWith('doc_active');
  });

  it('keeps the page the caller passed', async () => {
    expect(await preparePageConversation({ documentId: 'doc_new', scope: 'page' })).toBeUndefined();
    expect(prepare).toHaveBeenCalledWith('doc_new');
  });

  it('warns when a room page has not synced', async () => {
    prepare.mockResolvedValue('notSynced');

    await preparePageConversation({ scope: 'page' });

    expect(warning).toHaveBeenCalledWith('pageEditor.collab.notSynced');
  });

  it('does nothing outside page scope', async () => {
    expect(await preparePageConversation({ scope: 'main' })).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });
});
