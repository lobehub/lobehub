import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NativeUIRenderer } from '../../native/renderer';
import { NATIVE_UI_LIMITS } from '../../native/schema';
import type { NativeUIDocument } from '../../native/types';
import { useInteractiveUIFollowUp } from '../hooks/useInteractiveUIFollowUp';
import { useNativeUIState } from '../hooks/useNativeUIState';
import { type FollowUpProposal, FollowUpReview } from './FollowUpReview';

export const NativeWidget = ({
  document,
  messageId,
  saved,
  readOnly,
}: {
  document: NativeUIDocument;
  messageId: string;
  readOnly: boolean;
  saved: unknown;
}) => {
  const { t } = useTranslation('plugin');
  const { retrySave, saveStatus, update, values, writable } = useNativeUIState(
    document,
    saved,
    messageId,
    readOnly,
  );
  const followUp = useInteractiveUIFollowUp(messageId, document.title, readOnly);
  const [proposal, setProposal] = useState<FollowUpProposal>();
  const hasProposal = useRef(false);

  return (
    <Flexbox gap={12} style={{ minWidth: 0, width: '100%' }}>
      <NativeUIRenderer
        disabled={!writable}
        document={document}
        readOnly={readOnly}
        state={values}
        onStateChange={update}
        onPropose={(text) => {
          if (
            !writable ||
            hasProposal.current ||
            !text.trim() ||
            text.length > NATIVE_UI_LIMITS.text
          )
            return;
          hasProposal.current = true;
          setProposal({ requestId: crypto.randomUUID(), text });
        }}
      />
      {(saveStatus === 'saving' || saveStatus === 'saved') && (
        <Text fontSize={12} role="status" type="secondary">
          {t(
            saveStatus === 'saving'
              ? 'builtins.lobe-interactive-ui.state.saving'
              : 'builtins.lobe-interactive-ui.state.saved',
          )}
        </Text>
      )}
      {saveStatus === 'failed' && (
        <Flexbox align="flex-start" gap={8}>
          <Alert title={t('builtins.lobe-interactive-ui.state.failed')} type="warning" />
          <Button disabled={!writable} onClick={retrySave}>
            {t('builtins.lobe-interactive-ui.state.retry')}
          </Button>
        </Flexbox>
      )}
      {proposal && (
        <FollowUpReview
          followUp={followUp}
          proposal={proposal}
          onChange={setProposal}
          onDismiss={() => {
            hasProposal.current = false;
            setProposal(undefined);
          }}
        />
      )}
    </Flexbox>
  );
};
