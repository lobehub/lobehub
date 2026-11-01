'use client';

import { Button, Flexbox, useModalContext } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import IdentityFields from './IdentityFields';
import { useAgentIdentityForm } from './useAgentIdentityForm';

interface AgentIdentityContentProps {
  agentId: string;
}

/**
 * The identity fields as a real form. They used to be inline inputs in the
 * profile header, which crowded it and left no room for a per-field label or
 * error. All behaviour lives in {@link useAgentIdentityForm}.
 */
const AgentIdentityContent = memo<AgentIdentityContentProps>(({ agentId }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const form = useAgentIdentityForm({ agentId, onSaved: close });

  return (
    <Flexbox gap={20} padding={20}>
      <IdentityFields agentId={agentId} form={form} />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={form.saving} onClick={() => close()}>
          {t('cancel')}
        </Button>
        <Button
          disabled={form.saving}
          loading={form.saving}
          type={'primary'}
          onClick={() => {
            void form.save();
          }}
        >
          {t('save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentIdentityContent;
