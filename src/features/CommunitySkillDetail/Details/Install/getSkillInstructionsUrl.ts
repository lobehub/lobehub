export const getSkillInstructionsUrl = (identifier: string) => {
  // Installation links are opt-in and independent of the Market API used by SaaS.
  const marketBaseUrl = window.__SERVER_CONFIG__?.clientEnv?.marketSkillInstallBaseUrl;
  const id = encodeURIComponent(identifier);

  return marketBaseUrl
    ? `${marketBaseUrl.replace(/\/+$/, '')}/s/skills/${id}`
    : `https://lobehub.com/skills/${id}/skill.md`;
};
