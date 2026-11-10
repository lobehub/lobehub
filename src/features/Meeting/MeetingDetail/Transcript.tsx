import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';

import { openRenameModal } from '@/components/RenameModal';

import { formatClock } from '../format';
import type { SpeakerView } from './speakers';

const styles = stylex.create({
  active: {
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorFillQuaternary },
  },
  name: {
    fontSize: 13,
    fontWeight: 600,
  },
  rename: {
    opacity: {
      'default': 0,
      ':focus-visible': 1,
      [stylex.when.ancestor(':hover')]: 1,
    },
    transition: 'opacity 150ms ease',
  },
  row: {
    cursor: 'pointer',
    paddingBlock: 12,
    paddingInline: 12,
    borderRadius: cssVar.borderRadiusLG,
    transition: 'background-color 150ms ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    outlineWidth: { 'default': null, ':focus-visible': 2 },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': -2 },
  },
  text: {
    fontSize: 14,
    lineHeight: 1.75,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-word',
  },
  textActive: {
    color: cssVar.colorText,
  },
  time: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

export interface TranscriptSegment {
  endMs: number;
  id: string;
  speakerId: string | null;
  startMs: number;
  text: string;
}

interface SpeakerNameProps {
  color?: string;
  name: string;
  /** Save a new name; absent when the speaker is unknown or the meeting is read-only. */
  onRename?: (name: string) => Promise<void>;
  renameLabel: string;
}

/** Speaker name with a rename dialog, so a diarized "Speaker 2" can become a person. */
const SpeakerName = ({ color, name, onRename, renameLabel }: SpeakerNameProps) => (
  <Flexbox horizontal align={'center'} gap={2}>
    <span
      className={stylex.props(styles.name).className}
      style={{ color: color ?? cssVar.colorTextSecondary }}
    >
      {name}
    </span>
    {onRename && (
      <ActionIcon
        className={stylex.props(styles.rename).className}
        icon={PencilIcon}
        size={'small'}
        title={renameLabel}
        onClick={(event) => {
          event.stopPropagation();
          openRenameModal({ defaultValue: name, onSave: onRename, title: renameLabel });
        }}
      />
    )}
  </Flexbox>
);

interface SegmentRowProps {
  active: boolean;
  onRenameSpeaker?: (speakerId: string, name: string) => Promise<void>;
  onSeek: (ms: number) => void;
  renameLabel: string;
  segment: TranscriptSegment;
  speaker?: SpeakerView;
  unknownSpeaker: string;
}

// Memoized: a meeting has hundreds of rows and playback re-renders the list
// several times a second, but only the rows whose `active` flips change.
const SegmentRow = memo<SegmentRowProps>(
  ({ active, onRenameSpeaker, onSeek, renameLabel, segment, speaker, unknownSpeaker }) => (
    <Flexbox
      aria-current={active ? 'true' : undefined}
      className={`meeting-segment-row ${stylex.props(styles.row, active && styles.active, stylex.defaultMarker()).className}`}
      data-segment-id={segment.id}
      gap={4}
      role={'button'}
      tabIndex={0}
      onClick={() => onSeek(segment.startMs)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSeek(segment.startMs);
        }
      }}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <SpeakerName
          color={speaker?.color}
          name={speaker?.name ?? unknownSpeaker}
          renameLabel={renameLabel}
          onRename={
            segment.speakerId && onRenameSpeaker
              ? (name) => onRenameSpeaker(segment.speakerId!, name)
              : undefined
          }
        />
        <span className={stylex.props(styles.time).className}>{formatClock(segment.startMs)}</span>
      </Flexbox>
      <div
        className={`${stylex.props(styles.text, active && styles.textActive).className} meeting-segment-text`}
      >
        {segment.text}
      </div>
    </Flexbox>
  ),
);

interface TranscriptProps {
  activeIndex: number;
  emptyText: string;
  /** Scroll the playing segment into view as playback moves on. */
  follow: boolean;
  /** Stable across renders, so memoized rows do not re-render on playback ticks. */
  onRenameSpeaker?: (speakerId: string, name: string) => Promise<void>;
  onSeek: (ms: number) => void;
  renameLabel: string;
  segments: TranscriptSegment[];
  speakers: Map<string, SpeakerView>;
  unknownSpeaker: string;
}

const Transcript = ({
  activeIndex,
  emptyText,
  follow,
  onRenameSpeaker,
  onSeek,
  renameLabel,
  segments,
  speakers,
  unknownSpeaker,
}: TranscriptProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const activeId = activeIndex >= 0 ? segments[activeIndex]?.id : undefined;

  // Centered, not 'nearest': the transcript scrolls under a sticky header that
  // would otherwise cover the row being played.
  useEffect(() => {
    if (!follow || !activeId) return;
    listRef.current
      ?.querySelector(`[data-segment-id="${activeId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeId, follow]);

  if (segments.length === 0)
    return (
      <Text style={{ padding: 12 }} type={'secondary'}>
        {emptyText}
      </Text>
    );

  return (
    <Flexbox gap={2} ref={listRef}>
      {segments.map((segment, index) => (
        <SegmentRow
          active={index === activeIndex}
          key={segment.id}
          renameLabel={renameLabel}
          segment={segment}
          speaker={segment.speakerId ? speakers.get(segment.speakerId) : undefined}
          unknownSpeaker={unknownSpeaker}
          onRenameSpeaker={onRenameSpeaker}
          onSeek={onSeek}
        />
      ))}
    </Flexbox>
  );
};

export default Transcript;
