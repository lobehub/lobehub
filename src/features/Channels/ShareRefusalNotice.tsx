import type { ContactUserProfile } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';
import { contactService } from '@/services/contact';

import { receiptErrorKey } from './MessageReceipts';
import type { ContactRequestOutcome } from './shareRefusal';
import { contactRequestOutcome } from './shareRefusal';
import { statusStyles, toneStyles } from './styles';

const styles = stylex.create({
  card: {
    width: 320,
    maxWidth: '100%',
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    backgroundColor: cssVar.colorBgContainer,
  },
  identity: { flex: '1', minWidth: 0 },
  name: { fontWeight: 500 },
});

const OUTCOME_KEYS = {
  added: 'shareRefusal.added',
  alreadyContact: 'shareRefusal.alreadyContact',
  requestSent: 'shareRefusal.requestSent',
} as const satisfies Record<ContactRequestOutcome, string>;

/** The shared Agent's creator as a contact card the visitor can add, to ask them for more. */
function OwnerContactCard({ owner }: { owner: ContactUserProfile }) {
  const { t } = useTranslation('channel');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ContactRequestOutcome>();
  const [error, setError] = useState<unknown>();
  const name = owner.fullName || owner.username;

  const addOwner = async () => {
    setSending(true);
    setError(undefined);
    try {
      setOutcome(contactRequestOutcome({ result: await contactService.sendRequest(owner.id) }));
    } catch (cause) {
      const settled = contactRequestOutcome({ error: cause });
      if (settled) setOutcome(settled);
      else {
        console.error('Failed to ask the shared Agent creator to be a contact', cause);
        setError(cause);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Flexbox gap={8} {...stylex.props(styles.card)}>
      <Flexbox horizontal align="center" gap={10}>
        <UserAvatar avatar={owner.avatar} name={name} shape="circle" size={36} />
        <Flexbox {...stylex.props(styles.identity)}>
          <Text ellipsis {...stylex.props(styles.name)}>
            {name}
          </Text>
          <Text ellipsis fontSize={12} type="secondary">
            {owner.username
              ? `${t('shareRefusal.ownerCaption')} · @${owner.username}`
              : t('shareRefusal.ownerCaption')}
          </Text>
        </Flexbox>
        {outcome ? (
          <Text fontSize={12} type="secondary">
            {t(OUTCOME_KEYS[outcome])}
          </Text>
        ) : (
          <Button icon={UserPlus} loading={sending} size="small" onClick={() => void addOwner()}>
            {t('shareRefusal.addOwner')}
          </Button>
        )}
      </Flexbox>
      {error !== undefined && <AsyncError error={error} variant="inline" />}
    </Flexbox>
  );
}

/**
 * Below a visitor's message whose reply a shared Agent's limit refused: why, and the creator's
 * contact card when the limit is theirs to raise. There is no retry; the limit still holds.
 */
export function ShareRefusalNotice({
  errorType,
  owner,
}: {
  errorType: string;
  owner?: ContactUserProfile;
}) {
  const { t } = useTranslation('channel');
  const reasonKey = receiptErrorKey(errorType);

  return (
    <Flexbox gap={6} {...stylex.props(statusStyles.receipts)}>
      <span {...stylex.props(statusStyles.state, toneStyles.error)}>
        <Icon icon={CircleAlert} size={12} />
        {reasonKey ? t(reasonKey) : t('receipt.errorUnavailable')}
      </span>
      {owner && <OwnerContactCard owner={owner} />}
    </Flexbox>
  );
}
