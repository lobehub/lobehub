'use client';

import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAcceptanceScope } from '../../AcceptanceScope';
import { commentAnchorId } from '../../Comments/anchor';
import { type EvidenceOverlay, overlayColor } from '../overlay';
import { useVideoThreads, type VideoThread } from './useVideoThreads';
import {
  VideoEvidencePlayer,
  type VideoEvidencePlayerHandle,
  type VideoMark,
} from './VideoEvidencePlayer';
import { formatVideoTime } from './videoTime';

const styles = stylex.create({
  badgeColor: (color: string) => ({ backgroundColor: color }),
  item: {
    scrollMarginBlock: 96,
    borderRadius: cssVar.borderRadius,
    transition: `background ${cssVar.motionDurationMid}`,
  },
  itemOpen: {
    backgroundColor: cssVar.colorFillQuaternary,
    boxShadow: `inset 0 0 0 1px ${cssVar.colorBorderSecondary}`,
  },
  row: {
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    width: '100%',
    minHeight: 36,
    paddingBlock: 6,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: cssVar.borderRadius,
    fontSize: 14,
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
    outlineOffset: { 'default': null, ':focus-visible': -2 },
  },
  badge: {
    flex: 'none',
    width: 18,
    height: 18,
    borderRadius: '50%',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: '18px',
    color: cssVar.colorTextLightSolid,
    textAlign: 'center',
  },
  stamp: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
  },
  author: {
    overflow: 'hidden',
    flex: 'none',
    maxWidth: '30%',
    fontSize: 12,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: { 'default': null, '@media (width <= 767px)': 'none' },
  },
  excerpt: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resolved: { color: cssVar.colorTextTertiary },
  meta: {
    display: 'inline-flex',
    flex: 'none',
    gap: 4,
    alignItems: 'center',
    fontSize: 12,
    color: cssVar.colorTextTertiary,
  },
  chevron: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    transition: {
      'default': `transform ${cssVar.motionDurationMid}`,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  chevronOpen: { transform: 'rotate(90deg)' },
  thread: {
    paddingBlockStart: 0,
    paddingBlockEnd: 12,
    paddingInlineStart: 36,
    paddingInlineEnd: 12,
  },
});

/**
 * A video with its discussion. The posted comments sit under the player as an
 * index in timeline order — number, moment, who, the first line — so a reader
 * can scan them without the full threads stacking up below the recording.
 * Opening one pauses on its frame, lifts its region and unfolds the thread with
 * its replies and resolve action; a pin on the timeline opens the same row.
 */
export const VideoEvidenceDiscussion = ({
  evidenceId,
  src,
  caption,
  chapters,
  overlays = [],
  notes = [],
  onComment,
  onRefreshSource,
}: {
  caption?: ReactNode;
  chapters?: VerifyEvidenceChapter[];
  evidenceId: string;
  /** Reject notes from an earlier review of this video. */
  notes?: AcceptanceReviewAnnotation[];
  onComment?: (time: number) => void;
  onRefreshSource?: () => Promise<unknown>;
  overlays?: EvidenceOverlay[];
  src: string;
}) => {
  const { t } = useTranslation('verify');
  const player = useRef<VideoEvidencePlayerHandle>(null);
  const scope = useOptionalAcceptanceScope();
  const { open, openId, threads, toggle } = useVideoThreads(
    overlays,
    (thread) => player.current?.focus(thread.time, { reveal: false }),
    scope?.embedded,
  );

  // Numbered per video in playing order, so the list counts up the way the
  // timeline reads; the check-wide thread number would start mid-way.
  const marks: VideoMark[] = [
    ...threads.map((item, index) => ({
      color: overlayColor(item),
      comment: item.comment,
      key: item.threadId,
      label: index + 1,
      rect: item.rect,
      time: item.time,
    })),
    ...notes.flatMap((note, index) =>
      note.time
        ? [
            {
              comment: note.comment,
              key: `review-${evidenceId}-${index}`,
              rect: note.rect,
              time: note.time,
            },
          ]
        : [],
    ),
  ];

  // Opening a row keeps the reader on the thread they asked for: the player
  // moves to the moment where it stands, without scrolling the row away (on a
  // phone the two do not fit on one screen).
  const select = (item: VideoThread) => {
    if (toggle(item.threadId)) player.current?.focus(item.time, { reveal: false });
  };

  return (
    <Flexbox gap={12}>
      <VideoEvidencePlayer
        activeMark={openId}
        caption={caption}
        chapters={chapters}
        handleRef={player}
        marks={marks}
        src={src}
        onComment={onComment}
        onRefreshSource={onRefreshSource}
        onMarkClick={(key) => {
          if (!threads.some((item) => item.threadId === key)) return;
          open(key);
          requestAnimationFrame(() =>
            document
              .getElementById(`video-thread-${key}`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
          );
        }}
      />
      {threads.length > 0 && (
        <Flexbox gap={4}>
          <Text fontSize={12} style={{ paddingInline: 8 }} type={'secondary'}>
            {t('acceptance.comments.video.listTitle', { count: threads.length })}
          </Text>
          {threads.map((item, index) => {
            const isOpen = openId === item.threadId;
            const messages = item.commentIds?.length ?? 1;
            return (
              <div
                {...stylex.props([styles.item, isOpen && styles.itemOpen])}
                id={`video-thread-${item.threadId}`}
                key={item.threadId}
              >
                <button
                  aria-expanded={isOpen}
                  {...stylex.props(styles.row)}
                  type={'button'}
                  onClick={() => select(item)}
                >
                  <span {...stylex.props(styles.badge, styles.badgeColor(overlayColor(item)))}>
                    {index + 1}
                  </span>
                  <span {...stylex.props(styles.stamp)}>{formatVideoTime(item.time.start)}</span>
                  {/* Open, the thread below names the author and says it in full. */}
                  <span {...stylex.props(styles.author)}>{isOpen ? '' : item.authorName}</span>
                  <span {...stylex.props([styles.excerpt, item.resolved && styles.resolved])}>
                    {isOpen ? '' : item.comment}
                  </span>
                  {messages > 1 && (
                    <span
                      {...stylex.props(styles.meta)}
                      title={t('acceptance.comments.sectionMessages', { count: messages })}
                    >
                      <Icon icon={MessageSquare} size={12} />
                      {messages}
                    </span>
                  )}
                  {item.resolved && (
                    <span {...stylex.props(styles.meta)} title={t('acceptance.comments.resolved')}>
                      <Icon icon={CheckCircle2} size={14} />
                    </span>
                  )}
                  <Icon
                    {...stylex.props([styles.chevron, isOpen && styles.chevronOpen])}
                    icon={ChevronRight}
                    size={14}
                  />
                </button>
                {isOpen && (
                  <div {...stylex.props(styles.thread)} id={commentAnchorId(item.threadId)}>
                    {item.panel}
                  </div>
                )}
              </div>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
};
