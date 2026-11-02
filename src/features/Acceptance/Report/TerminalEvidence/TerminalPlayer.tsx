'use client';

import '@xterm/xterm/css/xterm.css';

import { formatSize } from '@lobechat/utils/format';
import { ASCIICAST_LIMITS } from '@lobechat/utils/verify/asciicast';
import { createTerminalSanitizer } from '@lobechat/utils/verify/terminalEvidence';
import { ActionIcon, cx, DropdownMenu, Flexbox, Icon, Slider, Spin, useTheme } from '@lobehub/ui';
import { Terminal } from '@xterm/xterm';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildXtermTheme } from '@/features/ChatTerminal/theme';

import { terminalReplayError } from './model';
import { styles } from './playerStyle';
import { styles as sharedStyles } from './styles';
import {
  buildTimeline,
  collectOps,
  eventCountAt,
  formatPlaybackClock,
  MAX_IDLE_SECONDS,
  PLAYBACK_RATES,
  type PlaybackTimeline,
  PRECISE_CLOCK_MAX_SECONDS,
} from './timeline';
import { useAsciicast } from './useAsciicast';

/**
 * Replays a recording into a terminal that can only be watched. Nothing it
 * renders can reach out: stdin is disabled and no input handler is attached,
 * links never open, no clipboard or web-links addon is loaded, and every
 * output chunk passes one sanitizer per pass that strips OSC / DCS / APC / PM
 * strings before xterm parses them.
 */
const Player = memo<{ duration: number; timeline: PlaybackTimeline }>(({ duration, timeline }) => {
  const { t } = useTranslation('verify');
  const theme = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const appliedRef = useRef(0);
  // One sanitizer per playback pass; created with the terminal, replaced on every rewind.
  const sanitizerRef = useRef<ReturnType<typeof createTerminalSanitizer> | null>(null);
  const timeRef = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);

  /** Bring the screen to playback time `t`: forward applies the gap, backward replays from zero. */
  const renderTo = useCallback(
    (target: number) => {
      const term = termRef.current;
      let sanitize = sanitizerRef.current;
      if (!term || !sanitize) return;
      const count = eventCountAt(timeline.events, target);
      if (count < appliedRef.current) {
        // RIS through the write queue, so it lands after anything still being
        // parsed; the resize rides the same queue for the same reason.
        term.write('\u001Bc', () => term.resize(timeline.cols, timeline.rows));
        sanitize = createTerminalSanitizer();
        sanitizerRef.current = sanitize;
        appliedRef.current = 0;
      }
      for (const op of collectOps(timeline.events, appliedRef.current, count, sanitize)) {
        if (op.type === 'write') term.write(op.data);
        else term.write('', () => term.resize(op.cols, op.rows));
      }
      appliedRef.current = count;
    },
    [timeline],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let term: Terminal | null = null;
    const mount = () => {
      term = new Terminal({
        allowProposedApi: false,
        cols: timeline.cols,
        cursorBlink: false,
        disableStdin: true,
        fontFamily: theme.fontFamilyCode,
        fontSize: 12,
        // OSC 8 links are already stripped; this makes sure none would ever open.
        linkHandler: { activate: () => {} },
        rows: timeline.rows,
        scrollback: 5000,
        theme: buildXtermTheme(theme),
      });
      term.open(host);
      termRef.current = term;
      appliedRef.current = 0;
      sanitizerRef.current = createTerminalSanitizer();
      timeRef.current = 0;
      renderTo(0);
      setTime(0);
      // The reader opened Replay to watch it run; start right away.
      setPlaying(true);
    };
    // Open the terminal only once its host is on screen. xterm pauses painting
    // while it believes it is hidden and repaints on the next visibility change;
    // opened mid-layout (two replays opened together push each other around) it
    // could record "hidden", miss that change, and play a whole recording into
    // a screen that stayed blank.
    const visibility = new IntersectionObserver((entries) => {
      if (term || !entries.some((entry) => entry.isIntersecting)) return;
      visibility.disconnect();
      mount();
    });
    visibility.observe(host);
    return () => {
      visibility.disconnect();
      term?.dispose();
      termRef.current = null;
    };
    // The theme is applied live below; recreating the terminal would lose the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTo, timeline]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = buildXtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(timeRef.current + ((now - last) / 1000) * rate, timeline.duration);
      last = now;
      timeRef.current = next;
      renderTo(next);
      setTime(next);
      if (next >= timeline.duration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, rate, renderTo, timeline]);

  const seek = (target: number) => {
    const next = Math.min(Math.max(0, target), timeline.duration);
    timeRef.current = next;
    renderTo(next);
    setTime(next);
  };

  const togglePlay = () => {
    if (!playing && timeRef.current >= timeline.duration) seek(0);
    setPlaying(!playing);
  };

  const compressed = duration - timeline.duration > 0.05;
  const precise = timeline.duration < PRECISE_CLOCK_MAX_SECONDS;

  return (
    <Flexbox gap={8}>
      <div className={styles.screen}>
        {/* Sized before the terminal exists, so visibility can be observed and the
            card does not jump when it opens. */}
        <div ref={hostRef} style={{ minHeight: timeline.rows * 14 }} />
      </div>
      <Flexbox horizontal align={'center'} gap={8}>
        <ActionIcon
          icon={playing ? Pause : Play}
          size={'small'}
          title={t(playing ? 'report.terminal.player.pause' : 'report.terminal.player.play')}
          onClick={togglePlay}
        />
        <ActionIcon
          icon={RotateCcw}
          size={'small'}
          title={t('report.terminal.player.restart')}
          onClick={() => {
            seek(0);
            setPlaying(true);
          }}
        />
        <span className={styles.clock}>
          {formatPlaybackClock(time, precise)} / {formatPlaybackClock(timeline.duration, precise)}
        </span>
        <Slider
          aria-label={t('report.terminal.player.seek')}
          max={Math.max(timeline.duration, 0.01)}
          min={0}
          step={0.01}
          style={{ flex: 1, minWidth: 80 }}
          value={time}
          onChange={seek}
        />
        <DropdownMenu
          items={PLAYBACK_RATES.map((value) => ({
            extra: value === rate ? <Icon icon={Check} /> : undefined,
            key: String(value),
            label: `${value}×`,
            onClick: () => setRate(value),
          }))}
        >
          <button
            className={cx(styles.rate, rate !== 1 && styles.rateActive)}
            title={t('report.terminal.player.speed')}
            type={'button'}
          >
            {rate}×
          </button>
        </DropdownMenu>
      </Flexbox>
      {timeline.markers.length > 0 && (
        <Flexbox horizontal aria-label={t('report.terminal.player.markers')} gap={6} wrap={'wrap'}>
          {timeline.markers.map((marker, index) => (
            <button
              className={styles.marker}
              key={`${marker.at}-${index}`}
              type={'button'}
              onClick={() => seek(marker.at)}
            >
              <span className={styles.markerTime}>{formatPlaybackClock(marker.at, precise)}</span>
              {marker.label}
            </button>
          ))}
        </Flexbox>
      )}
      {compressed && (
        <span className={sharedStyles.hint}>
          {t('report.terminal.player.idleCompressed', {
            duration: formatPlaybackClock(duration),
            seconds: MAX_IDLE_SECONDS,
          })}
        </span>
      )}
    </Flexbox>
  );
});

