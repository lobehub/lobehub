export const getSkillInstructionsUrl = (identifier: string) => {
  // MARKET_BASE_URL is injected at runtime so self-hosted images need no rebuild.
  const marketBaseUrl =
    window.__SERVER_CONFIG__?.clientEnv?.marketBaseUrl || process.env.NEXT_PUBLIC_MARKET_BASE_URL;
  const id = encodeURIComponent(identifier);

  return marketBaseUrl
    ? `${marketBaseUrl.replace(/\/+$/, '')}/s/skills/${id}`
    : `https://lobehub.com/skills/${id}/skill.md`;
};
