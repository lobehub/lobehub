const hasControlCharacter = (value: string) => [...value].some((char) => char.codePointAt(0)! < 32);

/** Canonical collection identity. Credentials and query strings never belong in persisted URLs. */
export const normalizeTfsCollection = (value: string): string => {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes('//')
  )
    throw new Error('Invalid TFS collection URL');
  return url.href.replace(/\/$/, '');
};

export const parseTfsRepository = (value: string, collection?: string) => {
  try {
    const raw = value.trim();
    if (/(?:^|\/)\.{1,2}(?:\/|$)|%2e|%2f|%5c/i.test(raw)) return null;
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^(.*)\/([^/]+)\/_git\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const [, prefix, rawProject, rawRepository] = match;
    const project = decodeURIComponent(rawProject);
    const name = decodeURIComponent(rawRepository);
    if (
      [project, name].some(
        (segment) =>
          !segment ||
          segment.includes('\\') ||
          segment.includes('/') ||
          hasControlCharacter(segment) ||
          ['.', '..'].includes(segment),
      )
    )
      return null;
    const collectionUrl = normalizeTfsCollection(`${url.origin}${prefix}`);
    if (collection && collectionUrl !== normalizeTfsCollection(collection)) return null;
    return {
      collectionUrl,
      fullName: `${project}/${name}`,
      name,
      project,
      url: `${collectionUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}`,
    };
  } catch {
    return null;
  }
};

export const shortTfsBranch = (ref?: string | null) =>
  ref?.replace(/^refs\/heads\//, '') || undefined;
