import { useEffect, useRef, useState } from 'react';

/** Page JSON is a render-time snapshot; the relay/database snapshot owns Yjs. */
export const PAGE_COLLABORATION_SHOULD_BOOTSTRAP = false;

export interface PageCollaborationFatalError {
  code: string;
  fatal?: boolean;
  message: string;
}

export type PageCollaborationErrorPresentation = {
  descriptionKey:
    | 'pageEditor.editMode.collaboration.backendUnavailableDescription'
    | 'pageEditor.editMode.collaboration.readOnlyDescription'
    | 'pageEditor.editMode.lockedDescription';
  titleKey:
    | 'pageEditor.editMode.collaboration.backendUnavailableTitle'
    | 'pageEditor.editMode.collaboration.readOnlyTitle'
    | 'pageEditor.editMode.lockedBySomeone';
  type: 'error' | 'info' | 'warning';
};

/**
 * A terminal room error is not necessarily an edit-lock conflict. Keep the
 * occupied copy reserved for the relay's explicit browser-capacity error;
 * auth, version, and backend failures leave the editor read-only for other
 * reasons and need their own actionable copy.
 */
export const getPageCollaborationErrorPresentation = (
  code: unknown,
): PageCollaborationErrorPresentation => {
  switch (code) {
    case 'browser_client_limit': {
      return {
        descriptionKey: 'pageEditor.editMode.lockedDescription',
        titleKey: 'pageEditor.editMode.lockedBySomeone',
        type: 'warning',
      };
    }
    case 'backend_unavailable':
    case 'provider_terminated': {
      return {
        descriptionKey: 'pageEditor.editMode.collaboration.backendUnavailableDescription',
        titleKey: 'pageEditor.editMode.collaboration.backendUnavailableTitle',
        type: 'error',
      };
    }
    default: {
      return {
        descriptionKey: 'pageEditor.editMode.collaboration.readOnlyDescription',
        titleKey: 'pageEditor.editMode.collaboration.readOnlyTitle',
        type: 'info',
      };
    }
  }
};

export interface PageCollaborationProviderState {
  error: PageCollaborationFatalError | null;
  hasSynced: boolean;
  hasSyncedOnce: boolean;
}

interface PageCollaborationProviderLike {
  off?: (type: 'status' | 'sync', listener: (...args: any[]) => void) => void;
  on?: (type: 'status' | 'sync', listener: (...args: any[]) => void) => void;
  waitForSync?: () => Promise<void> | void;
}

interface PageCollaborationServiceStateLike {
  provider?: PageCollaborationProviderLike;
}

interface PageCollaborationServiceLike {
  subscribe: (listener: (state: PageCollaborationServiceStateLike | null) => void) => () => void;
}

const PROVIDER_TERMINATED_ERROR: PageCollaborationFatalError = {
  code: 'provider_terminated',
  message: 'The collaboration provider terminated before it could resume the room.',
};

