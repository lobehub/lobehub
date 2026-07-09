/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Render from './index';

// `enableMessageLinkIcon` is read via useUserStore(selector). We drive the
// selector's return value through this module-level flag so each case can flip
// the "Link Icon" setting on/off without a real store.
let mockShowIcon = true;

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector(undefined),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    enableMessageLinkIcon: () => mockShowIcon,
  },
}));

const renderLink = (properties: Record<string, unknown>) =>
  render(
    <Render id="msg-1" node={{ properties }} tagName="lobeLink" type="element">
      {null}
    </Render>,
  );

afterEach(() => {
  mockShowIcon = true;
});

describe('Link Render — message link icon toggle', () => {
  describe('when enableMessageLinkIcon is ON (default)', () => {
    it('renders a generic link with a leading favicon icon', () => {
      mockShowIcon = true;
      const { container } = renderLink({
        linkDomain: 'thecoffee.club',
        linkHref: 'https://thecoffee.club',
        linkKind: 'generic',
        linkLabel: 'https://thecoffee.club',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor).toBeTruthy();
      expect(anchor.getAttribute('href')).toBe('https://thecoffee.club');
      // icon span + favicon <img> present before the label
      expect(anchor.querySelector('span')).toBeTruthy();
      expect(anchor.querySelector('img')).toBeTruthy();
      expect(anchor.textContent).toContain('https://thecoffee.club');
    });

    it('renders a github link with an icon (svg)', () => {
      mockShowIcon = true;
      const { container } = renderLink({
        linkHref: 'https://github.com/lobehub/lobehub',
        linkKind: 'github',
        linkLabel: 'lobehub/lobehub',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor.querySelector('span')).toBeTruthy();
      expect(anchor.querySelector('svg')).toBeTruthy();
    });
  });

  describe('when enableMessageLinkIcon is OFF', () => {
    it('renders a generic link as a plain anchor with NO icon', () => {
      mockShowIcon = false;
      const { container } = renderLink({
        linkDomain: 'thecoffee.club',
        linkHref: 'https://thecoffee.club',
        linkKind: 'generic',
        linkLabel: 'https://thecoffee.club',
      });
      const anchor = container.querySelector('a')!;
      expect(anchor).toBeTruthy();
      expect(anchor.getAttribute('href')).toBe('https://thecoffee.club');
      // no icon span, no favicon img — copies cleanly into email/other apps
      expect(anchor.querySelector('span')).toBeNull();
      expect(anchor.querySelector('img')).toBeNull();
      expect(anchor.textContent).toBe('https://thecoffee.club');
    });

    it('drops the icon for every link kind (github / linear / email)', () => {
      mockShowIcon = false;
      for (const properties of [
        {
          linkHref: 'https://github.com/lobehub/lobehub',
          linkKind: 'github',
          linkLabel: 'lobehub/lobehub',
        },
        { linkHref: 'https://linear.app/x/issue/ABC-1', linkKind: 'linear', linkLabel: 'ABC-1' },
        { linkHref: 'mailto:a@b.com', linkKind: 'email', linkLabel: 'a@b.com' },
      ]) {
        const { container } = renderLink(properties);
        const anchor = container.querySelector('a')!;
        expect(anchor.querySelector('span')).toBeNull();
        expect(anchor.querySelector('svg')).toBeNull();
        expect(anchor.querySelector('img')).toBeNull();
      }
    });
  });
});
