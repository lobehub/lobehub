import { isEmptyParseShell } from '@/database/models/agentDocuments';

/**
 * An "empty-parse shell" (childless-root editorData minted before #20914) cannot
 * hydrate: Lexical rejects the empty editor state with error #38, so every
 * editorData load re-throws it. Reads and the remove/rename pre-reads therefore
 * expose the static empty document instead of re-entering the editor; a later
 * modifyNodes on those ids still reports its precise "did not change the
 * document" error.
 *
 * 2026-10-16 recurrence: msg_XrvhP2q8ZReSgaeQp9 — nine pre-#20914 stubs threw
 * #38 on removeDocument/replaceDocumentContent and could not be cleaned up.
 */
export const projectEmptyParseShell = <T extends { content: string | null }>(
  doc: T,
): T & { content: string } => ({ ...doc, content: doc.content ?? '' });

export { isEmptyParseShell as isEmptyParseShellDocument };

export const EMPTY_PARSE_SHELL_LITEXML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <p id="42">\n  </p>\n</root>';

export const attachEmptyParseShellLiteXML = <T extends { content: string | null }>(
  doc: T,
): T & { content: string; editorData: Record<string, unknown>; litexml: string } => ({
  ...doc,
  content: doc.content ?? '',
  editorData: {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  },
  litexml: EMPTY_PARSE_SHELL_LITEXML,
});
