export const downloadCover = async (input: { url: string }) => {
  const target = new URL(input.url);
  if (target.protocol !== 'https:') throw new Error('HTTPS required');
  // alint-expect
  return fetch(target);
};
