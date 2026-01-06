export const getFileBasename = (filename: string): string => {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex <= 0) return filename;
  return filename.slice(0, lastDotIndex);
};

export const getHarmoniousSize = (
  inputWidth: number,
  inputHeight: number,
  {
    spacing = 24,
    containerWidth,
    containerHeight,
  }: { containerHeight: number; containerWidth: number; spacing: number },
) => {
  let width = String(inputWidth);
  let height = String(inputHeight);

  const maxWidth = containerWidth - spacing;
  const maxHeight = containerHeight - spacing;

  if (inputHeight >= inputWidth && inputHeight >= maxHeight) {
    height = maxHeight + 'px';
    width = 'auto';
  } else if (inputWidth >= inputHeight && inputWidth >= maxWidth) {
    height = 'auto';
    width = maxWidth + 'px';
  } else {
    width = width + 'px';
    height = height + 'px';
  }

  return { height, width };
};
