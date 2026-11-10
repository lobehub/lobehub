'use client';

import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { Button, createStaticStyles, cssVar, Skeleton } from '@lobehub/ui';
import { Maximize2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HtmlDocumentFrame } from '@/components/HtmlPreview';
import { useDocumentStore } from '@/store/document';

import GoalReportFullscreen from './GoalReportFullscreen';

/** How much of the report the result page shows before the reader expands it. */
const PREVIEW_MAX_HEIGHT = 480;

const styles = createStaticStyles(({ css }) => ({
  // `isolation` keeps the shadow and hit layers' z-index inside the card, so
  // the result page's sticky follow-up dock still covers them on scroll.
  card: css`
    isolation: isolate;
    position: relative;

    overflow: hidden;

    max-height: ${PREVIEW_MAX_HEIGHT}px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  // A shadow rising from the clipped edge says there is more below; the
  // expand button sits on it.
  expand: css`
    pointer-events: none;

    position: absolute;
    z-index: 2;
    inset-block-end: 0;
    inset-inline: 0;

    display: flex;
    align-items: flex-end;
    justify-content: center;

    height: 140px;
    padding-block-end: 20px;

    background: linear-gradient(to bottom, transparent, ${cssVar.colorBgMask});

    > * {
      pointer-events: auto;
    }
  `,
  // The sandboxed frame swallows clicks; this layer turns the clipped preview
  // into one target that opens the full report.
  hit: css`
    cursor: zoom-in;
    position: absolute;
    z-index: 1;
    inset: 0;
  `,
}));

/**
 * The HTML page the wrap-up agent wrote, as the first screen of the result:
 * clipped to a fixed height under a rising shadow, and opened full screen on
 * click, where it runs interactively. Renders nothing when the page is gone or no longer HTML —
 * the deliverable document below then leads the page as before.
 */
const GoalReportPage = memo<{ documentId: string }>(({ documentId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const { data: page, isLoading } = useFetchDocumentDetail(documentId);

  if (isLoading) return <Skeleton height={PREVIEW_MAX_HEIGHT} radius={8} />;
  if (page?.fileType !== HTML_DOCUMENT_FILE_TYPE || !page.content) return null;

  const title = page.title || t('goalProcess.result.story.reportTitle');
  const expand = () => setOpen(true);

  return (
    <>
      <div className={styles.card}>
        <HtmlDocumentFrame content={page.content} title={title} />
        <div
          aria-label={t('goalProcess.result.report.expand')}
          className={styles.hit}
          role={'button'}
          tabIndex={0}
          onClick={expand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') expand();
          }}
        />
        <div className={styles.expand}>
          <Button icon={<Maximize2 size={14} />} shape={'round'} onClick={expand}>
            {t('goalProcess.result.report.expand')}
          </Button>
        </div>
      </div>
      <GoalReportFullscreen
        content={page.content}
        documentId={documentId}
        open={open}
        title={title}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

GoalReportPage.displayName = 'GoalReportPage';

export default GoalReportPage;
