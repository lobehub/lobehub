export const isTagClosed = (tag: string, input: string = '') => {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  return input.includes(openTag) && input.includes(closeTag);
};
