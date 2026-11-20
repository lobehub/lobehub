import { decodeJwt } from 'jose';

import { deleteAccount } from './accounts';

export const removeAccount = async (input: { token: string }) => {
  const claims = decodeJwt(input.token);
  // alint-expect
  return deleteAccount(claims.sub!);
};
