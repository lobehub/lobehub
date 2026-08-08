'use client';

import { Flexbox } from '@lobehub/ui';
import { Checkbox } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DeleteTopicConfirmContentProps {
  defaultRemoveFiles?: boolean;
  description?: ReactNode;
  onChange: (removeFiles: boolean) => void;
  showRemoveFiles: boolean;
}

export const DeleteTopicConfirmContent = memo<DeleteTopicConfirmContentProps>(
  ({ description, onChange, showRemoveFiles, defaultRemoveFiles = true }) => {
    const { t } = useTranslation('topic');
    const [checked, setChecked] = useState(defaultRemoveFiles);

    return (
      <Flexbox gap={12}>
        {description ?? t('actions.confirmRemoveTopic')}
        {showRemoveFiles && (
          <Checkbox
            checked={checked}
            onChange={(value) => {
              setChecked(value);
              onChange(value);
            }}
          >
            {t('actions.confirmRemoveTopicFiles')}
          </Checkbox>
        )}
      </Flexbox>
    );
  },
);
