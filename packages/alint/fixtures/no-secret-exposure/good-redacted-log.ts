export const configureProvider = (input: { apiKey: string }) => {
  console.info('Provider configuration', {
    hasApiKey: Boolean(input.apiKey),
    apiKey: '[REDACTED]',
  });
};
