import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { useDocumentStore } from '@/store/document';
import { preparePageForAgent } from '@/store/document/preparePageForAgent';
import { getServerConfigStoreState } from '@/store/serverConfig';

interface PageSendContext {
  documentId?: string;
  scope?: string | null;
}

/**
 * Page tools only run on the server runtime, so a page conversation takes
 * Gateway Mode whenever the deployment has a gateway, regardless of the
 * user's opt-out.
 */
export const pageConversationNeedsGateway = (context: PageSendContext) => {
  if (context.scope !== 'page') return false;
  const serverConfig = getServerConfigStoreState()?.serverConfig;
  return !!serverConfig?.agentGatewayUrl && !!serverConfig.enableGatewayMode;
};

/**
 * Gets the open page ready before a page-scoped send and returns the document
 * id to inject when the caller passed none. Callers that create a document and
 * send before its editor mounts (e.g. sendAsWrite) pass the new id explicitly;
 * the active document is only a fallback, since it may still be the previous page.
 */
export const preparePageConversation = async (
  context: PageSendContext,
): Promise<string | undefined> => {
  if (context.scope !== 'page') return;

  const activePageDocumentId = context.documentId
    ? undefined
    : (useDocumentStore.getState().activeDocumentId ?? undefined);
  const pageDocumentId = context.documentId ?? activePageDocumentId;

  // The agent reads the page when it edits it; a room page that has not
  // synced yet only gets a warning, since its edits merge either way.
  if (pageDocumentId && (await preparePageForAgent(pageDocumentId)) === 'notSynced') {
    toast.warning(t('pageEditor.collab.notSynced', { ns: 'file' }));
  }
  return activePageDocumentId;
};
