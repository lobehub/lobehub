import type { ExternalAccountJSON, UserJSON } from '@clerk/backend';

export type ClerkToBetterAuthMode = 'test' | 'prod';
export type DatabaseDriver = 'neon' | 'node';

export type CSVUserRow = {
  first_name: string;
  id: string;
  last_name: string;
  password_digest: string;
  password_hasher: string;
  primary_email_address: string;
  primary_phone_number: string;
  totp_secret: string;
  unverified_email_addresses: string;
  unverified_phone_numbers: string;
  username: string;
  verified_email_addresses: string;
  verified_phone_numbers: string;
};

export type ClerkExternalAccount = Pick<
  ExternalAccountJSON,
  'id' | 'provider' | 'provider_user_id' | 'approved_scopes'
> & {
  created_at?: number;
  updated_at?: number;
  verificationStatus?: boolean;
};

export type ClerkUser = Pick<
  UserJSON,
  | 'id'
  | 'image_url'
  | 'created_at'
  | 'updated_at'
  | 'password_last_updated_at'
  | 'password_enabled'
  | 'banned'
  | 'two_factor_enabled'
  | 'lockout_expires_in_seconds'
> & {
  external_accounts: ClerkExternalAccount[];
  primaryEmail?: string;
};
