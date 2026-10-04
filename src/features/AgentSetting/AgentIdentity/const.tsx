import type { AgentAccountKind } from '@lobechat/types';
import type { LucideIcon } from 'lucide-react';
import { Mail, Phone } from 'lucide-react';

/**
 * One address channel the identity tab can open.
 *
 * `providers` lists who can issue it, in preference order; the tab opens it
 * through the first one this deployment configured. `prefixable` marks the
 * channels where the caller may state a preference — a mailbox local part, or
 * the area code of a dedicated number.
 */
export interface IdentityChannel {
  descKey: 'identity.mail.desc' | 'identity.phone.desc';
  icon: LucideIcon;
  kind: AgentAccountKind;
  /** Extra line under the description (what the channel costs / can do). */
  noteKey?: 'identity.phone.note';
  prefixable: boolean;
  prefixHintKey: 'identity.prefix.hint' | 'identity.phone.areaCode.hint';
  prefixPlaceholderKey: 'identity.prefix.placeholder' | 'identity.phone.areaCode.placeholder';
  providers: string[];
  titleKey: 'identity.mail.title' | 'identity.phone.title';
}

export const IDENTITY_CHANNELS: IdentityChannel[] = [
  {
    descKey: 'identity.mail.desc',
    icon: Mail,
    kind: 'mail',
    prefixHintKey: 'identity.prefix.hint',
    prefixPlaceholderKey: 'identity.prefix.placeholder',
    prefixable: true,
    providers: ['agent-mail'],
    titleKey: 'identity.mail.title',
  },
  {
    descKey: 'identity.phone.desc',
    icon: Phone,
    kind: 'phone',
    noteKey: 'identity.phone.note',
    prefixHintKey: 'identity.phone.areaCode.hint',
    prefixPlaceholderKey: 'identity.phone.areaCode.placeholder',
    prefixable: true,
    // Dedicated, paid numbers: Twilio first, Telnyx as the second carrier.
    providers: ['twilio', 'telnyx'],
    titleKey: 'identity.phone.title',
  },
];

/** The provider this deployment opens a channel through, if any. */
export const resolveChannelProvider = (
  channel: IdentityChannel,
  available: string[],
): string | undefined => channel.providers.find((provider) => available.includes(provider));
