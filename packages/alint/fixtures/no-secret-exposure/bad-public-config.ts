export const browserBootstrap = () => {
  // alint-expect
  return Response.json({ apiKey: process.env.PROVIDER_API_KEY });
};
