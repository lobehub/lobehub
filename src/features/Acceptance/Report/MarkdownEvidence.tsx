'use client';

import { Center, Flexbox, Highlighter, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  foldBody: {
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInlineStart: { 'default': '22px', '@media (width <= 767px)': 0 },
    paddingInlineEnd: 0,
  },
  /* Reviewer-directed: no fill, no border — the row is just a line of text
     with a chevron; the surrounding check card provides the container. */
  foldCard: { overflow: 'hidden', borderRadius: cssVar.borderRadius },
  foldChevron: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    transition: 'transform 160ms ease',
  },
  foldChevronOpen: { transform: 'rotate(90deg)' },
  foldHeader: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
    minHeight: {
      'default': null,
      '@media (width <= 767px), (pointer: coarse)': '44px',
    },
    paddingBlock: '4px',
    paddingInline: 0,
    borderStyle: 'none',
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  foldTitle: {
    overflow: 'hidden',
    fontSize: '13px',
    lineHeight: 1.35,
    /* No fill and no border by design — the hover feedback lives on the text. */
    color: {
      default: cssVar.colorTextSecondary,
      [stylex.when.ancestor(':hover')]: cssVar.colorText,
    },
    textOverflow: 'ellipsis',
    whiteSpace: { 'default': 'nowrap', '@media (width <= 767px)': 'normal' },
    overflowWrap: { 'default': null, '@media (width <= 767px)': 'anywhere' },
    transition: 'color 120ms ease',
  },
  /* A plain block, deliberately not a Flexbox: `Markdown`'s root is
     `overflow: hidden`, so as a flex item its automatic minimum size collapses
     to 0 and a long document gets squeezed to the viewer's height and clipped
     instead of overflowing it — leaving this box scrollable in name only. */
  docViewer: {
    overflow: 'auto',
    flex: '1',
    height: '100%',
    minHeight: '0',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  fileCard: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr)',
    gap: '8px',
    alignItems: 'center',
    width: 'min(100%, 520px)',
    paddingBlock: '7px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorLink },
    borderRadius: cssVar.borderRadius,
    color: { 'default': null, ':hover': cssVar.colorLink },
    textAlign: 'start',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  fileCardBody: { display: 'flex', flexDirection: 'column', minWidth: '0' },
  fileCardDesc: {
    overflow: 'hidden',
    marginBlockStart: '2px',
    fontSize: '12px',
    lineHeight: 1.35,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileCardIcon: { display: 'flex', color: cssVar.colorTextTertiary },
  fileCardName: {
    overflow: 'hidden',
    fontSize: '13px',
    lineHeight: 1.35,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
    <Flexbox className={stylex.props(styles.foldCard).className}>
      <button
        aria-expanded={expanded}
        {...stylex.props(styles.foldHeader, stylex.defaultMarker())}
        title={t(expanded ? 'report.evidence.collapse' : 'report.evidence.expand')}
        type={'button'}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          className={stylex.props(styles.foldChevron, expanded && styles.foldChevronOpen).className}
          icon={ChevronRight}
          size={14}
        />
        <span {...stylex.props(styles.fileCardIcon)}>
          <Icon icon={FileText} size={13} />
        </span>
        <span {...stylex.props(styles.foldTitle)}>{foldTitle}</span>
      </button>
      {expanded && <div {...stylex.props(styles.foldBody)}>{body}</div>}
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
      <div {...stylex.props(styles.docViewer)}>
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
        {...stylex.props(styles.fileCard)}
        title={t('report.evidence.openDetail', { name })}
        type={'button'}
        onClick={() => setOpen(true)}
      >
        <span {...stylex.props(styles.fileCardIcon)}>
          <Icon icon={FileText} size={13} />
        </span>
        <span {...stylex.props(styles.fileCardBody)}>
          <span {...stylex.props(styles.fileCardName)}>{name}</span>
          {desc && <span {...stylex.props(styles.fileCardDesc)}>{desc}</span>}
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
