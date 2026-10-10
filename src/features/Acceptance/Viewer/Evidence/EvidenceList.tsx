'use client';

import { readEvidenceChapters } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Image, useResponsive } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import AudioPlayer from '@/features/AudioPlayer';

import {
  EvidenceComparisonCard,
  meaningfulEvidenceCaption,
  readEvidenceComparison,
} from '../../Report/EvidenceComparisonCard';
import {
  CollapsibleMarkdownEvidence,
  EvidenceFileCard,
  markdownTextEvidenceTypes,
  rendersAsMarkdown,
} from '../../Report/MarkdownEvidence';
import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotatedImage } from '../Evidence/Annotation';
import { ScreenshotTiles } from '../Evidence/ScreenshotTiles';
import { IMAGE_EVIDENCE, imageRatio, isAnnotatable, isVisual } from './evidence';
import FloatingCommentAction, { FLOATING_ACTION_HOST } from './FloatingCommentAction';
import type { EvidenceOverlayMap } from './overlay';
import { styles } from './styles';
import { VideoEvidencePlayer } from './Video/VideoEvidencePlayer';

/** Flat media for a comparison side — the card frames it, so no own border/radius. */
const comparisonContent = (item: AcceptanceEvidence, action?: ReactNode) => {
  if (item.type === 'video')
    return <video controls src={item.fileUrl!} style={{ display: 'block', width: '100%' }} />;
  if (item.type === 'audio')
    return (
      <AudioPlayer
        fullWidth
        alt={item.description ?? item.fileName ?? item.type}
        downloadFileName={item.fileName ?? 'audio'}
        url={item.fileUrl!}
      />
    );
  if (item.type === 'screenshot' && item.fileUrl)
    return (
      <ScreenshotTiles
        flat
        action={action}
        alt={item.description ?? item.fileName ?? item.type}
        fileHeight={item.fileHeight}
        fileWidth={item.fileWidth}
        src={item.fileUrl}
      />
    );
  const image = (
    <Image
      preview
      alt={item.description ?? item.fileName ?? item.type}
      loading={'lazy'}
      src={item.fileUrl!}
      style={{ aspectRatio: imageRatio(item), borderRadius: 0, width: '100%' }}
      variant={'borderless'}
    />
  );
  if (!action) return image;
  return (
    <div style={{ position: 'relative' }} {...{ [FLOATING_ACTION_HOST]: '' }}>
      {image}
      {action}
    </div>
  );
};

