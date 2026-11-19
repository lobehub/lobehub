import type * as BusinessConst from '@lobechat/business-const';
import { ModalHost, MotionProvider } from '@lobehub/ui';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { motion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import About from './About';

// Hoisted with the mocks below: the brand name is read while modules import, before this file's body runs.
const branding = vi.hoisted(() => ({ name: 'TITU Work' }));

// Partial mock so only the brand name is steered; the rest of the branding surface stays real.
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessConst>()),
  get BRANDING_NAME() {
    return branding.name;
  },
}));

vi.mock('./Version', () => ({ default: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${options.name} · ${key}` : key,
  }),
}));

const renderAbout = () =>
  render(
    <MotionProvider motion={motion}>
      <About />
      <ModalHost />
    </MotionProvider>,
  );

describe('About open-source notice entry', () => {
  beforeEach(() => {
    branding.name = 'TITU Work';
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the notice dialog from the legal section under the TITU Work brand', async () => {
    renderAbout();

    fireEvent.click(screen.getByRole('button', { name: 'openSourceNotice.title' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('link', { name: 'Electron · openSourceNotice.viewLicenseAria' }),
    ).toBeInTheDocument();
  });

  it('is not shown for other brandings', () => {
    branding.name = 'LobeHub';
    renderAbout();

    expect(
      screen.queryByRole('button', { name: 'openSourceNotice.title' }),
    ).not.toBeInTheDocument();
  });
});
