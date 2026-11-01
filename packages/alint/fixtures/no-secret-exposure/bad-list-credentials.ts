import { credentialVault } from './vault';

export const listChannels = async () => {
  const credentials = await credentialVault.decryptAll();
  // alint-expect
  return Response.json({
    channels: credentials.map((row) => ({ id: row.id, botToken: row.botToken })),
  });
};
