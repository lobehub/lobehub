/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { HeadlessLiteXMLOperation } from '@lobehub/editor/headless';
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

const orderLiteXMLOperations = (
  operations: AgentDocumentLiteXMLOperation[],
): AgentDocumentLiteXMLOperation[] => {
  const orderedOperations: AgentDocumentLiteXMLOperation[] = [];

  for (const operation of operations) {
    if (operation.action === 'insert') {
      orderedOperations.unshift(operation);
    } else {
      orderedOperations.push(operation);
    }
  }

  return orderedOperations;
};

const normalizeLiteXMLFragment = (litexml: string) => {
  const trimmed = litexml.trim();

  return trimmed.startsWith('<root>') ? trimmed : `<root>${trimmed}</root>`;
};

const toHeadlessLiteXMLOperation = (
  operation: AgentDocumentLiteXMLOperation,
): HeadlessLiteXMLOperation => {
  switch (operation.action) {
    case 'insert': {
      return 'beforeId' in operation
        ? {
            action: 'insert',
            beforeId: operation.beforeId,
            delay: true,
            litexml: normalizeLiteXMLFragment(operation.litexml),
          }
        : {
            action: 'insert',
            afterId: operation.afterId,
            delay: true,
            litexml: normalizeLiteXMLFragment(operation.litexml),
          };
    }

    case 'modify': {
      return {
        action: 'replace',
        delay: true,
        litexml: operation.litexml,
      };
    }

    case 'remove': {
      return {
        action: 'remove',
        delay: true,
        id: operation.id,
      };
    }
  }
};

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

const exportSnapshot = (
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
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
  editor: ReturnType<(typeof import('@lobehub/editor/headless'))['createHeadlessEditor']>,
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
  createHeadlessEditor: (typeof import('@lobehub/editor/headless'))['createHeadlessEditor'],
  { editorData, fallbackContent = '' }: LoadEditorStateParams,
) => {
  let editor = createHeadlessEditor();

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
    editor = createHeadlessEditor();
  }

  hydrateMarkdownOrEmptyState(editor, fallbackContent, { keepId: true });
  return { editor, recoveredFromMarkdown: isValidEditorData(editorData) };
};

export const createMarkdownEditorSnapshot = async (
  content: string,
): Promise<AgentDocumentEditorSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const editor = createHeadlessEditor();

  try {
    hydrateMarkdownOrEmptyState(editor, content);
    return exportSnapshot(editor);
  } finally {
    editor.destroy();
  }
};

export const exportEditorDataSnapshot = async (
  params: LoadEditorStateParams & { litexml?: boolean },
): Promise<AgentDocumentEditorSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const { editor, recoveredFromMarkdown } = createEditorWithState(createHeadlessEditor, params);

  try {
    const snapshot = exportSnapshot(editor, params.litexml);

    return recoveredFromMarkdown ? { ...snapshot, recoveredFromMarkdown: true } : snapshot;
  } finally {
    editor.destroy();
  }
};

export const applyLiteXMLOperations = async ({
  editorData,
  fallbackContent,
  operations,
}: LoadEditorStateParams & {
  operations: AgentDocumentLiteXMLOperation[];
}): Promise<AgentDocumentEditSnapshot> => {
  const { createHeadlessEditor } = await import('@lobehub/editor/headless');
  const { editor } = createEditorWithState(createHeadlessEditor, { editorData, fallbackContent });

  try {
    const beforeSnapshot = exportSnapshot(editor, true);
    await editor.applyLiteXML(orderLiteXMLOperations(operations).map(toHeadlessLiteXMLOperation));
    const snapshot = exportSnapshot(editor, true);

    if (fallbackContent?.trim().length && snapshot.content.trim().length === 0) {
      throw new Error('Agent document node edit unexpectedly produced empty content');
    }

    if (
      operations.length > 0 &&
      JSON.stringify(snapshot.editorData) === JSON.stringify(beforeSnapshot.editorData) &&
      snapshot.litexml === beforeSnapshot.litexml
    ) {
      throw new Error('Agent document node edit did not change the document');
    }

    return { ...snapshot, previousEditorData: beforeSnapshot.editorData };
  } finally {
    editor.destroy();
  }
};
