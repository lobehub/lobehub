export const getFileExtension = (filename: string): string => {
  const base = filename.split('/').at(-1) ?? filename;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx < 0) return '';
  return base.slice(dotIdx + 1);
};
