'use client';

import { useVideoState, type VideoPlayer } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { captionEntriesAt, type StoryEntry, storyEntryCaption } from './story';
import type { ReviewStoryNote } from './VideoReviewStory';
import { StoryBadge, StoryDot } from './VideoStory';

const styles = stylex.create({
  root: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: '12px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: 'max-content',
    maxWidth: 'calc(100% - 24px)',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: '22px',
    color: '#fff',
    overflowWrap: 'anywhere',
    backgroundColor: 'rgb(0 0 0 / 65%)',
    backgroundImage: 'none',
  },
  who: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '20px',
    color: 'rgb(255 255 255 / 75%)',
  },
});

const ID_SEPARATOR = '\n';

const noteText = (note: ReviewStoryNote) => note.source.comment;

interface VideoStoryCaptionProps {
  player: VideoPlayer;
  story: StoryEntry<ReviewStoryNote>[];
}

export const VideoStoryCaption = ({ player, story }: VideoStoryCaptionProps) => {
  const { t } = useTranslation('verify');
  const shownIds = useVideoState(player, (state) =>
    state.captions
      ? captionEntriesAt(story, state.time, noteText)
          .map((entry) => entry.id)
          .join(ID_SEPARATOR)
      : '',
  );
  if (!shownIds) return null;

  const ids = new Set(shownIds.split(ID_SEPARATOR));
  const who = (entry: StoryEntry<ReviewStoryNote>): ReactNode => {
    switch (entry.type) {
      case 'chapter': {
        return null;
      }
      case 'claim': {
        return (
          <span {...stylex.props(styles.who)}>
            <StoryDot kind={entry.claim.kind} />
            {t(`acceptance.video.claim.${entry.claim.kind}`)}
          </span>
        );
      }
      case 'note': {
        return (
          <span {...stylex.props(styles.who)}>
            <StoryBadge>{entry.index}</StoryBadge>
            {t('acceptance.video.story.yourNote')}
          </span>
        );
      }
    }
  };

  return (
    <div aria-live={'polite'} {...stylex.props(styles.root)}>
      {story
        .filter((entry) => ids.has(entry.id))
        .map((entry) => (
          <div key={entry.id}>
            {who(entry)}
            <div>{storyEntryCaption(entry, noteText)}</div>
          </div>
        ))}
    </div>
  );
};
