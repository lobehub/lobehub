import type { AgentAccountKind } from '@lobechat/types';
import type { LucideIcon } from 'lucide-react';
import { KeyRound, Mail, Wallet } from 'lucide-react';

/**
 * One address channel the identity tab can open.
 *
 * The pair (kind, provider) is what the control plane is asked for; the icon
 * and copy are presentation. `prefixable` marks the channels where the caller
 * may ask for a specific handle (a mailbox local part, for example); a channel
 * whose handles the provider mints on its own leaves it off.
 */
export interface IdentityChannel {
  descKey: 'identity.mail.desc';
  icon: LucideIcon;
  kind: AgentAccountKind;
  prefixable: boolean;
  provider: string;
  titleKey: 'identity.mail.title';
}

export const IDENTITY_CHANNELS: IdentityChannel[] = [
  {
    descKey: 'identity.mail.desc',
    icon: Mail,
    kind: 'mail',
    prefixable: true,
    provider: 'agent-mail',
    titleKey: 'identity.mail.title',
  },
];

/**
 * Whether an account belongs to a channel. A channel is the (kind, provider)
 * pair, so a mailbox mounted through another provider (say `user`) is not the
 * Agent Mail channel and must not hide its provisioning card.
 */
export const isChannelAccount = (
  account: { kind: AgentAccountKind; provider: string },
  channel: Pick<IdentityChannel, 'kind' | 'provider'>,
): boolean => account.kind === channel.kind && account.provider === channel.provider;

/** Icon for an account that belongs to no built-in channel (a mounted address). */
export const KIND_ICONS: Record<AgentAccountKind, LucideIcon> = {
  mail: Mail,
  service: KeyRound,
  wallet: Wallet,
};

/** Accounts no built-in channel claims — mounted ones, or providers this tab does not offer. */
export const isUnchanneledAccount = (account: {
  kind: AgentAccountKind;
  provider: string;
}): boolean => !IDENTITY_CHANNELS.some((channel) => isChannelAccount(account, channel));
