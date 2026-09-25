import {
  describeLiteXMLEditStep,
  findLiteXMLEditStepProblem,
  indexLiteXMLDocument,
  normalizeLiteXMLFragment,
  planLiteXMLEditSteps,
  touchesList,
} from '@lobechat/editor-runtime';
import type { HeadlessLiteXMLOperation } from '@lobehub/editor/headless';
import { createHeadlessEditor } from '@lobehub/editor/headless';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';

export type AgentDocumentEditorData = Record<string, any>;

export type AgentDocumentLiteXMLOperation =
  | {
      action: 'insert';
      afterId: string;
      litexml: string;
    }
  | {
      action: 'insert';
      beforeId: string;
      litexml: string;
    }
  | {
      action: 'modify';
      litexml: string | string[];
    }
  | {
      action: 'remove';
      id: string;
    };

const toHeadlessLiteXMLOperation = (
  operation: AgentDocumentLiteXMLOperation,
  delay: boolean,
): HeadlessLiteXMLOperation => {
  switch (operation.action) {
    case 'insert': {
      return 'beforeId' in operation
        ? {
            action: 'insert',
            beforeId: operation.beforeId,
            delay,
            litexml: normalizeLiteXMLFragment(operation.litexml),
          }
        : {
            action: 'insert',
            afterId: operation.afterId,
            delay,
            litexml: normalizeLiteXMLFragment(operation.litexml),
          };
    }

    case 'modify': {
      return {
        action: 'replace',
        delay,
        litexml: operation.litexml,
      };
    }

    case 'remove': {
      return {
        action: 'remove',
        delay,
        id: operation.id,
      };
    }
  }
};

const NOTHING_SAVED_HINT =
  'No operations were saved. Call readDocument to get the current node ids, then retry the whole batch.';

export interface AgentDocumentEditorSnapshot {
  content: string;
  editorData: AgentDocumentEditorData;
  litexml?: string;
  recoveredFromMarkdown?: true;
}

export interface AgentDocumentEditSnapshot extends AgentDocumentEditorSnapshot {
  previousEditorData: AgentDocumentEditorData;
}

interface LoadEditorStateParams {
  editorData?: AgentDocumentEditorData | null;
  fallbackContent?: string;
}

// @lobehub/editor's headless Lexical runtime keeps process-global node state while
// hydrating snapshots with stable ids. Concurrent document reads can therefore
// corrupt one another (or observe a partially initialized HeadlessEditor). Keep
// the complete create/hydrate/export/destroy lifecycle serialized.
let headlessEditorTail: Promise<void> = Promise.resolve();

const withHeadlessEditorLock = async <T>(run: () => Promise<T> | T): Promise<T> => {
  const previous = headlessEditorTail;
  let release: () => void = () => {};
  headlessEditorTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await run();
  } finally {
    release();
  }
};

const exportSnapshot = (
  editor: ReturnType<typeof createHeadlessEditor>,
  litexml = false,
): AgentDocumentEditorSnapshot => {
  const snapshot = editor.export({ litexml });

  return {
    content: snapshot.markdown,
    editorData: snapshot.editorData as SerializedEditorState<SerializedLexicalNode>,
    litexml: snapshot.litexml,
  };
};

const hydrateMarkdownOrEmptyState = (
  editor: ReturnType<typeof createHeadlessEditor>,
  content: string,
  options?: { keepId?: boolean },
) => {
  if (content.trim().length === 0) {
    editor.hydrateEditorData(
      EMPTY_EDITOR_STATE as unknown as SerializedEditorState<SerializedLexicalNode>,
      options,
    );
    return;
  }

  editor.hydrateMarkdown(content, options);
};

const createEditorWithState = (
  createEditor: typeof createHeadlessEditor,
  { editorData, fallbackContent = '' }: LoadEditorStateParams,
) => {
  let editor = createEditor();

  if (isValidEditorData(editorData)) {
    try {
      editor.hydrateEditorData(
        editorData as unknown as SerializedEditorState<SerializedLexicalNode>,
        {
          keepId: true,
        },
      );

      const hydratedContent = editor.export().markdown;
      if (fallbackContent.trim().length === 0 || hydratedContent.trim().length > 0) {
        return { editor, recoveredFromMarkdown: false };
      }
    } catch (error) {
      console.error('[AgentDocumentsService] Failed to hydrate editorData:', error);
    }

    // Some editor schema/version mismatches fail without throwing and leave the
    // editor at an empty root. Recreate the editor before hydrating Markdown so
    // no partially parsed Lexical state can leak into the fallback snapshot.
    editor.destroy();
    editor = createEditor();
  }

  hydrateMarkdownOrEmptyState(editor, fallbackContent, { keepId: true });
  // Node ids minted from Markdown differ on every parse, so any snapshot that
  // exposes them must be persisted — including editorData in a non-Lexical shape
  // (older `lh doc` builds wrote `{ type: 'doc', content }`) or none at all.
  return {
    editor,
    recoveredFromMarkdown: isValidEditorData(editorData) || fallbackContent.trim().length > 0,
  };
};

