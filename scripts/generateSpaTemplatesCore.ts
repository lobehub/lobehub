/**
 * Vite production builds rewrite absolute `/icons/...` URLs with `base` (`/_spa/`
 * or `/_spa-auth/`). The splash logo and PWA icons already live at root
 * `/icons/...` (see BRANDING_LOGO_URL / public/icons), so map them back before
 * embedding the HTML into Next templates.
 */
export const normalizeSpaHtmlPublicPaths = (html: string) =>
  html.replaceAll('/_spa/icons/', '/icons/').replaceAll('/_spa-auth/icons/', '/icons/');
