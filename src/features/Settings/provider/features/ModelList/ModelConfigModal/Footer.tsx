'use client';

import { Button, Flexbox, ModalFooter, useModalContext } from '@lobehub/ui';
import { type FormInstance } from '@lobehub/ui/form';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import { useAiInfraStore } from '@/store/aiInfra';

import { pickModelConfigFormValues } from './utils';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
  showDeployName?: boolean;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(({ formRef, id, showDeployName }) => {
  const { t } = useTranslation(['common', 'error']);
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  /** Save failure, shown above the footer buttons: the modal stays open with the edited form. */
  const [error, setError] = useState<InlineErrorState | null>(null);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);

  return (
    <Flexbox gap={8}>
      {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          loading={loading}
          type="primary"
          onClick={async () => {
            const form = formRef.current;
            if (!editingProvider || !id || !form) return;
            const data = pickModelConfigFormValues(form.getValues(), { showDeployName });

            setError(null);
            setLoading(true);
            try {
              await updateAiModelsConfig(id, editingProvider, data);
              close();
            } catch (err) {
              console.error(err);
              setError(toInlineError(t('saveState.saveFailed', { ns: 'error' }), err));
            } finally {
              setLoading(false);
            }
          }}
        >
          {t('ok', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </Flexbox>
  );
});

export default ModelConfigFooter;
