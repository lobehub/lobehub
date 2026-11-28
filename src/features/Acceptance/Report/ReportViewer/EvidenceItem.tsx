'use client';

import { Flexbox, Image, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AudioPlayer from '@/features/AudioPlayer';
import type { VerifyEvidenceWithUrl } from '@/services/verify';

import {
  comparisonMedia,
  EvidenceComparisonCard,
  isFilenameLike,
  meaningfulEvidenceCaption,
} from '../EvidenceComparisonCard';
import {
  CollapsibleMarkdownEvidence,
  DocumentViewer,
  markdownTextEvidenceTypes,
  rendersAsMarkdown,
} from '../MarkdownEvidence';
import { TerminalEvidenceCard } from '../TerminalEvidence';
import {
  evidenceComparison,
  evidenceDisplayName,
  imageEvidenceTypes,
  isInlineVisualEvidence,
  isTerminalEvidence,
} from './model';

const styles = stylex.create({
  evidenceText: {
    overflow: 'auto',
    maxHeight: '200px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  evidenceVideo: {
    alignSelf: 'flex-start',
    width: 'auto',
    maxWidth: '100%',
    maxHeight: '360px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    objectFit: 'contain',
  },
  evidenceDoc: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    width: '100%',
    minHeight: '0',
  },
  softTag: {
    paddingBlock: '1px',
    paddingInline: '7px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

/** One evidence artifact rendered by its type: zoomable image/gif, video, doc, text. */
export const EvidenceItem = memo<{
  evidence: VerifyEvidenceWithUrl;
  /** Inside a comparison card: the card frames the media, so no own border/radius/captions. */
  flat?: boolean;
  index: number;
}>(({ evidence: e, flat, index }) => {
  const { t } = useTranslation('verify');
  const label = evidenceDisplayName(e, t, index);
  const description = meaningfulEvidenceCaption(e.description, label);
  // Inline media (image/gif/video) speaks for itself — the raw filename header
  // is visual noise, so only keep a meaningful caption (description) for it.
  const isMedia = isInlineVisualEvidence(e);
  const isTerminal = isTerminalEvidence(e);
  const isDocument = Boolean(e.fileUrl) && !isMedia && e.type !== 'audio' && !isTerminal;
  const isInlineProse = Boolean(e.content) && markdownTextEvidenceTypes.has(e.type);
  const videoProps = stylex.props(styles.evidenceVideo, flat && comparisonMedia.video);
  const hideLabel =
    isTerminal ||
    isDocument ||
    isMedia ||
    (markdownTextEvidenceTypes.has(e.type) && isFilenameLike(label)) ||
    isInlineProse;

  return (
    <Flexbox gap={6} style={isDocument ? { flex: 1, minHeight: 0 } : undefined}>
      {!hideLabel && (
        <Text strong fontSize={13}>
          {label}
        </Text>
      )}
      {description && !flat && !isInlineProse && !isTerminal && (
        // Inline prose is excluded: its authored description becomes the fold
        // row's title below, so a standalone line here would say it twice.
        <Text fontSize={13} type={'secondary'}>
          {description}
        </Text>
      )}
      {isTerminal ? (
        // The card titles itself with the command and shows the description under it.
        <TerminalEvidenceCard defaultExpanded={flat} evidence={e} />
      ) : e.fileUrl && imageEvidenceTypes.has(e.type) ? (
        <Flexbox align={flat ? undefined : 'flex-start'} style={{ maxWidth: '100%' }}>
          <Image
            preview
            alt={e.description ?? label}
            src={e.fileUrl}
            style={{ maxWidth: '100%', ...(flat && { borderRadius: 0, width: '100%' }) }}
            {...(flat ? comparisonMedia.image : { variant: 'outlined' as const })}
          />
        </Flexbox>
      ) : e.fileUrl && e.type === 'video' ? (
        <video controls {...videoProps} src={e.fileUrl} />
      ) : e.fileUrl && e.type === 'audio' ? (
        // The same waveform player the conversation renders — one audio dialect
        // across the product, plus the download the reviewer needs to keep the
        // deliverable.
        <AudioPlayer
          fullWidth
          alt={e.description ?? label}
          downloadFileName={e.fileName ?? 'audio'}
          url={e.fileUrl}
        />
      ) : e.fileUrl ? (
        <div {...stylex.props(styles.evidenceDoc)}>
          <DocumentViewer fileName={e.fileName} markdown={rendersAsMarkdown(e)} url={e.fileUrl} />
        </div>
      ) : e.content && markdownTextEvidenceTypes.has(e.type) ? (
        // Same dialect as the acceptance viewer: an authored alt/description
        // becomes the fold row's title, not a supplement line below it. The
        // raw description, not the caption filter — with no fileName the label
        // IS the description, and the filter would null it out.
        <CollapsibleMarkdownEvidence
          fileName={e.fileName}
          markdown={rendersAsMarkdown(e)}
          title={e.description?.trim() || e.fileName?.trim() || undefined}
        >
          {e.content}
        </CollapsibleMarkdownEvidence>
      ) : e.content ? (
        <div {...stylex.props(styles.evidenceText)}>{e.content}</div>
      ) : (
        <span {...stylex.props(styles.softTag)}>{e.type}</span>
      )}
    </Flexbox>
  );
});

EvidenceItem.displayName = 'EvidenceItem';

export const EvidenceComparisonView = memo<{
  after: VerifyEvidenceWithUrl;
  before: VerifyEvidenceWithUrl;
}>(({ after, before }) => {
  // Either half may carry the layout; the `before` one wins so a pair can't
  // render as two different arrangements.
  const layout = evidenceComparison(before)?.layout ?? evidenceComparison(after)?.layout;

  // The band caption: an authored label wins; the evidence's own description is
  // the natural fallback so a pair never renders as two bare role words — but a
  // default filename description is noise, not a caption.
  const side = (evidence: VerifyEvidenceWithUrl, index: number) => ({
    caption:
      evidenceComparison(evidence)?.label ??
      (isFilenameLike(evidence.description) ? undefined : (evidence.description ?? undefined)),
    content: <EvidenceItem flat evidence={evidence} index={index} />,
    imageSrc:
      evidence.fileUrl && imageEvidenceTypes.has(evidence.type) ? evidence.fileUrl : undefined,
  });

  return <EvidenceComparisonCard after={side(after, 2)} before={side(before, 1)} layout={layout} />;
});

EvidenceComparisonView.displayName = 'EvidenceComparisonView';
