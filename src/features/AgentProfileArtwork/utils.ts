const IMAGE_SOURCE_PATTERN = /^(?:https?:\/\/|\/|data:image\/)/i;

export const openFilePicker = (input: HTMLInputElement): void => {
  try {
    input.showPicker();
  } catch {
    input.click();
  }
};

/**
 * Agent `backgroundColor` historically stored CSS colors. It now stores the
 * profile cover image without requiring a database migration. Only image-like
 * sources are accepted, so legacy colors quietly resolve to no cover.
 */
export const resolveAgentBackground = (value?: string | null): string | undefined => {
  const source = value?.trim();

  return source && IMAGE_SOURCE_PATTERN.test(source) ? source : undefined;
};
