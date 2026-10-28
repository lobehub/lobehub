'use client';

import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { HtmlDocumentFrame } from '@/components/HtmlPreview';
import { useDocumentStore } from '@/store/document';

import { usePageEditorStore } from './store';

const styles = stylex.create({
  // The artifact keeps its own background; the frame edge marks where it ends
  // against either theme.
  frame: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
});

/** Whether the loaded page is an HTML page rather than a rich-text one. */
export const useIsHtmlPage = (documentId: string | undefined) =>
  useDocumentStore(
    (s) =>
      !!documentId &&
      s.documentDetailMap[documentId]?.document?.fileType === HTML_DOCUMENT_FILE_TYPE,
  );

/**
 * Body of an HTML page: the stored HTML in a sandboxed frame instead of the
 * rich-text editor. It still syncs the document into the document store, so
 * title / emoji saves and remote updates keep working; the store never saves
 * an HTML page's body.
 */
const HtmlPageBody = () => {
  const documentId = usePageEditorStore((s) => s.documentId);
  const editor = usePageEditorStore((s) => s.editor);
  const useFetchDocument = useDocumentStore((s) => s.useFetchDocument);
  const { data } = useFetchDocument(documentId, { editor, sourceType: 'page' });

  if (!data) return null;

  return (
    <div {...stylex.props(styles.frame)}>
      <HtmlDocumentFrame content={data.content ?? ''} title={data.title ?? undefined} />
    </div>
  );
};

export default HtmlPageBody;
