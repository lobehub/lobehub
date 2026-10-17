import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text, TextArea } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import type { useInteractiveUIFollowUp } from '../hooks/useInteractiveUIFollowUp';
import { getFollowUpDraftValidation, MAX_FOLLOW_UP_LENGTH } from '../submission';

export interface FollowUpProposal {
  requestId: string;
  text: string;
}

/** This review and Send button are trusted host controls, never model markup. */
export const FollowUpReview = ({
  followUp,
  proposal,
  onChange,
  onDismiss,
}: {
  followUp: ReturnType<typeof useInteractiveUIFollowUp>;
  onChange: (proposal: FollowUpProposal) => void;
  onDismiss: () => void;
  proposal: FollowUpProposal;
}) => {
  const { t } = useTranslation('plugin');
  const { allowed, dismiss, pending, status, submit } = followUp;
  const validation = getFollowUpDraftValidation(proposal.text);
  return (
    <Flexbox gap={8}>
      <Text>{t('builtins.lobe-interactive-ui.review')}</Text>
      <TextArea
        aria-label={t('builtins.lobe-interactive-ui.review')}
        disabled={status !== 'idle'}
        maxLength={MAX_FOLLOW_UP_LENGTH}
        value={proposal.text}
        onChange={(event) => onChange({ ...proposal, text: event.target.value })}
      />
      {validation.tooLong && (
        <Text role="alert" type="secondary">
          {t('builtins.lobe-interactive-ui.tooLong', {
            count: proposal.text.length,
            limit: MAX_FOLLOW_UP_LENGTH,
          })}
        </Text>
      )}
      <Flexbox horizontal gap={8} wrap="wrap">
        <Button
          disabled={!allowed || !validation.canSend || status !== 'idle'}
          loading={status === 'sending'}
          type="primary"
          onClick={(event) => {
            void submit(proposal.requestId, proposal.text, event.isTrusted);
          }}
        >
          {t('builtins.lobe-interactive-ui.send')}
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            if (dismiss()) onDismiss();
          }}
        >
          {t('builtins.lobe-interactive-ui.dismiss')}
        </Button>
      </Flexbox>
      {!allowed && status === 'idle' && (
        <Text fontSize={12} type="secondary">
          {t('builtins.lobe-interactive-ui.readOnly')}
        </Text>
      )}
      {status === 'sent' && <Text role="status">{t('builtins.lobe-interactive-ui.sent')}</Text>}
      {status === 'uncertain' && (
        <Alert title={t('builtins.lobe-interactive-ui.uncertain')} type="warning" />
      )}
    </Flexbox>
  );
};