const providerErrorFrom = (error: unknown): PageCollaborationFatalError => {
  const candidate = error as { code?: unknown; fatal?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : 'provider_terminated';
  const message = error instanceof Error ? error.message : PROVIDER_TERMINATED_ERROR.message;
  return {
    code,
    ...(typeof candidate?.fatal === 'boolean' ? { fatal: candidate.fatal } : {}),
    message,
  };
};

/**
 * Bridge the editor provider's public status/sync lifecycle into Page state.
 * Page deliberately does not parse websocket frames: the provider owns wire
 * protocol errors and exposes terminal failure through waitForSync rejection.
 */
export const subscribePageCollaborationProvider = (
  service: PageCollaborationServiceLike,
  onState: (state: PageCollaborationProviderState) => void,
): (() => void) => {
  let disposed = false;
  let provider: PageCollaborationProviderLike | null = null;
  let providerToken = 0;
  let hasSyncedOnce = false;
  let terminalError: PageCollaborationFatalError | null = null;
  let providerUnsubscribe: (() => void) | undefined;
  let syncWaitInFlight = false;

  const emit = (state: PageCollaborationProviderState): void => {
    if (!disposed) onState({ ...state, error: state.error ?? terminalError });
  };

  const watchSync = (nextProvider: PageCollaborationProviderLike): void => {
    if (syncWaitInFlight || typeof nextProvider.waitForSync !== 'function') return;
    syncWaitInFlight = true;
    const token = providerToken;
    Promise.resolve()
      .then(() => nextProvider.waitForSync?.())
      .then(() => {
        if (disposed || token !== providerToken || provider !== nextProvider) return;
        terminalError = null;
        hasSyncedOnce = true;
        emit({ error: null, hasSynced: true, hasSyncedOnce: true });
      })
      .catch((error) => {
        if (disposed || token !== providerToken || provider !== nextProvider) return;
        terminalError = providerErrorFrom(error);
        emit({ error: terminalError, hasSynced: false, hasSyncedOnce });
      })
      .finally(() => {
        if (token === providerToken) syncWaitInFlight = false;
      });
  };

  const bindProvider = (nextProvider: PageCollaborationProviderLike | null): void => {
    providerUnsubscribe?.();
    providerUnsubscribe = undefined;
    provider = nextProvider;
    providerToken += 1;
    syncWaitInFlight = false;
    hasSyncedOnce = false;
    terminalError = null;
    emit({ error: null, hasSynced: false, hasSyncedOnce: false });
    if (!nextProvider?.on || !nextProvider.off) return;

    const onSync = (synced: boolean): void => {
      if (synced) {
        terminalError = null;
        hasSyncedOnce = true;
      }
      emit({ error: null, hasSynced: synced, hasSyncedOnce });
      if (!synced) watchSync(nextProvider);
    };
    const onStatus = ({ status }: { status?: string }): void => {
      if (status !== 'disconnected') return;
      if (typeof nextProvider.waitForSync !== 'function') {
        terminalError = providerErrorFrom(new Error('Provider does not expose a sync barrier.'));
        emit({
          error: terminalError,
          hasSynced: false,
          hasSyncedOnce,
        });
        return;
      }
      watchSync(nextProvider);
    };
    nextProvider.on('sync', onSync);
    nextProvider.on('status', onStatus);
    providerUnsubscribe = () => {
      nextProvider.off?.('sync', onSync);
      nextProvider.off?.('status', onStatus);
    };
    watchSync(nextProvider);
  };

  const unsubscribeService = service.subscribe((state) => {
    bindProvider(state?.provider ?? null);
  });

  return () => {
    disposed = true;
    providerUnsubscribe?.();
    providerUnsubscribe = undefined;
    unsubscribeService();
  };
};

export interface PageCollaborationEditorLifecycleOptions {
  collaborationError?: PageCollaborationFatalError | null;
  collaborationUrl?: string;
  documentId?: string;
  editable: boolean;
  hasProviderFactory: boolean;
  hasValidBrowserTicket: boolean;
  /** Terminal provider failure surfaced by the public provider lifecycle. */
  providerError?: PageCollaborationFatalError | null;
  /** True after the current provider has completed its initial room sync. */
  providerHasSynced?: boolean;
  /** True once this editor has completed any room sync; reconnect gaps keep editing enabled. */
  providerHasSyncedOnce?: boolean;
  resetEditor?: () => void;
  userId?: string | null;
}

export interface PageCollaborationEditorLifecycle {
  /** Whether the current editor already owns a Yjs provider for this room. */
  collaborationEnabled: boolean;
  /** Fatal room rejection that makes this editor read-only. */
  collaborationError: PageCollaborationFatalError | null;
  /** Whether this Page would require a browser collaboration capability to edit. */
  collaborationRequired: boolean;
  /** Effective editability; never true before the room capability is ready. */
  editable: boolean;
  /** Whether an editable Page is waiting for its initial browser capability. */
  isWaitingForCollaboration: boolean;
}

export const getPageCollaborationSessionKey = (
  documentId?: string,
  collaborationUrl?: string,
  userId?: string | null,
): string | null =>
  documentId && collaborationUrl
    ? `${documentId}\u0000${collaborationUrl}\u0000${userId ?? ''}`
    : null;

/**
 * Keep this derivation pure so the security boundary is easy to review: an
 * editable Page with a configured room may only become editable after both a
 * valid browser ticket and a provider-backed editor lifecycle are present.
 */
export const derivePageCollaborationEditorLifecycle = ({
  activeSessionKey,
  collaborationError,
  collaborationRequired,
  hasProviderFactory,
  hasValidBrowserTicket,
  providerError,
  providerHasSynced = false,
  providerHasSyncedOnce = false,
  sessionKey,
}: {
  activeSessionKey: string | null;
  collaborationError?: PageCollaborationFatalError | null;
  collaborationRequired: boolean;
  hasProviderFactory: boolean;
  hasValidBrowserTicket: boolean;
  providerError?: PageCollaborationFatalError | null;
  providerHasSynced?: boolean;
  providerHasSyncedOnce?: boolean;
  sessionKey: string | null;
}): PageCollaborationEditorLifecycle => {
  const currentEditorOwnsRoom = Boolean(
    sessionKey && activeSessionKey === sessionKey && hasProviderFactory,
  );
  const effectiveCollaborationError = collaborationError ?? providerError ?? null;
  const providerReadyForEditing = providerHasSynced || providerHasSyncedOnce;
  const collaborationReady = Boolean(
    collaborationRequired &&
    currentEditorOwnsRoom &&
    hasValidBrowserTicket &&
    providerReadyForEditing &&
    !effectiveCollaborationError,
  );

  return {
    collaborationError: effectiveCollaborationError,
    collaborationEnabled: currentEditorOwnsRoom,
    collaborationRequired,
    editable: !collaborationRequired || collaborationReady,
    isWaitingForCollaboration:
      collaborationRequired && !collaborationReady && !effectiveCollaborationError,
  };
};

/**
 * Coordinate the one-way boundary between a read-only fallback editor and an
 * editable collaborative editor. A Lexical kernel cannot safely acquire the
 * Yjs plugin after its root has initialized, so a ticket transition creates a
 * fresh kernel before allowing editable rendering.
 */
export const usePageCollaborationEditorLifecycle = ({
  collaborationUrl,
  documentId,
  editable,
  hasProviderFactory,
  hasValidBrowserTicket,
  collaborationError,
  providerError,
  providerHasSynced,
  providerHasSyncedOnce,
  resetEditor,
  userId,
}: PageCollaborationEditorLifecycleOptions): PageCollaborationEditorLifecycle => {
  const sessionKey = getPageCollaborationSessionKey(documentId, collaborationUrl, userId);
  const collaborationRequired = Boolean(sessionKey && editable);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);
  const activationAttemptRef = useRef<string | null>(null);
  const resetEditorRef = useRef(resetEditor);
  resetEditorRef.current = resetEditor;

  useEffect(() => {
    if (!collaborationRequired || !sessionKey) return;
    if (!hasProviderFactory || !hasValidBrowserTicket) return;
    if (activeSessionKey === sessionKey) return;
    if (activationAttemptRef.current === sessionKey) return;

    // If the provider cannot replace the editor, remain read-only. This is a
    // deliberate fail-closed fallback for embedded/test callers that do not
    // provide the Page editor lifecycle context.
    if (!resetEditorRef.current) return;

    activationAttemptRef.current = sessionKey;
    resetEditorRef.current();
    setActiveSessionKey(sessionKey);
  }, [
    activeSessionKey,
    collaborationRequired,
    hasProviderFactory,
    hasValidBrowserTicket,
    sessionKey,
  ]);

  const lifecycle = derivePageCollaborationEditorLifecycle({
    activeSessionKey,
    collaborationError,
    collaborationRequired,
    hasProviderFactory,
    hasValidBrowserTicket,
    sessionKey,
    providerError,
    providerHasSynced,
    providerHasSyncedOnce,
  });

  return {
    ...lifecycle,
    editable: editable && lifecycle.editable,
  };
};
