import { Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { contactService } from '@/services/contact';

import { receiptErrorKey } from './MessageReceipts';
import type { ContactRequestOutcome } from './shareRefusal';
import { contactRequestOutcome } from './shareRefusal';
import { statusStyles, toneStyles } from './styles';

const styles = stylex.create({
  // A long reason and the action wrap onto their own lines in a narrow conversation.
  wrap: { flexWrap: 'wrap' },
});

const OUTCOME_KEYS = {
  added: 'shareRefusal.added',
  alreadyContact: 'shareRefusal.alreadyContact',
  requestSent: 'shareRefusal.requestSent',
} as const satisfies Record<ContactRequestOutcome, string>;

/**
 * Below a visitor's message whose reply a shared Agent's limit refused: why, and the creator to
 * ask for more as a contact when the limit is theirs. There is no retry; the limit still holds.
 */
export function ShareRefusalNotice({
  errorType,
  ownerId,
}: {
  errorType: string;
  ownerId?: string;
}) {
  const { t } = useTranslation('channel');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ContactRequestOutcome>();
  const [error, setError] = useState<unknown>();
  const reasonKey = receiptErrorKey(errorType);

  const addOwner = async (userId: string) => {
    setSending(true);
    setError(undefined);
    try {
      setOutcome(contactRequestOutcome({ result: await contactService.sendRequest(userId) }));
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
    <span {...stylex.props(statusStyles.receipts, statusStyles.state, styles.wrap)}>
      <span {...stylex.props(statusStyles.state, toneStyles.error)}>
        <Icon icon={CircleAlert} size={12} />
        {reasonKey ? t(reasonKey) : t('receipt.errorUnavailable')}
      </span>
      {ownerId &&
        (outcome ? (
          <span {...stylex.props(toneStyles.done)}>{t(OUTCOME_KEYS[outcome])}</span>
        ) : (
          <Button
            icon={UserPlus}
            loading={sending}
            size="small"
            type="text"
            onClick={() => void addOwner(ownerId)}
          >
            {t('shareRefusal.addOwner')}
          </Button>
        ))}
      {error !== undefined && <AsyncError error={error} variant="inline" />}
    </span>
  );
}
