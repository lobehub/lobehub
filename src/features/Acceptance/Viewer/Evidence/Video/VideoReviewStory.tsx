'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { VerifyEvidenceChapter } from '@lobechat/types';
import { Text, TextArea, useVideoState, type VideoPlayer } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry } from '../../Review/rejectDraft';
import {
  activeStoryEntryId,
  type StoryClaimEntry,
  type StoryEntry,
  type StoryNote,
  type StoryNoteEntry,
} from './story';
import {
  StoryBadge,
  StoryChapter,
  StoryDot,
  StoryItem,
  StoryLink,
  StoryList,
  StoryText,
  StoryTitle,
  StoryWho,
} from './VideoStory';
import { formatVideoTime } from './videoTime';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  quote: {
    display: 'block',
    marginBlockStart: '4px',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

export type ReviewStoryNote = StoryNote & { source: DraftAnnotationEntry };

export const storyEntryDomId = (id: string) => `video-story-${id}`;

export const toReviewStoryNotes = (notes: DraftAnnotationEntry[]): ReviewStoryNote[] =>
  notes.flatMap((note) =>
    note.time
      ? [
          {
            disputes: note.disputes,
            end: note.time.end,
            key: note.key,
            source: note,
            start: note.time.start,
          },
        ]
      : [],
  );

interface VideoReviewStoryProps {
  activeNoteKey?: number;
  onChangeNote: (key: number, comment: string) => void;
  onCoverSpan: (note: DraftAnnotationEntry) => void;
  onDispute: (claim: VerifyEvidenceChapter) => void;
  onFocusNote: (note: DraftAnnotationEntry) => void;
  onRemoveNote: (key: number) => void;
  onSeek: (seconds: number) => void;
  onSingleFrame: (note: DraftAnnotationEntry) => void;
  player: VideoPlayer;
  story: StoryEntry<ReviewStoryNote>[];
}

export const VideoReviewStory = ({
  activeNoteKey,
  onChangeNote,
  onCoverSpan,
  onDispute,
  onFocusNote,
  onRemoveNote,
  onSeek,
  onSingleFrame,
  player,
  story,
}: VideoReviewStoryProps) => {
  const { t } = useTranslation('verify');
  const activeId = useVideoState(player, (state) => activeStoryEntryId(story, state.time));

  const field = (note: DraftAnnotationEntry, placeholder: string) => (
    <TextArea
      aria-label={placeholder}
      autoFocus={note.key === activeNoteKey}
      autoSize={{ maxRows: 5, minRows: 1 }}
      placeholder={placeholder}
      value={note.comment}
      variant={'filled'}
      onChange={(event) => onChangeNote(note.key, event.target.value)}
      onFocus={() => {
        if (note.key !== activeNoteKey) onFocusNote(note);
      }}
    />
  );

  const claimItem = (entry: StoryClaimEntry<ReviewStoryNote>) => {
    const dispute = entry.dispute?.source;
    const label = t(`acceptance.video.claim.${entry.claim.kind}`);
    return (
      <StoryItem
        active={entry.id === activeId}
        id={storyEntryDomId(entry.id)}
        key={entry.id}
        marker={<StoryDot kind={entry.claim.kind} />}
        time={entry.time}
        actions={
          dispute ? (
            <StoryLink onClick={() => onRemoveNote(dispute.key)}>
              {t('acceptance.video.story.withdraw')}
            </StoryLink>
          ) : (
            <StoryLink onClick={() => onDispute(entry.claim)}>
              {t('acceptance.video.dispute')}
            </StoryLink>
          )
        }
        head={
          <>
            <StoryWho>{dispute ? `${label} · ${t('acceptance.video.disputed')}` : label}</StoryWho>
            <StoryText>{entry.claim.note}</StoryText>
          </>
        }
        onSeek={() => (dispute ? onFocusNote(dispute) : onSeek(entry.time))}
      >
        {dispute && field(dispute, t('acceptance.video.notePlaceholderDispute'))}
      </StoryItem>
    );
  };

  const noteItem = (entry: StoryNoteEntry<ReviewStoryNote>) => {
    const note = entry.note.source;
    const { end } = entry.note;
    const span = end !== undefined;
    let detail = t('acceptance.video.story.noteFrame');
    let placeholder = t('acceptance.video.notePlaceholderFrame');
    if (span) {
      detail = t('acceptance.video.story.noteSpan', {
        end: formatVideoTime(end),
        start: formatVideoTime(entry.time),
      });
      placeholder = t('acceptance.video.notePlaceholderRange');
    } else if (!isFullFrameRect(note.rect)) detail = t('acceptance.video.story.noteCircled');
    if (note.disputes) placeholder = t('acceptance.video.notePlaceholderDispute');

    return (
      <StoryItem
        active={entry.id === activeId}
        id={storyEntryDomId(entry.id)}
        key={entry.id}
        marker={<StoryBadge>{entry.index}</StoryBadge>}
        time={entry.time}
        actions={
          <>
            {span ? (
              <StoryLink onClick={() => onSingleFrame(note)}>
                {t('acceptance.video.story.singleFrame')}
              </StoryLink>
            ) : (
              <StoryLink onClick={() => onCoverSpan(note)}>
                {t('acceptance.video.story.coverSpan')}
              </StoryLink>
            )}
            <StoryLink onClick={() => onRemoveNote(note.key)}>
              {t('acceptance.video.story.delete')}
            </StoryLink>
          </>
        }
        head={
          <>
            <StoryWho>{`${t('acceptance.video.story.yourNote')} · ${detail}`}</StoryWho>
            {note.disputes && (
              <StoryText xstyle={styles.quote}>
                {`${t(`acceptance.video.claim.${note.disputes.kind}`)} · ${note.disputes.note ?? ''}`}
              </StoryText>
            )}
          </>
        }
        onSeek={() => onFocusNote(note)}
      >
        {field(note, placeholder)}
      </StoryItem>
    );
  };

  return (
    <div {...stylex.props(styles.root)}>
      <StoryTitle>{t('acceptance.video.story.title')}</StoryTitle>
      {story.length === 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('acceptance.video.story.empty')}
        </Text>
      ) : (
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
                    onSeek={() => onSeek(entry.time)}
                  />
                );
              }
              case 'claim': {
                return claimItem(entry);
              }
              case 'note': {
                return noteItem(entry);
              }
            }
          })}
        </StoryList>
      )}
    </div>
  );
};