export const EvidenceList = memo<{
  evidence: AcceptanceEvidence[];
  /**
   * Comment on (or mark) one picture straight from it — floats over each
   * annotatable image, labelled for what it opens.
   */
  onComment?: { label: string; open: (id: string) => void };
  onReviewEvidence?: (id: string) => void;
  /**
   * Regions to draw over an evidence image, keyed by evidence id. Used by the
   * AI proposal and by reviewers' circled comments: rather than the card
   * rendering its own copy of the screenshot (which showed the same image twice
   * in one row), the boxes land on the image that is already here.
   */
  overlays?: EvidenceOverlayMap;
  /** A freshly signed URL for one evidence — lets a video recover an expired link. */
  onRefreshEvidenceUrl?: (evidenceId: string) => Promise<string | undefined>;
  /** The standing reject's notes — video ones are pinned to the player's timeline. */
  reviewNotes?: AcceptanceReviewAnnotation[];
}>(({ evidence, overlays, onComment, onRefreshEvidenceUrl, onReviewEvidence, reviewNotes }) => {
  const { md = true } = useResponsive();
  const commentAction = (item: AcceptanceEvidence) =>
    onComment && isAnnotatable(item) ? (
      <FloatingCommentAction title={onComment.label} onClick={() => onComment.open(item.id)} />
    ) : undefined;
  const sorted = [...evidence].sort((a, b) => (isVisual(b) ? 1 : 0) - (isVisual(a) ? 1 : 0));
  if (sorted.length === 0) return null;

  // Before/after pairs render as one fused comparison card (same component as
  // the verify report). Only complete pairs fuse; a lone half stays a plain
  // artifact, matching the ingest CLI's warning semantics.
  const groups = new Map<string, Partial<Record<'after' | 'before', AcceptanceEvidence>>>();
  for (const item of sorted) {
    if (!isVisual(item)) continue;
    const comparison = readEvidenceComparison(item.metadata);
    if (!comparison) continue;
    const group = groups.get(comparison.id) ?? {};
    group[comparison.role] = item;
    groups.set(comparison.id, group);
  }
  const pairedIds = new Set(
    [...groups.values()]
      .filter((group) => group.before && group.after)
      .flatMap((group) => [group.before!.id, group.after!.id]),
  );

  const comparisonSide = (item: AcceptanceEvidence) => ({
    caption:
      readEvidenceComparison(item.metadata)?.label ??
      meaningfulEvidenceCaption(item.description) ??
      undefined,
    content: comparisonContent(item, commentAction(item)),
  });

  const consumedScreenshotIds = new Set<string>();

  return (
    <Flexbox gap={12}>
      {sorted.map((item) => {
        if (consumedScreenshotIds.has(item.id)) return null;
        if (pairedIds.has(item.id) && (md || !onReviewEvidence)) {
          const comparison = readEvidenceComparison(item.metadata)!;
          // The pair renders once, anchored at its `before` half.
          if (comparison.role !== 'before') return null;
          const group = groups.get(comparison.id)!;
          return (
            <EvidenceComparisonCard
              after={comparisonSide(group.after!)}
              before={comparisonSide(group.before!)}
              key={comparison.id}
              layout={comparison.layout}
            />
          );
        }

        const description = meaningfulEvidenceCaption(item.description);
        const caption = description && <span className={styles.caption}>{description}</span>;
        if (item.fileUrl && item.type === 'video')
          return (
            <VideoEvidencePlayer
              caption={caption}
              chapters={readEvidenceChapters(item.metadata)}
              key={item.id}
              notes={reviewNotes?.filter((note) => note.evidenceId === item.id)}
              src={item.fileUrl}
              onRefreshSource={
                onRefreshEvidenceUrl ? () => onRefreshEvidenceUrl(item.id) : undefined
              }
            />
          );
        if (item.fileUrl && item.type === 'audio')
          return (
            <Flexbox gap={4} key={item.id} width={'100%'}>
              {/* The conversation's own waveform player — one audio dialect across
                  the product, with the download the reviewer needs to keep the clip. */}
              <AudioPlayer
                fullWidth
                alt={item.description ?? item.fileName ?? item.type}
                downloadFileName={item.fileName ?? 'audio'}
                url={item.fileUrl}
              />
              {caption}
            </Flexbox>
          );
        if (!md && onReviewEvidence && item.fileUrl && IMAGE_EVIDENCE.has(item.type)) {
          const action = commentAction(item);
          // The tap reviews; the comment shortcut sits beside the button rather
          // than inside it, since a button cannot hold another one.
          return (
            <div
              key={item.id}
              style={{ position: 'relative', width: '100%' }}
              {...(action ? { [FLOATING_ACTION_HOST]: '' } : {})}
            >
              <button
                type={'button'}
                style={{
                  padding: 0,
                  width: '100%',
                  border: 0,
                  background: 'none',
                  textAlign: 'start',
                  cursor: 'pointer',
                }}
                onClick={() => onReviewEvidence(item.id)}
              >
                <img
                  alt={item.description ?? item.fileName ?? item.type}
                  loading={'lazy'}
                  src={item.fileUrl}
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    width: '100%',
                    height: 180,
                    objectFit: 'cover',
                    objectPosition: 'top',
                    borderRadius: 8,
                  }}
                />
                {caption}
              </button>
              {action}
            </div>
          );
        }
        const overlay = overlays?.get(item.id);
        if (item.fileUrl && item.type === 'screenshot') {
          const run = [item];
          const start = sorted.indexOf(item);
          for (let index = start + 1; index < sorted.length; index++) {
            const next = sorted[index]!;
            if (pairedIds.has(next.id) || !next.fileUrl || next.type !== 'screenshot') break;
            run.push(next);
            consumedScreenshotIds.add(next.id);
          }
          return (
            <Flexbox
              horizontal
              align={'flex-start'}
              gap={12}
              key={item.id}
              style={{ maxWidth: '100%' }}
              wrap={'wrap'}
            >
              {run.map((shot) => {
                const shotCaption = meaningfulEvidenceCaption(shot.description);
                return (
                  <ScreenshotTiles
                    action={commentAction(shot)}
                    alt={shot.description ?? shot.fileName ?? shot.type}
                    annotations={overlays?.get(shot.id)}
                    fileHeight={shot.fileHeight}
                    fileWidth={shot.fileWidth}
                    key={shot.id}
                    src={shot.fileUrl!}
                    caption={
                      shotCaption ? (
                        <span className={styles.caption}>{shotCaption}</span>
                      ) : undefined
                    }
                  />
                );
              })}
            </Flexbox>
          );
        }
        if (item.fileUrl && IMAGE_EVIDENCE.has(item.type)) {
          const action = commentAction(item);
          return (
            <Flexbox
              gap={4}
              key={item.id}
              style={{ maxWidth: '100%', position: 'relative', width: 'fit-content' }}
              {...(action ? { [FLOATING_ACTION_HOST]: '' } : {})}
            >
              {action}
              {overlay?.length ? (
                <AnnotatedImage
                  annotations={overlay}
                  showComments={false}
                  src={item.fileUrl}
                  imageStyle={
                    item.fileWidth && item.fileHeight
                      ? { aspectRatio: imageRatio(item), maxWidth: '100%', width: item.fileWidth }
                      : undefined
                  }
                />
              ) : (
                <Flexbox
                  className={styles.evidenceImage}
                  style={
                    item.fileWidth && item.fileHeight
                      ? { aspectRatio: imageRatio(item), maxWidth: '100%', width: item.fileWidth }
                      : undefined
                  }
                >
                  <Image
                    alt={item.description ?? item.fileName ?? item.type}
                    loading={'lazy'}
                    src={item.fileUrl}
                    variant={'borderless'}
                    style={{
                      borderRadius: 0,
                      maxWidth: '100%',
                      width: item.fileWidth && item.fileHeight ? '100%' : undefined,
                    }}
                  />
                </Flexbox>
              )}
              {caption}
            </Flexbox>
          );
        }
        if (item.content && markdownTextEvidenceTypes.has(item.type))
          return (
            // An authored alt/description becomes the fold row's title itself —
            // the supplement below the row duplicated it one line later.
            <CollapsibleMarkdownEvidence
              fileName={item.fileName}
              key={item.id}
              markdown={rendersAsMarkdown(item)}
              title={item.description?.trim() || item.fileName?.trim() || undefined}
            >
              {item.content}
            </CollapsibleMarkdownEvidence>
          );
        if (item.content)
          return (
            <Flexbox gap={4} key={item.id}>
              <div className={styles.evidenceText}>{item.content}</div>
              {caption}
            </Flexbox>
          );
        if (item.fileUrl && markdownTextEvidenceTypes.has(item.type))
          return (
            <EvidenceFileCard
              description={item.description}
              fileName={item.fileName}
              key={item.id}
              markdown={rendersAsMarkdown(item)}
              url={item.fileUrl}
            />
          );
        return null;
      })}
    </Flexbox>
  );
});
