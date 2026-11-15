import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State of the meeting's `<audio>` element, shared by the player, the
 * transcript highlight and the minutes' citations. `knownDurationMs` covers
 * recordings whose container carries no duration (WebM from `MediaRecorder`),
 * where the element reports `Infinity`.
 */
export const usePlayback = (knownDurationMs?: number | null) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState<number>();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncTime = () => setCurrentMs(audio.currentTime * 1000);
    const syncDuration = () =>
      setMediaDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : undefined);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('seeked', syncTime);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    return () => {
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('seeked', syncTime);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
    };
    // The element mounts with the page that calls this hook and is never swapped.
  }, []);

  /** Jump to `ms` and keep playing from there. */
  const seek = useCallback((ms: number, { play = true }: { play?: boolean } = {}) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    setCurrentMs(ms);
    if (play) void audio.play().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  return {
    audioRef,
    currentMs,
    durationMs: mediaDurationMs ?? knownDurationMs ?? 0,
    playing,
    seek,
    toggle,
  };
};

export type Playback = ReturnType<typeof usePlayback>;
