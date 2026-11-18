'use client';

import { readEvidenceChapters } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Image, useResponsive } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import AudioPlayer from '@/features/AudioPlayer';
import { sx } from '@/styles/sx';

import {
  comparisonMedia,
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
import { TerminalEvidenceCard } from '../../Report/TerminalEvidence';
import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotatedImage } from '../Evidence/Annotation';
import { ScreenshotTiles } from '../Evidence/ScreenshotTiles';
import { floatingActionHostMarker } from '../markers.stylex';
import { IMAGE_EVIDENCE, imageRatio, isAnnotatable, isVisual } from './evidence';
import { EvidenceGallery } from './EvidenceGallery';
import type { EvidenceStageSize } from './EvidenceImageStage';
import FloatingCommentAction from './FloatingCommentAction';
import type { EvidenceOverlayMap } from './overlay';
import { styles } from './styles';
import { TapToReviewImage } from './TapToReviewImage';
import { VideoEvidenceDiscussion } from './Video/VideoEvidenceDiscussion';

/** Flat media for a comparison side — the card frames it, so no own border/radius. */
const comparisonContent = (item: AcceptanceEvidence, action?: ReactNode, video?: ReactNode) => {
  if (item.type === 'terminal') return <TerminalEvidenceCard defaultExpanded evidence={item} />;
  if (item.type === 'video') return video;
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
      {...comparisonMedia.image}
    />
  );
  if (!action) return image;
  return (
    <div {...sx(floatingActionHostMarker, { position: 'relative' })}>
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
  onComment?: { label: string; open: (id: string, time?: number) => void };
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
  // 'fill' needs a host that lays this list out in a height-bounded flex column.
  stageSize?: EvidenceStageSize;
}>(
  ({
    evidence,
    overlays,
    onComment,
    onRefreshEvidenceUrl,
    onReviewEvidence,
    reviewNotes,
    stageSize,
  }) => {
    const { md = true } = useResponsive();
    const commentAction = (item: AcceptanceEvidence, inside?: boolean) =>
      onComment && isAnnotatable(item) ? (
        <FloatingCommentAction
          inside={inside}
          title={onComment.label}
          onClick={() => onComment.open(item.id)}
        />
      ) : undefined;
    const sorted = [...evidence].sort((a, b) => (isVisual(b) ? 1 : 0) - (isVisual(a) ? 1 : 0));
    if (sorted.length === 0) return null;

    // Before/after pairs render as one fused comparison card (same component as
    // the verify report). Only complete pairs fuse; a lone half stays a plain
    // artifact, matching the ingest CLI's warning semantics.
    const groups = new Map<string, Partial<Record<'after' | 'before', AcceptanceEvidence>>>();
    for (const item of sorted) {
      // Two runs of one command pair like two captures of one view.
      if (!isVisual(item) && item.type !== 'terminal') continue;
      const comparison = readEvidenceComparison(item.metadata);
      if (!comparison) continue;
      const group = groups.get(comparison.id) ?? {};
      group[comparison.role] = item;
      groups.set(comparison.id, group);
    }
    const pairedIds = new Set(
      [...groups.values()].flatMap((group) =>
        group.before && group.after ? [group.before.id, group.after.id] : [],
      ),
    );

    const videoContent = (item: AcceptanceEvidence, caption?: ReactNode) => (
      <VideoEvidenceDiscussion
        caption={caption}
        chapters={readEvidenceChapters(item.metadata)}
        evidenceId={item.id}
        notes={reviewNotes?.filter((note) => note.evidenceId === item.id)}
        overlays={overlays?.get(item.id)}
        src={item.fileUrl!}
        onComment={onComment ? (time) => onComment.open(item.id, time) : undefined}
        onRefreshSource={onRefreshEvidenceUrl ? () => onRefreshEvidenceUrl(item.id) : undefined}
      />
    );

    const comparisonSide = (item: AcceptanceEvidence) => ({
      caption:
        readEvidenceComparison(item.metadata)?.label ??
        meaningfulEvidenceCaption(item.description) ??
        undefined,
      content: comparisonContent(
        item,
        commentAction(item),
        item.type === 'video' ? videoContent(item) : undefined,
      ),
    });

    const consumedScreenshotIds = new Set<string>();
    const galleryItems = md
      ? sorted.filter(
          (item) => item.fileUrl && IMAGE_EVIDENCE.has(item.type) && !pairedIds.has(item.id),
        )
      : [];

    return (
      <Flexbox gap={12} {...stylex.props(stageSize === 'fill' && styles.listFill)}>
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

          if (galleryItems.includes(item)) {
            if (item !== galleryItems[0]) return null;
            return (
              <EvidenceGallery
                action={(shot) => commentAction(shot, true)}
                items={galleryItems}
                key={item.id}
                overlays={overlays}
                size={stageSize}
              />
            );
          }

          const description = meaningfulEvidenceCaption(item.description);
          const caption = description && (
            <span {...stylex.props(styles.caption)}>{description}</span>
          );
          if (item.fileUrl && item.type === 'video')
            return <div key={item.id}>{videoContent(item, caption)}</div>;
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
          const overlay = overlays?.get(item.id);
          // Posted screenshot threads must remain readable on touch screens too.
          const hasImageThreads =
            item.type === 'screenshot' && overlay?.some((note) => note.threadId);
          if (
            !md &&
            onReviewEvidence &&
            item.fileUrl &&
            IMAGE_EVIDENCE.has(item.type) &&
            !hasImageThreads
          ) {
            return (
              <TapToReviewImage
                action={commentAction(item)}
                alt={item.description ?? item.fileName ?? item.type}
                caption={caption}
                key={item.id}
                src={item.fileUrl}
                onReview={() => onReviewEvidence(item.id)}
              />
            );
          }
          if (item.fileUrl && item.type === 'screenshot') {
            const run = [item];
            const start = sorted.indexOf(item);
            for (let index = start + 1; index < sorted.length; index++) {
              const next = sorted[index]!;
              if (pairedIds.has(next.id) || !next.fileUrl || next.type !== 'screenshot') break;
              if (!md && onReviewEvidence && !overlays?.get(next.id)?.some((note) => note.threadId))
                break;
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
                          <span {...stylex.props(styles.caption)}>{shotCaption}</span>
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
                {...sx(action && floatingActionHostMarker, {
                  maxWidth: '100%',
                  position: 'relative',
                  width: 'fit-content',
                })}
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
                    {...sx(
                      styles.evidenceImage,
                      item.fileWidth && item.fileHeight
                        ? { aspectRatio: imageRatio(item), maxWidth: '100%', width: item.fileWidth }
                        : undefined,
                    )}
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
          // A command execution: the record first, then its output — whether the
          // row carries its transcript inline or as a file.
          if (item.type === 'terminal')
            return <TerminalEvidenceCard evidence={item} key={item.id} />;
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
                <div {...stylex.props(styles.evidenceText)}>{item.content}</div>
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
  },
);
