'use client';

import { Alert } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface InlineActionErrorProps {
  description?: ReactNode;
  onRetry?: () => void | Promise<void>;
  retrying?: boolean;
  title: ReactNode;
}

const InlineActionError = ({ description, onRetry, retrying, title }: InlineActionErrorProps) => {
  const { t } = useTranslation('common');

  return (
    <Alert
      description={description}
      title={title}
      type="error"
      variant="filled"
      action={
        onRetry ? (
          <Button loading={retrying} size="small" onClick={onRetry}>
            {t('retry')}
          </Button>
        ) : undefined
      }
    />
  );
};

export default InlineActionError;
