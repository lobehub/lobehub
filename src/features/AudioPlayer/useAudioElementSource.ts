import type { RefObject } from 'react';
import { useEffect } from 'react';

export const useAudioElementSource = (
  audioRef: RefObject<HTMLAudioElement | null>,
  url: string,
) => {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.src = url;

    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [audioRef, url]);
};
