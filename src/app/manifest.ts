import { type MetadataRoute } from 'next';

import { appEnv } from '@/envs/app';

const DEFAULT_APP_ICON_192 = '/icons/icon-bot-192.png';
const DEFAULT_APP_ICON_512 = '/icons/icon-bot-512.png';

const appIcon192 = appEnv.BRANDING_APP_ICON_192_URL || DEFAULT_APP_ICON_192;
const appIcon512 = appEnv.BRANDING_APP_ICON_512_URL || DEFAULT_APP_ICON_512;

const manifest = async (): Promise<MetadataRoute.Manifest> => {
  // Skip heavy module compilation in development
  if (process.env.NODE_ENV === 'development') {
    return {
      background_color: '#000000',
      description: 'Project-M Development',
      display: 'standalone',
      icons: [
        {
          sizes: '192x192',
          src: appIcon192,
          type: 'image/png',
        },
      ],
      name: 'Project-M',
      short_name: 'Project-M',
      start_url: '/',
      theme_color: '#000000',
    };
  }

  const [{ BRANDING_NAME }, { kebabCase }, { manifestModule }] = await Promise.all([
    import('@lobechat/business-const'),
    import('es-toolkit/compat'),
    import('@/server/manifest'),
  ]);

  // @ts-expect-error - manifestModule.generate returns extended manifest with custom properties
  return manifestModule.generate({
    description: `${BRANDING_NAME} is a work-and-lifestyle space to find, build, and collaborate with agent teams that grow with you.`,
    icons: [
      {
        purpose: 'any',
        sizes: '192x192',
        url: appIcon192,
      },
      {
        purpose: 'maskable',
        sizes: '192x192',
        url: appIcon192,
      },
      {
        purpose: 'any',
        sizes: '512x512',
        url: appIcon512,
      },
      {
        purpose: 'maskable',
        sizes: '512x512',
        url: appIcon512,
      },
    ],
    id: kebabCase(BRANDING_NAME),
    name: BRANDING_NAME,
    screenshots: [],
  });
};

export default manifest;
