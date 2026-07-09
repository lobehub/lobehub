import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import VideoLayout from './index';

const generationLayoutMock = vi.fn((_props: unknown) => null);

vi.mock('@/routes/(main)/(create)/features/GenerationLayout', () => ({
  default: (props: unknown) => generationLayoutMock(props),
}));

vi.mock('./Sidebar', () => ({
  default: () => <div data-testid="video-sidebar" />,
}));

describe('VideoLayout', () => {
  it('passes a video sidebar to the generation layout', () => {
    render(<VideoLayout />);

    expect(generationLayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sidebar: expect.anything(),
      }),
    );
  });
});
