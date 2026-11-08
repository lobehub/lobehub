import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VideoEvidencePlayer } from './VideoEvidencePlayer';

describe('VideoEvidencePlayer load failure', () => {
  // Signed links expire; retrying the same one never recovers the video.
  it('asks for a freshly signed link before retrying', async () => {
    const onRefreshSource = vi.fn(async () => 'https://s3/clip.mp4?sig=new');
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { container } = render(
      <VideoEvidencePlayer src={'https://s3/clip.mp4?sig=old'} onRefreshSource={onRefreshSource} />,
    );

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reload|重新加载/i }));
    });

    expect(onRefreshSource).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalled();
    load.mockRestore();
  });
});

describe('VideoEvidencePlayer sizing', () => {
  it.each([
    { height: 1920, maxWidth: 480, width: 1080 },
    { height: 1080, maxWidth: 640, width: 1920 },
    { height: 1080, maxWidth: 1280, width: 3840 },
  ])('keeps room for controls for a $width × $height recording', ({ height, maxWidth, width }) => {
    const { container } = render(<VideoEvidencePlayer src={'https://s3/clip.mp4'} />);
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      videoHeight: { configurable: true, value: height },
      videoWidth: { configurable: true, value: width },
    });

    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    expect(video.closest('[data-acceptance-video-host]')).toHaveStyle({
      maxWidth: `min(100%, ${maxWidth}px)`,
    });
  });

  // The comment action floats at the host's edge: a host wider than the
  // player left it far from a narrow recording.
  it('keeps the comment action beside the player instead of the column edge', () => {
    const { container } = render(
      <VideoEvidencePlayer src={'https://s3/clip.mp4'} onComment={vi.fn()} />,
    );
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      videoHeight: { configurable: true, value: 1920 },
      videoWidth: { configurable: true, value: 1080 },
    });

    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    const host = video.closest('[data-acceptance-video-host]')!;
    expect(host).toHaveStyle({ maxWidth: 'min(100%, 480px)' });
    expect(host.firstElementChild).toHaveStyle({ width: '100%' });
    expect(host.querySelector('[title]')).not.toBeNull();
  });
});
