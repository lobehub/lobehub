export const logIdentity = (claims: { aud: string; client_id: string; sub: string }) => {
  console.info('Verified identity', claims);
};
