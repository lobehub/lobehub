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

// Clerk API response types (no SDK dependency)
export interface ClerkApiExternalAccount {
  approved_scopes: string;
  created_at?: number;
  id: string;
  provider: string;
  provider_user_id: string;
  updated_at?: number;
  verification?: { status: string };
}

export interface ClerkApiEmailAddress {
  email_address: string;
  id: string;
}

export interface ClerkApiUser {
  banned: boolean;
  created_at: number;
  email_addresses?: ClerkApiEmailAddress[];
  external_accounts?: ClerkApiExternalAccount[];
  id: string;
  image_url: string;
  lockout_expires_in_seconds: number | null;
  password_enabled: boolean;
  password_last_updated_at: number | null;
  primary_email_address_id: string | null;
  two_factor_enabled: boolean;
  updated_at: number;
}

export interface ClerkApiUserListResponse {
  data: ClerkApiUser[];
  total_count: number;
}

export interface ClerkExternalAccount {
  approved_scopes: string;
  created_at?: number;
  id: string;
  provider: string;
  provider_user_id: string;
  updated_at?: number;
  verificationStatus?: boolean;
}

export interface ClerkUser {
  banned: boolean;
  created_at: number;
  external_accounts: ClerkExternalAccount[];
  id: string;
  image_url: string;
  lockout_expires_in_seconds: number | null;
  password_enabled: boolean;
  password_last_updated_at: number | null;
  primaryEmail?: string;
  two_factor_enabled: boolean;
  updated_at: number;
}
