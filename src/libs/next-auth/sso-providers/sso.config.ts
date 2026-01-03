import { type OAuth2Config } from '@auth/core/providers';
import type { Profile } from 'next-auth';

export const CommonProviderConfig = {
  // Auth.js does not allow email account linking by default cause it's dangerous
  // ref: https://authjs.dev/reference/core/providers#allowdangerousemailaccountlinking
  allowDangerousEmailAccountLinking: true,
} satisfies Partial<OAuth2Config<Profile>>;
