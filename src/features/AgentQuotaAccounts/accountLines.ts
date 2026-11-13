import { type QuotaAccount } from '@/store/agentQuota';

/**
 * What an account card shows: its name (the label, else the sign-in email, else the provider's
 * id) and, only when the name is something else, the email as a second line.
 */
export const accountLines = (
  a: Pick<QuotaAccount, 'email' | 'externalAccountId' | 'id' | 'label'>,
): { email?: string; name: string } => {
  const name = a.label || a.email || a.externalAccountId || a.id;
  return { email: a.email && a.email !== name ? a.email : undefined, name };
};
