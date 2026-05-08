const encodeSegment = (value: string): string => value.replaceAll('/', '／').replaceAll('\\', '＼');

export const buildSegment = (name: string, isFolder: boolean): string => {
  const segment = encodeSegment(name);
  return isFolder ? `${segment}/` : segment;
};

export const extractName = (path: string): string => {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSep = trimmed.lastIndexOf('/');
  const leaf = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
  return leaf.replaceAll('／', '/').replaceAll('＼', '\\');
};
