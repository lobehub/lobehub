'use client';

import { Center, Flexbox, Highlighter, Icon, Markdown } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight, FileText } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/BrandTextLoading';
import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { AcceptanceDrawer } from '../AcceptanceDrawer';

/**
 * Prose evidence (root-cause write-ups, findings) renders as body markdown, not
 * a monospace raw box — shared by the verify report and the acceptance union so
 * the two surfaces can't drift apart.
 */
export const markdownTextEvidenceTypes = new Set(['markdown', 'text']);

/**
 * Which of those two render as prose, and which stay verbatim.
 *
 * Only a document that says it is markdown gets markdown rendering. A `text`
 * artifact is usually captured command output, where `###`, `-` and `*` are
 * literal characters the reviewer is meant to read: rendering it as markdown
 * turned transcript sections into headings, argument lists into bullets, and
 * reflowed the lines so column alignment — often the point of the capture —
 * was lost. Everything that is not explicitly markdown is shown verbatim.
 */
export const rendersAsMarkdown = (evidence: { fileName?: string | null; type: string }): boolean =>
  evidence.type === 'markdown' || /\.(?:md|markdown)$/i.test(evidence.fileName ?? '');

export const filenameFromUrl = (url: string): string => {
  try {
    return new URL(url).pathname.split('/').pop() || 'document';
  } catch {
    return 'document';
  }
};

