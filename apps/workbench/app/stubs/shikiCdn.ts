export const shikiCdnUrl = (source: string, version: string): string | undefined => {
  if (source === 'shiki') return `https://esm.sh/shiki@${version}`;
  if (source.startsWith('shiki/')) return `https://esm.sh/shiki@${version}/${source.slice(6)}`;
  if (!source.startsWith('@shikijs/')) return;
  const rest = source.slice('@shikijs/'.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return `https://esm.sh/@shikijs/${rest}@${version}`;
  return `https://esm.sh/@shikijs/${rest.slice(0, slash)}@${version}${rest.slice(slash)}`;
};