Player.displayName = 'TerminalReplayPlayer';

/**
 * The Replay view: load and validate the recording, then hand it to the
 * player. Any failure is stated plainly and the text views stay one click
 * away — a recording that cannot replay never hides the output.
 */
const TerminalPlayer = memo<{ url: string }>(({ url }) => {
  const { t } = useTranslation('verify');
  const { cast, error, loading } = useAsciicast(url);
  const timeline = useMemo(() => (cast ? buildTimeline(cast) : null), [cast]);

  if (loading)
    return (
      <div className={sharedStyles.outputState}>
        <Spin size={'large'} />
      </div>
    );

  if (error || !timeline || !cast) {
    const failure = terminalReplayError(error);
    return (
      <div className={sharedStyles.outputState} role={'alert'}>
        {t(failure.summaryKey, { size: formatSize(ASCIICAST_LIMITS.maxBytes, 0) })}
        {failure.details && (
          <details key={url} style={{ maxWidth: '100%' }}>
            <summary className={sharedStyles.linkButton}>{t('report.terminal.error.show')}</summary>
            <pre
              className={sharedStyles.mono}
              style={{
                margin: 0,
                overflowWrap: 'anywhere',
                textAlign: 'start',
                whiteSpace: 'pre-wrap',
              }}
            >
              {failure.details}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (timeline.events.length === 0)
    return <div className={sharedStyles.outputState}>{t('report.terminal.output.empty')}</div>;

  return <Player duration={cast.duration} timeline={timeline} />;
});

TerminalPlayer.displayName = 'TerminalPlayer';

export default TerminalPlayer;
