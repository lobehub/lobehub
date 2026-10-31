export const externalLinkHref = (href: string | null | undefined): string | null => {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  return href;
};

export const truncateUrl = (url: string, max = 100): string => {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 31)}…${url.slice(-30)}`;
};
