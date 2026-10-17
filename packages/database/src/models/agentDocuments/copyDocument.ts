import { parseLoadRules } from './policy';
import type { AgentDocument, PolicyLoad } from './types';
import { DocumentLoadPosition } from './types';

/**
 * Cohesive "copy an agent document" parameter assembly, extracted from
 * `agentDocument.ts` to keep that file from growing past the repository's
 * 800-line source-layout limit (Codex P2 on #20914).
 */

/** `'text/plain'` = RAW_TEXT_DOCUMENT_FILE_TYPE (apps/server contentFormat); kept literal because the database package cannot import from apps. */
const RAW_TEXT_DOCUMENT_FILE_TYPE = 'text/plain';

/**
 * An "empty-parse shell" (invalid or childless root editorData with empty
 * content, e.g. a crawl capture whose HTML body parsed to nothing) reads as
 * Lexical error #38 and blocks cleanup. Copying such a source as editor data
 * would duplicate the shell, so the clone is stored as raw text instead — the
 * description/metadata survive and the clone is deletable/editable.
 */
export const isEmptyParseShell = (doc: AgentDocument): boolean => {
  const hasRootChildren =
    Array.isArray(doc.editorData?.root?.children) &&
    (doc.editorData!.root.children.length ?? 0) > 0;
  return Boolean(doc.editorData) && !hasRootChildren && !doc.content;
};

const sharedCopyParams = (existing: AgentDocument, title?: string) => ({
  loadPosition:
    (existing.policy?.context?.position as DocumentLoadPosition | undefined) ||
    DocumentLoadPosition.BEFORE_FIRST_USER,
  loadRules: parseLoadRules(existing),
  metadata: existing.metadata || undefined,
  policy: existing.policy || undefined,
  policyLoad: existing.policyLoad as PolicyLoad | undefined,
  templateId: existing.templateId || undefined,
  title,
});

/**
 * Build the `create` params for cloning `existing`. Empty-parse shells are
 * downgraded to raw text (no editor data); everything else clones editorData.
 */
export const buildCopyParams = (existing: AgentDocument, title?: string) =>
  isEmptyParseShell(existing)
    ? {
        ...sharedCopyParams(existing, title),
        // Raw text keeps the clone readable and deletable instead of another
        // error-#38 shell.
        fileType: RAW_TEXT_DOCUMENT_FILE_TYPE,
      }
    : {
        ...sharedCopyParams(existing, title),
        editorData: existing.editorData || undefined,
      };
