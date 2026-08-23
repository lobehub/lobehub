export const ACCEPTANCE_EMBED_PATH = '/lobe-editor-acceptance-embed.html';

export interface AcceptanceEmbedLocation {
  origin: string;
}

export const isPageAcceptanceEmbedEnabled = (
  value = process.env.NEXT_PUBLIC_PAGE_EDITOR_ACCEPTANCE_EMBED,
): boolean => value === '1' || value === 'true';

export const matchesPageAcceptanceEmbed = (
  rawUrl: string,
  location: AcceptanceEmbedLocation | undefined,
  enabled: boolean,
): boolean => {
  if (!enabled || !location?.origin) return false;

  try {
    const target = new URL(rawUrl, location.origin);
    return target.origin === location.origin && target.pathname === ACCEPTANCE_EMBED_PATH;
  } catch {
    return false;
  }
};
