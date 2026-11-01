import type { ReactNode } from 'react';

export const ShareTab = {
  JSON: 'json',
  PDF: 'pdf',
  Screenshot: 'screenshot',
  Text: 'text',
} as const;

export type ShareTab = (typeof ShareTab)[keyof typeof ShareTab];

interface ShareTabRenderOptions {
  mobile: boolean;
}

export type ShareTabRenderer = (options: ShareTabRenderOptions) => ReactNode;

const rendererLoaders: Record<ShareTab, () => Promise<ShareTabRenderer>> = {
  [ShareTab.JSON]: async () => {
    const { default: ShareJSON } = await import('./ShareJSON');
    return () => <ShareJSON />;
  },
  [ShareTab.PDF]: async () => {
    const { default: SharePdf } = await import('./SharePdf');
    return () => <SharePdf />;
  },
  [ShareTab.Screenshot]: async () => {
    const { default: ShareImage } = await import('./ShareImage');
    return ({ mobile }) => <ShareImage mobile={mobile} />;
  },
  [ShareTab.Text]: async () => {
    const { default: ShareText } = await import('./ShareText');
    return () => <ShareText />;
  },
};

const rendererPromises = new Map<ShareTab, Promise<ShareTabRenderer>>();

export const loadShareTabRenderer = (tab: ShareTab): Promise<ShareTabRenderer> => {
  const cached = rendererPromises.get(tab);
  if (cached) return cached;

  const promise = rendererLoaders[tab]().catch((error) => {
    rendererPromises.delete(tab);
    throw error;
  });
  rendererPromises.set(tab, promise);

  return promise;
};