const styles = createStaticStyles(({ css }) => ({
  foldBody: css`
    padding-block: 4px 8px;
    padding-inline: 22px 0;

    @media (width <= 767px) {
      padding-inline: 0;
    }
  `,
  /* Reviewer-directed: no fill, no border — the row is just a line of text
     with a chevron; the surrounding check card provides the container. */
  foldCard: css`
    overflow: hidden;
    border-radius: ${cssVar.borderRadius};
  `,
  foldChevron: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: transform 160ms ease;
  `,
  foldChevronOpen: css`
    transform: rotate(90deg);
  `,
  foldHeader: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    padding-block: 4px;
    padding-inline: 0;
    border: none;

    text-align: start;

    background: transparent;

    /* No fill and no border by design — the hover feedback lives on the text. */
    &:hover [data-fold-title] {
      color: ${cssVar.colorText};
    }

    @media (width <= 767px), (pointer: coarse) {
      min-height: 44px;
    }
  `,
  foldTitle: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.35;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    transition: color 120ms ease;

    @media (width <= 767px) {
      overflow-wrap: anywhere;
      white-space: normal;
    }
  `,
  /* A plain block, deliberately not a Flexbox: `Markdown`'s root is
     `overflow: hidden`, so as a flex item its automatic minimum size collapses
     to 0 and a long document gets squeezed to the viewer's height and clipped
     instead of overflowing it — leaving this box scrollable in name only. */
  docViewer: css`
    overflow: auto;
    flex: 1;

    height: 100%;
    min-height: 0;
    padding-block: 12px;
    padding-inline: 16px;

    > * {
      flex-shrink: 0;
    }
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

/** Content small enough that folding it would cost more than it saves. */
const INLINE_RENDER_MAX_CHARS = 160;

/**
 * The collapsed row's label: the first meaningful line of the document, with
 * markdown syntax stripped so it reads as a sentence, not source. Fence markers
 * and blank lines are skipped — a document that opens with a code block should
 * be labeled by its first code line, not by "```bash".
 */
export const evidenceTitleFromMarkdown = (
  content: string,
  description?: string | null,
  fileName?: string | null,
): string => {
  const label = description?.trim() || fileName?.trim();
  if (label) return label;
  // Raw JSON has no prose heading; its first line is not a useful document title.
  if (/^[{[]/.test(content.trim())) {
    try {
      JSON.parse(content);
      return 'JSON';
    } catch {
      // Markdown links and non-JSON text still use their first meaningful line.
    }
  }
  for (const raw of content.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('```') || /^-{3,}$/.test(line)) continue;
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^>\s*/, '')
      .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
      .replaceAll(/\*([^*]+)\*/g, '$1')
      .replaceAll(/`([^`]+)`/g, '$1')
      .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    if (line) return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  }
  return '';
};

/**
 * The fold decision, shared by the component and its tests: an authored title
 * (the evidence's alt/description) both wins the label and forces the fold —
 * the caller is saying this row has a real label worth reading at list level.
 * Without one, a couple of plain lines carry no structure worth hiding and
 * folding them would trade one click for nothing.
 */
export const resolveMarkdownEvidenceFold = (content: string, authoredTitle?: string) => {
  const derivedTitle = evidenceTitleFromMarkdown(content);
  const foldTitle = authoredTitle?.trim() || derivedTitle;
  const trimmed = content.trim();
  const inlineEligible = !trimmed.includes('\n') && trimmed.length <= INLINE_RENDER_MAX_CHARS;
  const fold =
    Boolean(foldTitle) &&
    (Boolean(authoredTitle?.trim()) || derivedTitle === 'JSON' || !inlineEligible);
  return { fold, foldTitle };
};

/**
 * Inline prose evidence, folded to ONE titled row by default — the first line
 * of the document is the label, the click is the disclosure. Expanding renders
 * the full text in place, typographically subordinated (small header scale) so
 * the evidence's own headings never compete with the page's hierarchy.
 *
 * `title` lets a caller hand the row a better label — the evidence's authored
 * alt/description. It outranks the document's first line and its presence
 * forces the fold: the label IS the point, and the caller stops rendering the
 * description as a supplement below the row (it now reads as the row itself).
 *
 * Replaces the earlier first-180px preview fold: agent-authored evidence opens
 * with headings and environment metadata, so a height-cropped preview spent a
 * card of space showing the least informative part of the document — and read
 * as noise. Need it → expand; don't → one quiet line.
 */
export const CollapsibleMarkdownEvidence = memo<{
  children: string;
  fileName?: string | null;
  /** False renders the document verbatim — see `rendersAsMarkdown`. */
  markdown?: boolean;
  title?: string;
}>(({ children, fileName, markdown = true, title }) => {
  const { t } = useTranslation('verify');
  const [expanded, setExpanded] = useState(false);
  const { fold, foldTitle } = useMemo(
    () => resolveMarkdownEvidenceFold(children, title),
    [children, title],
  );
  const body = markdown ? (
    <Markdown fontSize={13} headerMultiple={0.1} variant={'chat'}>
      {children}
    </Markdown>
  ) : (
    <Highlighter
      wrap
      language={getLanguageFromFilename(fileName)}
      showLanguage={false}
      variant={'borderless'}
    >
      {children}
    </Highlighter>
  );

  if (!fold) {
    return markdown ? (
      <Markdown fontSize={13} variant={'chat'}>
        {children}
      </Markdown>
    ) : (
      body
    );
  }

  return (
    <Flexbox className={styles.foldCard}>
      <button
        aria-expanded={expanded}
        className={styles.foldHeader}
        title={t(expanded ? 'report.evidence.collapse' : 'report.evidence.expand')}
        type={'button'}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          className={cx(styles.foldChevron, expanded && styles.foldChevronOpen)}
          icon={ChevronRight}
          size={14}
        />
        <span className={styles.fileCardIcon}>
          <Icon icon={FileText} size={13} />
        </span>
        <span data-fold-title className={styles.foldTitle}>
          {foldTitle}
        </span>
      </button>
      {expanded && <div className={styles.foldBody}>{body}</div>}
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
      <div className={styles.docViewer}>
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
      </div>
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
        <AcceptanceDrawer
          containerMaxWidth={'100%'}
          open={open}
          placement={'right'}
          title={name}
          width={'min(1120px, calc(100vw - 48px))'}
          styles={{
            bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden', padding: 0 },
          }}
          onClose={() => setOpen(false)}
        >
          <DocumentViewer fileName={name} markdown={markdown} url={url} />
        </AcceptanceDrawer>
      )}
    </>
  );
});

EvidenceFileCard.displayName = 'EvidenceFileCard';
