import {
  type CapturedCollaborativeRewriteSelection,
  hashRewriteText,
  IAISessionService,
  type IEditor,
  IMarkdownShortCutService,
  normalizeRewriteText,
} from '@lobehub/editor';

export interface PageAIProvenanceFocusInput {
  /** Keep keyboard focus outside the editor; skip the legacy native selection fallback. */
  focusEditor?: boolean;
  /** False when a single Page-owned draft highlighter owns selection feedback. */
  highlight?: boolean;
  requestId?: string;
  selection?: CapturedCollaborativeRewriteSelection | Record<string, unknown>;
  sessionId?: string;
}

export type PageAIProvenanceContinuationStatus = 'changed' | 'deleted' | 'ready' | 'unavailable';

export interface PageAIProvenanceContinuationCheck {
  ranges: ReadonlyArray<{ text: string }>;
  status: PageAIProvenanceContinuationStatus;
}

const getAISessionService = (editor: IEditor | undefined) =>
  editor?.requireService(IAISessionService) ?? null;

const getParsedMarkdownText = (node: unknown, seen = new WeakSet<object>()): string => {
  if (typeof node !== 'object' || node === null || seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node)) return node.map((child) => getParsedMarkdownText(child, seen)).join('');

  const record = node as { children?: unknown; text?: unknown; type?: unknown };
  if (record.type === 'cursor') return '';
  if (typeof record.text === 'string') return record.text;
  return getParsedMarkdownText(record.children, seen);
};

const isLegacySelection = (
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | undefined,
): selection is {
  endNodeId: string;
  endOffset: number;
  startNodeId: string;
  startOffset: number;
} => {
  if (!selection || typeof selection !== 'object') return false;

  const candidate = selection as Record<string, unknown>;
  return (
    typeof candidate.startNodeId === 'string' &&
    typeof candidate.endNodeId === 'string' &&
    Number.isSafeInteger(candidate.startOffset) &&
    Number.isSafeInteger(candidate.endOffset) &&
    (candidate.kind === undefined || candidate.kind === 'block' || candidate.kind === 'relative')
  );
};

const focusLegacySelection = (
  editor: IEditor | undefined,
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown> | undefined,
): void => {
  if (!editor || !isLegacySelection(selection)) return;

  void Promise.resolve(
    editor.setSelection({
      endNodeId: selection.endNodeId,
      endOffset: selection.endOffset,
      startNodeId: selection.startNodeId,
      startOffset: selection.startOffset,
      type: 'range',
    }),
  ).then((selected) => {
    if (selected !== false) editor.focus();
  });
};

const scrollToSession = (
  editor: IEditor,
  sessionId: string,
  ranges: ReadonlyArray<{ key?: string; nodeKey?: string; text: string }>,
): boolean => {
  const root = editor.getRootElement?.();
  if (!root) return false;

  const sessionElements = Array.from(
    root.querySelectorAll<HTMLElement>('[data-ai-session-id]'),
  ).filter((element) => element.dataset.aiSessionId === sessionId);
  if (sessionElements.length === 0) return false;

  const lexicalEditor = editor.getLexicalEditor?.();
  const rangeNodeKeys = new Set(
    ranges.flatMap(({ key, nodeKey }) =>
      [nodeKey, key].filter((value): value is string => !!value),
    ),
  );
  const keyedElement = lexicalEditor
    ? ranges
        .map(({ key, nodeKey }) => lexicalEditor.getElementByKey(nodeKey ?? key ?? ''))
        .find((element): element is HTMLElement => Boolean(element && root.contains(element)))
    : null;
  const target =
    keyedElement &&
    (rangeNodeKeys.size === 0 ||
      rangeNodeKeys.has(keyedElement.dataset.lexicalNodeKey ?? '') ||
      sessionElements.includes(keyedElement))
      ? keyedElement
      : sessionElements[0];
  if (!target || typeof target.scrollIntoView !== 'function') return false;

  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  return true;
};

/**
 * Validate a continuation against the live marked output. The server remains
 * authoritative, but the Page must not open a continuation against deleted or
 * changed generated text.
 */
export const inspectPageAIProvenanceContinuation = (
  editor: IEditor | undefined,
  input: {
    appliedTextHash?: string | null;
    outputText?: string | null;
    sessionId?: string | null;
  },
): PageAIProvenanceContinuationCheck => {
  if (!editor || !input.sessionId || !input.outputText) {
    return { ranges: [], status: 'unavailable' };
  }

  const service = getAISessionService(editor);
  if (!service) return { ranges: [], status: 'unavailable' };

  try {
    const ranges = service.getRanges(input.sessionId);
    // An empty client-side projection is not proof that the persisted text
    // was deleted. The editor may still be hydrating, or its AISessionPlugin
    // may not have refreshed after a collaborative snapshot arrived. The
    // continuation API performs the authoritative locked database check.
    if (ranges.length === 0) return { ranges, status: 'unavailable' };

    const liveText = ranges.map((range) => range.text).join('');
    const rawMatches = normalizeRewriteText(liveText) === normalizeRewriteText(input.outputText);
    const expectedTextHash =
      typeof input.appliedTextHash === 'string' && input.appliedTextHash.length > 0
        ? input.appliedTextHash
        : rawMatches
          ? null
          : (() => {
              const markdownService = editor.requireService(IMarkdownShortCutService);
              if (!markdownService) return null;
              return hashRewriteText(
                getParsedMarkdownText(markdownService.parseMarkdownToLexical(input.outputText!)),
              );
            })();

    const matches = expectedTextHash ? hashRewriteText(liveText) === expectedTextHash : rawMatches;
    return { ranges, status: matches ? 'ready' : 'changed' };
  } catch {
    return { ranges: [], status: 'unavailable' };
  }
};

export const setPageAIProvenanceHighlight = (
  editor: IEditor | undefined,
  input: { active: boolean; sessionId: string },
): void => {
  const service = getAISessionService(editor);
  service?.setHoveredSessionId(input.active ? input.sessionId : null);
};

export const clearPageAIProvenanceFocus = (editor: IEditor | undefined): void => {
  getAISessionService(editor)?.clearSessionFocus();
};

export const focusPageAIProvenance = (
  editor: IEditor | undefined,
  input: PageAIProvenanceFocusInput,
): void => {
  if (!editor) return;

  const service = getAISessionService(editor);
  if (input.highlight === false) service?.clearSessionFocus();
  if (input.sessionId && service) {
    try {
      const ranges = service.getRanges(input.sessionId);
      if (ranges.length > 0) {
        if (input.highlight !== false) service.focusSession(input.sessionId);
        scrollToSession(editor, input.sessionId, ranges);
        return;
      }

      // Keep the durable session focus even when this editor has not yet
      // materialized its provenance nodes. The Page highlight plugin listens
      // to this service state and will project the session as soon as ranges
      // arrive; the legacy selection remains a one-time fallback below.
      if (input.highlight !== false) service.focusSession(input.sessionId);
    } catch {
      // Fall through to the legacy selection projection below.
    }

    if (input.highlight === false || service.getActiveSessionId?.() === input.sessionId) {
      // The session focus is intentionally retained while provenance hydrates.
      // A genuinely missing session still has no ranges to render.
    } else {
      // Do not leave an active highlight pointing at an orphaned session.
      service.clearSessionFocus();
    }
  }

  // Legacy rows have no session provenance. Restore their original selection
  // when available, without pretending that the generated output is marked.
  if (input.focusEditor === false) return;
  focusLegacySelection(editor, input.selection);
};
