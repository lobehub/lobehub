'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useBusinessInputCompletionErrorAlert } from '@/business/client/hooks/useBusinessInputCompletionErrorAlert';
import { selectors, useChatInputStore } from '@/features/ChatInput/store';
import type { InputCompletionError } from '@/features/ChatInput/store/initialState';

export const InputCompletionErrorAlertContent = memo<{
  inputCompletionError: InputCompletionError;
}>(({ inputCompletionError }) => {
  const { t } = useTranslation('chat');
  const clearInputCompletionError = useChatInputStore((state) => state.clearInputCompletionError);
  const dismissInputCompletionError = useChatInputStore(
    (state) => state.dismissInputCompletionError,
  );
  const businessAlert = useBusinessInputCompletionErrorAlert({
    error: inputCompletionError,
    onRetry: clearInputCompletionError,
  });

  const action = businessAlert.action ?? (
    <Flexbox horizontal align={'center'} gap={8}>
      <Button size={'small'} type={'primary'} onClick={clearInputCompletionError}>
        {t('input.inputCompletionError.retry')}
      </Button>
      <Link to={'/settings/agent'}>
        <Button size={'small'}>{t('input.inputCompletionError.settings')}</Button>
      </Link>
    </Flexbox>
  );

  return (
    <>
      <Flexbox paddingBlock={'0 6px'}>
        <Alert
          closable
          showIcon
          action={action}
          title={businessAlert.description ?? t('input.inputCompletionError.title')}
          type={'warning'}
          onClose={dismissInputCompletionError}
        />
      </Flexbox>
      {businessAlert.extra}
    </>
  );
});

InputCompletionErrorAlertContent.displayName = 'InputCompletionErrorAlertContent';

const InputCompletionErrorAlert = memo(() => {
  const inputCompletionError = useChatInputStore(selectors.inputCompletionErrorVisible);

  if (!inputCompletionError) return null;

  return <InputCompletionErrorAlertContent inputCompletionError={inputCompletionError} />;
});

InputCompletionErrorAlert.displayName = 'InputCompletionErrorAlert';

export default InputCompletionErrorAlert;
