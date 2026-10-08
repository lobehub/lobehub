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
