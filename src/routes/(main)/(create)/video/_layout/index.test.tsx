import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import VideoLayout from './index';

const generationLayoutMock = vi.fn((_props: unknown) => null);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/routes/(main)/(create)/features/GenerationLayout', () => ({
  default: (props: unknown) => generationLayoutMock(props),
}));

vi.mock('@/store/video', () => ({
  useVideoStore: vi.fn(),
}));

vi.mock('@/store/video/slices/generationTopic/selectors', () => ({
  generationTopicSelectors: {
    generationTopics: vi.fn(),
  },
}));

describe('VideoLayout', () => {
  it('uses the generation sidebar nav key shared with image', () => {
    render(<VideoLayout />);

    expect(generationLayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'video',
        navKey: 'image',
        viewModeStatusKey: 'videoTopicViewMode',
      }),
    );
  });
});
