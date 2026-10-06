export const configureProvider = (input: { apiKey: string }) => {
  // alint-expect
  console.info('Provider configuration', { apiKey: input.apiKey });
};
