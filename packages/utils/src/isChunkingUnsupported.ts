export const isChunkingUnsupported = (fileType: string): boolean => {
  if (fileType.startsWith('image')) return true;
  if (fileType.startsWith('video')) return true;
  if (fileType.startsWith('audio')) return true;
  return false; // false doesn't mean supported, it means we don't know
};
