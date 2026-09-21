import { serializeForHtml } from '@/server/utils/serializeForHtml';

import { SERVER_CONFIG_PLACEHOLDER } from '../app/lib/serverConfig';

export const injectServerConfig = (html: string, serverConfig: unknown) =>
  serverConfig === undefined
    ? html
    : html.replace(
        SERVER_CONFIG_PLACEHOLDER,
        `window.__SERVER_CONFIG__ = ${serializeForHtml(serverConfig)};`,
      );

/**
 * The SPA fallback is prerendered once, in the default locale; the browser reads
 * `<html lang>` to pick its dictionary, so it has to carry the real one.
 */
export const withDocumentLocale = (html: string, locale: string) =>
  html.replace(/<html([^>]*?)\slang="[^"]*"/, `<html$1 lang="${locale}"`);
