'use client';

import { ActionIcon, Button, Popover, Select, useVideoState, type VideoPlayer } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Captions, Flag, Keyboard, Maximize, Pause, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { REVIEW_RATES } from './useReviewKeys';
import { StoryLink } from './VideoStory';
import { formatVideoTime } from './videoTime';

const styles = stylex.create({
  controls: {
    display: 'flex',
    flex: 'none',
    gap: '8px',
    alignItems: 'center',
    marginBlockStart: '12px',
    fontSize: '12px',
    lineHeight: '20px',
  },
  time: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
  },
  spacer: { flex: '1' },
  rate: { flex: 'none', width: '80px' },
  shortcuts: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    rowGap: '4px',
    columnGap: '12px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  kbd: {
    display: 'inline-block',
    minWidth: '16px',
    marginInline: '1px',
    paddingInline: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  addRow: {
    display: 'flex',
    flex: 'none',
    flexWrap: 'wrap',
    columnGap: '12px',
    rowGap: '4px',
    alignItems: 'center',
    marginBlockStart: '16px',
  },
  hint: {
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
});

const Keys = ({ keys }: { keys: string[] }) => (
  <span>
    {keys.map((key) => (
      <kbd key={key} {...stylex.props(styles.kbd)}>
        {key}
      </kbd>
    ))}
  </span>
);

const Shortcuts = () => {
  const { t } = useTranslation('verify');
  const rows: [string[], ReactNode][] = [
    [['Space'], `${t('acceptance.video.play')} / ${t('acceptance.video.pause')}`],
    [[',', '.'], t('acceptance.video.keysFrame')],
    [['J', 'L'], t('acceptance.video.speed')],
    [['M'], t('acceptance.video.markFrame')],
    [['I', 'O'], t('acceptance.video.keysRange')],
    [['Esc'], t('acceptance.video.clearRange')],
  ];
  return (
    <div {...stylex.props(styles.shortcuts)}>
      {rows.map(([keys, label]) => [
        <Keys key={`keys-${keys.join('')}`} keys={keys} />,
        <span key={`label-${keys.join('')}`}>{label}</span>,
      ])}
    </div>
  );
};

const TimeReadout = ({ player }: { player: VideoPlayer }) => {
  const readout = useVideoState(
    player,
    (state) => `${formatVideoTime(state.time)} / ${formatVideoTime(state.duration)}`,
  );
  return <span {...stylex.props(styles.time)}>{readout}</span>;
};

const CaptionsToggle = ({ player }: { player: VideoPlayer }) => {
  const { t } = useTranslation('verify');
  const shown = useVideoState(player, (state) => state.captions);
  return (
    <ActionIcon
      active={shown}
      aria-pressed={shown}
      icon={Captions}
      size={'small'}
      title={shown ? t('acceptance.video.captionsHide') : t('acceptance.video.captionsShow')}
      onClick={() => player.setCaptions(!shown)}
    />
  );
};

interface ReviewControlsProps {
  captions?: boolean;
  player: VideoPlayer;
}

export const ReviewControls = ({ captions, player }: ReviewControlsProps) => {
  const { t } = useTranslation('verify');
  const paused = useVideoState(player, (state) => state.paused);
  const rate = useVideoState(player, (state) => state.rate);
  const ready = useVideoState(player, (state) => state.status === 'ready');
  const rates = REVIEW_RATES.includes(rate)
    ? REVIEW_RATES
    : [...REVIEW_RATES, rate].toSorted((a, b) => a - b);

  return (
    <div {...stylex.props(styles.controls)}>
      <ActionIcon
        disabled={!ready}
        icon={paused ? Play : Pause}
        size={'small'}
        title={paused ? t('acceptance.video.play') : t('acceptance.video.pause')}
        onClick={player.toggle}
      />
      <TimeReadout player={player} />
      <span {...stylex.props(styles.spacer)} />
      <span {...stylex.props(styles.rate)}>
        <Select
          aria-label={t('acceptance.video.speed')}
          options={rates.map((value) => ({ label: `${value}×`, value: String(value) }))}
          size={'small'}
          value={String(rate)}
          variant={'filled'}
          onChange={(value) => player.setRate(Number(value))}
        />
      </span>
      {captions && <CaptionsToggle player={player} />}
      <Popover content={<Shortcuts />} placement={'topRight'} trigger={'click'}>
        <ActionIcon icon={Keyboard} size={'small'} title={t('acceptance.video.story.shortcuts')} />
      </Popover>
      <ActionIcon
        icon={Maximize}
        size={'small'}
        title={t('acceptance.video.fullscreen')}
        onClick={() => void player.requestFullscreen()}
      />
    </div>
  );
};

interface AddNoteRowProps {
  onAdd: () => void;
  onClearRange: () => void;
  player: VideoPlayer;
  range: { end: number; start: number } | null;
}

export const AddNoteRow = ({ onAdd, onClearRange, player, range }: AddNoteRowProps) => {
  const { t } = useTranslation('verify');
  const ready = useVideoState(player, (state) => state.status === 'ready');
  const time = useVideoState(player, (state) => formatVideoTime(state.time));

  return (
    <div {...stylex.props(styles.addRow)}>
      <Button disabled={!ready} icon={Flag} onClick={onAdd}>
        {range
          ? t('acceptance.video.story.addSpanNote', {
              end: formatVideoTime(range.end),
              start: formatVideoTime(range.start),
            })
          : t('acceptance.video.story.addNote', { time })}
      </Button>
      {range ? (
        <StoryLink onClick={onClearRange}>{t('acceptance.video.clearRange')}</StoryLink>
      ) : (
        <span {...stylex.props(styles.hint)}>{t('acceptance.video.story.addHint')}</span>
      )}
    </div>
  );
};
