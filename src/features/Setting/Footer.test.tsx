/**
 * @vitest-environment happy-dom
 */
import { BRANDING_NAME } from '@lobechat/business-const';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Footer from './Footer';

const createGuideModal = vi.hoisted(() => vi.fn());

vi.mock('@/components/GuideModal', () => ({ createGuideModal }));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({
      featureFlags: { hideGitHub: false },
      serverConfig: { enableBusinessFeatures: false },
    }),
}));

// Echo the interpolation options so the test sees which variables reach t()
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

describe('Setting Footer', () => {
  beforeEach(() => {
    createGuideModal.mockClear();
  });

  it('passes the app name to the GitHub star prompt', () => {
    render(<Footer />);
    fireEvent.click(screen.getByLabelText('star'));

    expect(createGuideModal).toHaveBeenCalledTimes(1);
    expect(createGuideModal.mock.calls[0][0].desc).toBe(
      `footer.star.desc ${JSON.stringify({ appName: BRANDING_NAME })}`,
    );
  });

  it('gives the feedback prompt a plain video URL', () => {
    render(<Footer />);
    fireEvent.click(screen.getByLabelText('feedback'));

    expect(createGuideModal).toHaveBeenCalledTimes(1);
    expect(createGuideModal.mock.calls[0][0].cover.props.src).toBe(
      'https://hub-apac-1.lobeobjects.space/assets/feedback.mp4',
    );
  });
});
