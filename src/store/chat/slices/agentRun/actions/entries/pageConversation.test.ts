import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pageConversationNeedsGateway, preparePageConversation } from './pageConversation';

const { documentState, prepare, serverConfig, warning } = vi.hoisted(() => ({
  documentState: { activeDocumentId: 'doc_active' as string | undefined },
  prepare: vi.fn(),
  serverConfig: { agentGatewayUrl: 'https://gw', enableGatewayMode: true } as Record<string, any>,
  warning: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { warning } }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/store/document', () => ({ useDocumentStore: { getState: () => documentState } }));
vi.mock('@/store/document/preparePageForAgent', () => ({ preparePageForAgent: prepare }));
vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({ serverConfig }),
}));

describe('pageConversationNeedsGateway', () => {
  it('takes Gateway Mode for a page conversation when the deployment has a gateway', () => {
    expect(pageConversationNeedsGateway({ scope: 'page' })).toBe(true);
  });

  it('leaves other conversations to the user setting', () => {
    expect(pageConversationNeedsGateway({ scope: 'main' })).toBe(false);
  });

  it('cannot take a gateway the deployment does not have', () => {
    serverConfig.enableGatewayMode = false;
    expect(pageConversationNeedsGateway({ scope: 'page' })).toBe(false);
    serverConfig.enableGatewayMode = true;
  });
});

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
