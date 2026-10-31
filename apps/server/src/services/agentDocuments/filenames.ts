export const MAX_UNIQUE_FILENAME_ATTEMPTS = 1000;

/** `notes.md` + 2 → `notes-2.md`. */
export const appendFilenameSuffix = (filename: string, suffix: number): string => {
  const dotIndex = filename.lastIndexOf('.');

  if (dotIndex <= 0) return `${filename}-${suffix}`;

  return `${filename.slice(0, dotIndex)}-${suffix}${filename.slice(dotIndex)}`;
};

/** `notes.md` + 2 → `notes 2.md`. */
export const appendSpacedFilenameSuffix = (filename: string, suffix: number): string => {
  const dotIndex = filename.lastIndexOf('.');

  if (dotIndex <= 0) return `${filename} ${suffix}`;

  return `${filename.slice(0, dotIndex)} ${suffix}${filename.slice(dotIndex)}`;
};
