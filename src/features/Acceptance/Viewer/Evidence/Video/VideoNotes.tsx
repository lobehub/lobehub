'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Flag, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry } from '../../Review/rejectDraft';
import { RegionNoteRow } from '../RegionNotes';
import { ClaimLabel } from './ClaimLabel';
import { formatVideoTime, frameOf } from './videoTime';

const styles = stylex.create({
  stamp: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorErrorText,
    backgroundColor: { 'default': cssVar.colorErrorBg, ':hover': cssVar.colorErrorBgHover },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  active: { boxShadow: `0 0 0 1px ${cssVar.colorError}` },
  quote: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderRadius: '6px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

interface VideoNotesProps {
  activeNoteKey?: number;
  notes: DraftAnnotationEntry[];
  onChange: (key: number, comment: string) => void;
  onFocusNote: (note: DraftAnnotationEntry) => void;
  onRemove: (key: number) => void;
}

/**
 * The notes on the video on screen, in the order they occur. Each names its
 * frame or span — clicking it seeks there — and a dispute quotes the agent's
 * claim it answers, so the note reads on its own in the next round.
 */
export const VideoNotes = ({
  activeNoteKey,
  notes,
  onChange,
  onFocusNote,
  onRemove,
}: VideoNotesProps) => {
  const { t } = useTranslation('verify');
  const sorted = notes.filter((note) => note.time).sort((a, b) => a.time!.start - b.time!.start);

  return sorted.map((note, index) => {
    const time = note.time!;
    const span = time.end !== undefined;
    let placeholder = t('acceptance.video.notePlaceholderFrame');
    if (note.disputes) placeholder = t('acceptance.video.notePlaceholderDispute');
    else if (span) placeholder = t('acceptance.video.notePlaceholderRange');
    let detail = t('acceptance.video.frame', { frame: frameOf(time.start) });
    if (span)
      detail = t('acceptance.video.rangeSeconds', { seconds: (time.end! - time.start).toFixed(1) });
    else if (!isFullFrameRect(note.rect)) detail += ` · ${t('acceptance.video.circled')}`;

    return (
      <RegionNoteRow
        autoFocus={note.key === activeNoteKey && !note.comment}
        index={index + 1}
        key={note.key}
        placeholder={placeholder}
        value={note.comment}
        caption={
          <Flexbox gap={6}>
            <Flexbox horizontal align={'center'} gap={6}>
              <button
                {...stylex.props(styles.stamp, note.key === activeNoteKey && styles.active)}
                type={'button'}
                onClick={() => onFocusNote(note)}
              >
                <Icon icon={span ? Repeat : Flag} size={11} />
                {span
                  ? `${formatVideoTime(time.start)} – ${formatVideoTime(time.end!)}`
                  : formatVideoTime(time.start)}
              </button>
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 11 }}>{detail}</span>
            </Flexbox>
            {note.disputes && (
              <div {...stylex.props(styles.quote)}>
                <ClaimLabel kind={note.disputes.kind} />
                <div>{note.disputes.note}</div>
              </div>
            )}
          </Flexbox>
        }
        onChange={(comment) => onChange(note.key, comment)}
        onRemove={() => onRemove(note.key)}
      />
    );
  });
};
