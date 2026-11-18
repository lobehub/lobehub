'use client';

import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAcceptanceScope } from '../../AcceptanceScope';
import { commentAnchorId } from '../../Comments/anchor';
import { type EvidenceOverlay, overlayColor } from '../overlay';
import { buildVideoStory, type StoryNote } from './story';
import { useVideoThreads, type VideoThread } from './useVideoThreads';
import {
  VideoEvidencePlayer,
  type VideoEvidencePlayerHandle,
  type VideoMark,
} from './VideoEvidencePlayer';
import {
  StoryBadge,
  StoryChapter,
  StoryDot,
  StoryItem,
  StoryList,
  StoryText,
  StoryTitle,
  StoryWho,
} from './VideoStory';

const styles = stylex.create({
  item: {
    scrollMarginBlock: 96,
  },
  story: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingInline: 8,
  },
  heading: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  count: {
    fontSize: 12,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  who: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
  },
  author: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: 12,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  excerpt: {
    overflow: 'hidden',
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
    marginInlineStart: 'auto',
    color: cssVar.colorTextTertiary,
    transition: {
      'default': `transform ${cssVar.motionDurationMid}`,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  chevronOpen: { transform: 'rotate(90deg)' },
});

type ThreadStoryNote = StoryNote & { thread: VideoThread };

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

  const story = buildVideoStory<ThreadStoryNote>(
    chapters ?? [],
    threads.map((thread) => ({ key: thread.threadId, start: thread.time.start, thread })),
  );
  const seek = (start: number) => player.current?.focus({ start }, { reveal: false });

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
        claimList={false}
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
      {story.length > 0 && (
        <div {...stylex.props(styles.story)}>
          <div {...stylex.props(styles.heading)}>
            <StoryTitle>{t('acceptance.video.story.title')}</StoryTitle>
            {threads.length > 0 && (
              <span {...stylex.props(styles.count)}>
                {t('acceptance.comments.video.listTitle', { count: threads.length })}
              </span>
            )}
          </div>
          <StoryList>
            {story.map((entry, index) => {
              switch (entry.type) {
                case 'chapter': {
                  return (
                    <StoryChapter
                      first={index === 0}
                      key={entry.id}
                      label={entry.label}
                      time={entry.time}
                      onSeek={() => seek(entry.time)}
                    />
                  );
                }
                case 'claim': {
                  return (
                    <StoryItem
                      key={entry.id}
                      marker={<StoryDot kind={entry.claim.kind} />}
                      time={entry.time}
                      head={
                        <>
                          <StoryWho>{t(`acceptance.video.claim.${entry.claim.kind}`)}</StoryWho>
                          <StoryText>{entry.claim.note}</StoryText>
                        </>
                      }
                      onSeek={() => seek(entry.time)}
                    />
                  );
                }
                case 'note': {
                  const item = entry.note.thread;
                  const isOpen = openId === item.threadId;
                  const messages = item.commentIds?.length ?? 1;
                  return (
                    <StoryItem
                      active={isOpen}
                      expanded={isOpen}
                      id={`video-thread-${item.threadId}`}
                      key={entry.id}
                      marker={<StoryBadge color={overlayColor(item)}>{entry.index}</StoryBadge>}
                      time={entry.time}
                      xstyle={styles.item}
                      head={
                        <>
                          <span {...stylex.props(styles.who)}>
                            <span {...stylex.props(styles.author)}>{item.authorName}</span>
                            {messages > 1 && (
                              <span
                                {...stylex.props(styles.meta)}
                                title={t('acceptance.comments.sectionMessages', {
                                  count: messages,
                                })}
                              >
                                <Icon icon={MessageSquare} size={12} />
                                {messages}
                              </span>
                            )}
                            {item.resolved && (
                              <span
                                {...stylex.props(styles.meta)}
                                title={t('acceptance.comments.resolved')}
                              >
                                <Icon icon={CheckCircle2} size={14} />
                              </span>
                            )}
                            <Icon
                              {...stylex.props(styles.chevron, isOpen && styles.chevronOpen)}
                              icon={ChevronRight}
                              size={14}
                            />
                          </span>
                          {/* Open, the thread below says it in full. */}
                          {!isOpen && (
                            <StoryText xstyle={[styles.excerpt, item.resolved && styles.resolved]}>
                              {item.comment}
                            </StoryText>
                          )}
                        </>
                      }
                      onSeek={() => select(item)}
                    >
                      {isOpen && <div id={commentAnchorId(item.threadId)}>{item.panel}</div>}
                    </StoryItem>
                  );
                }
              }
            })}
          </StoryList>
        </div>
      )}
    </Flexbox>
  );
};