export const createMarkdownEditorSnapshot = async (
  content: string,
): Promise<AgentDocumentEditorSnapshot> =>
  withHeadlessEditorLock(() => {
    const editor = createHeadlessEditor();

    try {
      hydrateMarkdownOrEmptyState(editor, content);
      return exportSnapshot(editor);
    } finally {
      editor.destroy();
    }
  });

const LITEXML_DOCUMENT_PATTERN = /^\s*(?:<\?xml[\s?]|<root[\s>])/;

/**
 * Markdown snapshot for content written by an agent. Rejects input that would
 * silently become an empty document — most often LiteXML sent to a Markdown
 * write API — instead of saving the empty result and reporting success.
 */
export const createAgentMarkdownSnapshot = async (
  content: string,
): Promise<AgentDocumentEditorSnapshot> => {
  if (LITEXML_DOCUMENT_PATTERN.test(content)) {
    throw new Error(
      'Document content looks like LiteXML, but this API expects Markdown. Send Markdown, or use modifyNodes to edit nodes by id.',
    );
  }

  const snapshot = await createMarkdownEditorSnapshot(content);

  if (content.trim().length > 0 && snapshot.content.trim().length === 0) {
    throw new Error(
      'Document content produced an empty document after Markdown parsing; nothing was saved. Send the document body as Markdown.',
    );
  }

  return snapshot;
};

export const exportEditorDataSnapshot = async (
  params: LoadEditorStateParams & { litexml?: boolean },
): Promise<AgentDocumentEditorSnapshot> =>
  withHeadlessEditorLock(() => {
    const { editor, recoveredFromMarkdown } = createEditorWithState(createHeadlessEditor, params);

    try {
      const snapshot = exportSnapshot(editor, params.litexml);

      return recoveredFromMarkdown ? { ...snapshot, recoveredFromMarkdown: true } : snapshot;
    } finally {
      editor.destroy();
    }
  });

export const applyLiteXMLOperations = async ({
  editorData,
  fallbackContent,
  operations,
}: LoadEditorStateParams & {
  operations: AgentDocumentLiteXMLOperation[];
}): Promise<AgentDocumentEditSnapshot> =>
  withHeadlessEditorLock(async () => {
    const { editor } = createEditorWithState(createHeadlessEditor, { editorData, fallbackContent });

    try {
      const beforeSnapshot = exportSnapshot(editor, true);
      let current = beforeSnapshot;

      // Apply in array order, one operation at a time, so every operation is
      // checked on its own: an unknown id or an operation the editor silently
      // drops fails the whole batch instead of being counted as applied.
      for (const step of planLiteXMLEditSteps(operations)) {
        const { operation } = step;
        const label = describeLiteXMLEditStep(step, operations.length);
        const document = indexLiteXMLDocument(current.litexml ?? '');

        const problem = findLiteXMLEditStepProblem(operation, document);
        if (problem) throw new Error(`${label} failed: ${problem}. ${NOTHING_SAVED_HINT}`);

        await editor.applyLiteXML(
          toHeadlessLiteXMLOperation(operation, !touchesList(operation, document)),
        );
        const next = exportSnapshot(editor, true);

        if (
          next.litexml === current.litexml &&
          JSON.stringify(next.editorData) === JSON.stringify(current.editorData)
        ) {
          throw new Error(
            `${label} did not change the document; the editor rejected it. ${NOTHING_SAVED_HINT}`,
          );
        }

        current = next;
      }

      const snapshot = current;

      if (fallbackContent?.trim().length && snapshot.content.trim().length === 0) {
        throw new Error('Agent document node edit unexpectedly produced empty content');
      }

      return { ...snapshot, previousEditorData: beforeSnapshot.editorData };
    } finally {
      editor.destroy();
    }
  });
