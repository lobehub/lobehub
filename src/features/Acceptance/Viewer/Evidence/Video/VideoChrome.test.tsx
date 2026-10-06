import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VideoClock } from './useVideoClock';
import { ClaimCaption, handlePlaybackKey } from './VideoChrome';
import { VideoTimeline } from './VideoTimeline';

const clock = () =>
  ({
    controls: {
      seek: vi.fn(),
      setRate: vi.fn(),
      step: vi.fn(),
      toggle: vi.fn(),
    },
    rate: 1,
    time: 0,
  }) as unknown as VideoClock;

describe('handlePlaybackKey', () => {
  it('plays on Space, but leaves Space and Enter to a focused button', () => {
    const player = clock();
    const button = document.createElement('button');

    expect(handlePlaybackKey(new KeyboardEvent('keydown', { key: ' ' }), player)).toBe(true);
    const onButton = new KeyboardEvent('keydown', { key: ' ' });
    Object.defineProperty(onButton, 'target', { value: button });
    const enterOnButton = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(enterOnButton, 'target', { value: button });

    expect(handlePlaybackKey(onButton, player)).toBe(false);
    expect(handlePlaybackKey(enterOnButton, player)).toBe(false);
    expect(player.controls.toggle).toHaveBeenCalledTimes(1);
  });
});

describe('VideoTimeline markers', () => {
  // Enter / Space on a focused button dispatch click, not pointerdown.
  it('seek from a click, so they work from the keyboard', () => {
    const onClaimClick = vi.fn();
    const onNoteClick = vi.fn();
    const onSeek = vi.fn();
    render(
      <VideoTimeline
        chapters={[{ kind: 'check', note: 'no skeleton', t: 7.9 }]}
        duration={15}
        notes={[{ comment: 'flash', key: 1, start: 7.2 }]}
        src={'clip.mp4'}
        time={0}
        onClaimClick={onClaimClick}
        onNoteClick={onNoteClick}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /no skeleton/ }));
    fireEvent.click(screen.getByRole('button', { name: /flash/ }));

    expect(onClaimClick).toHaveBeenCalledWith(expect.objectContaining({ t: 7.9 }));
    expect(onNoteClick).toHaveBeenCalledWith(expect.objectContaining({ start: 7.2 }));
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe('ClaimCaption', () => {
  it('gives each claim on the frame its own action', () => {
    const onDispute = vi.fn();
    render(
      <ClaimCaption
        action={(claim) => (
          <button type={'button'} onClick={() => onDispute(claim.note)}>
            {`dispute ${claim.note}`}
          </button>
        )}
        claims={[
          { kind: 'check', note: 'no skeleton', t: 7.9 },
          { kind: 'check', note: 'first question in place', t: 7.9 },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'dispute first question in place' }));

    expect(onDispute).toHaveBeenCalledWith('first question in place');
    expect(screen.getByText('no skeleton')).toBeTruthy();
  });
});
