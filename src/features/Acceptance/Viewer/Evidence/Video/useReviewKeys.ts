import type { VideoPlayer } from '@lobehub/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatVideoTime } from './videoTime';

export interface VideoLoop {
  end: number;
  start: number;
}

export const REVIEW_RATES = [0.5, 1, 1.5, 2];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));

const playbackKey = (event: KeyboardEvent, player: VideoPlayer) => {
  // A focused button owns Space and Enter — they must activate it, not play.
  if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter'))
    return false;
  const { rate, time } = player.getState();
  const nextRate = (direction: 1 | -1) => {
    const index = REVIEW_RATES.indexOf(rate);
    player.setRate(
      REVIEW_RATES[
        Math.min(Math.max((index === -1 ? 1 : index) + direction, 0), REVIEW_RATES.length - 1)
      ],
    );
  };
  switch (event.key.toLowerCase()) {
    case ' ':
    case 'k': {
      player.toggle();
      return true;
    }
    case ',': {
      player.step(-1);
      return true;
    }
    case '.': {
      player.step(1);
      return true;
    }
    case 'arrowleft': {
      player.seek(time - (event.shiftKey ? 5 : 1));
      return true;
    }
    case 'arrowright': {
      player.seek(time + (event.shiftKey ? 5 : 1));
      return true;
    }
    case 'j': {
      nextRate(-1);
      return true;
    }
    case 'l': {
      nextRate(1);
      return true;
    }
    default: {
      return false;
    }
  }
};

interface ReviewKeysOptions {
  onFlash: (text: string) => void;
  onMarkFrame: () => void;
  onRange: (range: VideoLoop | null) => void;
  range: VideoLoop | null;
}

export const useReviewKeys = (player: VideoPlayer, options: ReviewKeysOptions) => {
  const { t } = useTranslation('verify');
  const latest = useRef(options);
  latest.current = options;

  // The modal is the review: keys act whenever the reviewer is not typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const state = player.getState();
      if (state.status !== 'ready') return;
      const { onFlash, onMarkFrame, onRange, range } = latest.current;
      const now = state.time;
      let handled = true;
      switch (event.key.toLowerCase()) {
        case 'm': {
          onMarkFrame();
          break;
        }
        case 'i': {
          // Open-ended until O: a provisional end would loop playback short
          // of the moment the reviewer is waiting for.
          const end = range && range.end > now ? range.end : state.duration;
          onRange({ end, start: now });
          onFlash(t('acceptance.video.inPoint', { time: formatVideoTime(now) }));
          break;
        }
        case 'o': {
          const start = range?.start ?? Math.max(0, now - 1);
          if (now > start) {
            onRange({ end: now, start });
            onFlash(t('acceptance.video.outPoint', { time: formatVideoTime(now) }));
          }
          break;
        }
        case 'escape': {
          if (!range) return;
          onRange(null);
          break;
        }
        default: {
          handled = playbackKey(event, player);
        }
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [player, t]);
};
