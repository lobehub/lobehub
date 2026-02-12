import { type MetadataRoute } from 'next';

const manifest = async (): Promise<MetadataRoute.Manifest> => {
  // Skip heavy module compilation in development
  if (process.env.NODE_ENV === 'development') {
    return {
      background_color: '#000000',
      description: 'LobeHub Development',
      display: 'standalone',
      icons: [
        {
          sizes: '192x192',
          src: '/icons/icon-192x192.png',
          type: 'image/png',
        },
      ],
      name: 'LobeHub',
      short_name: 'LobeHub',
      start_url: '/',
      theme_color: '#000000',
    };
  }

  const [{ BRANDING_LOGO_URL, BRANDING_NAME }, { kebabCase }, { manifestModule }] =
    await Promise.all([
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
        url: '/icons/icon-192x192.png',
      },
      {
        purpose: 'maskable',
        sizes: '192x192',
        url: '/icons/icon-192x192.maskable.png',
      },
      {
        purpose: 'any',
        sizes: '512x512',
        url: '/icons/icon-512x512.png',
      },
      {
        purpose: 'maskable',
        sizes: '512x512',
        url: '/icons/icon-512x512.maskable.png',
      },
    ],
    id: kebabCase(BRANDING_NAME),
    name: BRANDING_NAME,
    screenshots: BRANDING_LOGO_URL
      ? []
      : [
          {
            form_factor: 'narrow',
            url: '/screenshots/shot-1.mobile.png',
          },
          {
            form_factor: 'narrow',
            url: '/screenshots/shot-2.mobile.png',
          },
          {
            form_factor: 'narrow',
            url: '/screenshots/shot-3.mobile.png',
          },
          {
            form_factor: 'narrow',
            url: '/screenshots/shot-4.mobile.png',
          },
          {
            form_factor: 'narrow',
            url: '/screenshots/shot-5.mobile.png',
          },
          {
            form_factor: 'wide',
            url: '/screenshots/shot-1.desktop.png',
          },
          {
            form_factor: 'wide',
            url: '/screenshots/shot-2.desktop.png',
          },
          {
            form_factor: 'wide',
            url: '/screenshots/shot-3.desktop.png',
          },
          {
            form_factor: 'wide',
            url: '/screenshots/shot-4.desktop.png',
          },
          {
            form_factor: 'wide',
            url: '/screenshots/shot-5.desktop.png',
          },
        ],
  });
};

export default manifest;
