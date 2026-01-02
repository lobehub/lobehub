import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import qs from 'query-string';

import { getCanonicalUrl } from '@/server/utils/url';

const MAX_AGE = 31_536_000;
const COLOR = '#000000';

interface IconItem {
  purpose: 'any' | 'maskable';
  sizes: string;
  url: string;
  version?: number;
}

interface ScreenshotItem {
  form_factor: 'wide' | 'narrow';
  sizes?: string;
  url: string;
  version?: number;
}

export class Manifest {
  public generate({
    color = COLOR,
    description,
    name,
    id,
    icons,
    screenshots,
  }: {
    color?: string;
    description: string;
    icons: IconItem[];
    id: string;
    name: string;
    screenshots: ScreenshotItem[];
  }) {
    return {
      background_color: color,
      cache_busting_mode: 'all',
      categories: ['productivity', 'design', 'development', 'education'],
      description: description,
      display: 'standalone',
      display_override: ['tabbed'],
      edge_side_panel: {
        preferred_width: 480,
      },
      handle_links: 'auto',
      icons: icons.map((item) => this._getIcon(item)),
      id: id,
      immutable: 'true',
      max_age: MAX_AGE,
      name: name,
      orientation: 'portrait',
      related_applications: [
        {
          platform: 'webapp',
          url: getCanonicalUrl('manifest.webmanifest'),
        },
      ],
      scope: '/',
      screenshots: screenshots.map((item) => this._getScreenshot(item)),
      short_name: name,
      splash_pages: null,
      start_url: '/agent',
      tab_strip: {
        new_tab_button: {
          url: '/agent',
        },
      },
      theme_color: color,
    };
  }

  private _getImage = (url: string, version: number = 1) => ({
    cache_busting_mode: 'query',
    immutable: 'true',
    max_age: MAX_AGE,
    src: qs.stringifyUrl({ query: { v: version }, url: BRANDING_LOGO_URL || url }),
  });

  private _getIcon = ({ url, version, sizes, purpose }: IconItem) => ({
    ...this._getImage(url, version),
    purpose,
    sizes,
    type: 'image/png',
  });

  private _getScreenshot = ({ form_factor, url, version, sizes }: ScreenshotItem) => ({
    ...this._getImage(url, version),
    form_factor,
    sizes: sizes || form_factor === 'wide' ? '1280x676' : '640x1138',
    type: 'image/png',
  });
}

export const manifestModule = new Manifest();
