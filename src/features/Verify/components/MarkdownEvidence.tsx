'use client';

import {
  Center,
  Drawer,
  Flexbox,
  Highlighter,
  Icon,
  Markdown,
  MaskShadow,
  Text,
} from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useSize } from 'ahooks';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronsDownUpIcon, ChevronsUpDownIcon, FileText } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

/**
 * Prose evidence (root-cause write-ups, findings) renders as body markdown, not
 * a monospace raw box — shared by the verify report and the acceptance union so
 * the two surfaces can't drift apart.
 */
export const markdownTextEvidenceTypes = new Set(['markdown', 'text']);

export const filenameFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.split('/').pop() || 'document';
  } catch {
    return 'document';
  }
};

/** Same fold threshold as the task brief summary — the style this mirrors. */
const COLLAPSED_MAX_HEIGHT = 180;

const styles = createStaticStyles(({ css }) => ({
  expandLink: css`
    align-self: center;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  docViewer: css`
    overflow: auto;
    height: 100%;
    padding-block: 12px;
    padding-inline: 16px;
  `,
  fileCard: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    align-items: center;

    width: min(100%, 520px);
    padding-block: 7px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorLink};
      color: ${cssVar.colorLink};
    }
  `,
  fileCardBody: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
  `,
  fileCardDesc: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: 12px;
    line-height: 1.35;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  fileCardIcon: css`
    display: flex;
    color: ${cssVar.colorTextTertiary};
  `,
  fileCardName: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.35;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * Inline prose evidence in the task-brief style: bare body markdown (no tinted
 * box), folded behind a mask + expand button once it outgrows the threshold.
 */
export const CollapsibleMarkdownEvidence = memo<{ children: string }>(({ children }) => {
  const { t } = useTranslation('verify');
  const [expanded, setExpanded] = useState(false);
  const [isOverflow, setIsOverflow] = useState(false);
  const ref = useRef<any>(null);
  const size = useSize(ref);

  useEffect(() => {
    if (!size) return;
    setIsOverflow(size.height > COLLAPSED_MAX_HEIGHT);
  }, [size]);

  const content = (
    <Markdown fontSize={13} ref={ref} style={{ overflow: 'unset' }} variant={'chat'}>
      {children}
    </Markdown>
  );

  return (
    <Flexbox gap={4}>
      {isOverflow && !expanded ? (
        <MaskShadow size={32} style={{ maxHeight: COLLAPSED_MAX_HEIGHT }}>
          {content}
        </MaskShadow>
      ) : (
        content
      )}

      {isOverflow && (
        <Button
          className={styles.expandLink}
          icon={expanded ? ChevronsDownUpIcon : ChevronsUpDownIcon}
          iconPosition={'end'}
          size={'small'}
          type={'fill'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('report.evidence.collapse') : t('report.evidence.expand')}
        </Button>
      )}
    </Flexbox>
  );
});

CollapsibleMarkdownEvidence.displayName = 'CollapsibleMarkdownEvidence';

/** A file-backed text evidence, decoded then body-rendered (markdown) or syntax highlighted. */
export const DocumentViewer = memo<{ fileName?: string | null; markdown?: boolean; url: string }>(
  ({ fileName, markdown, url }) => {
    const { t } = useTranslation('verify');
    const { fileData, loading, error } = useTextFileLoader(url);

    if (loading)
      return (
        <Center flex={1} height={'100%'}>
          <Loading debugId="verify-document-viewer" />
        </Center>
      );

    if (error || fileData === null)
      return (
        <Center flex={1} gap={8} height={'100%'}>
          <Text type="secondary">{t('report.document.failed')}</Text>
          <a href={url} rel="noreferrer" target="_blank">
            {t('report.document.openOriginal')}
          </a>
        </Center>
      );

    return (
      <Flexbox className={styles.docViewer}>
        {markdown ? (
          <Markdown fontSize={13} variant={'chat'}>
            {fileData}
          </Markdown>
        ) : (
          <Highlighter
            wrap
            language={getLanguageFromFilename(fileName || filenameFromUrl(url))}
            showLanguage={false}
            variant={'borderless'}
          >
            {fileData}
          </Highlighter>
        )}
      </Flexbox>
    );
  },
);

DocumentViewer.displayName = 'DocumentViewer';

/**
 * A long file-backed prose evidence stays behind a click — rendering thousands
 * of lines inline drowns the check list. The card opens a drawer that renders
 * the document as body markdown.
 */
export const EvidenceFileCard = memo<{
  description?: string | null;
  fileName?: string | null;
  markdown?: boolean;
  url: string;
}>(({ description, fileName, markdown, url }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);
  const name = fileName || filenameFromUrl(url);
  const desc = description && description !== name ? description : null;

  return (
    <>
      <button
        className={styles.fileCard}
        title={t('report.evidence.openDetail', { name })}
        type={'button'}
        onClick={() => setOpen(true)}
      >
        <span className={styles.fileCardIcon}>
          <Icon icon={FileText} size={13} />
        </span>
        <span className={styles.fileCardBody}>
          <span className={styles.fileCardName}>{name}</span>
          {desc && <span className={styles.fileCardDesc}>{desc}</span>}
        </span>
      </button>
      {open && (
        <Drawer
          destroyOnHidden
          containerMaxWidth={'100%'}
          open={open}
          placement={'right'}
          title={name}
          width={'min(1120px, calc(100vw - 48px))'}
          styles={{
            body: { height: '100%', padding: 0 },
            bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden' },
          }}
          onClose={() => setOpen(false)}
        >
          <DocumentViewer fileName={name} markdown={markdown} url={url} />
        </Drawer>
      )}
    </>
  );
});

EvidenceFileCard.displayName = 'EvidenceFileCard';
