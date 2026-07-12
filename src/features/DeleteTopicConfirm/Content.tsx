'use client';

import { Checkbox, Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DeleteTopicConfirmContentProps {
  defaultRemoveFiles?: boolean;
  onChange: (removeFiles: boolean) => void;
}

const DeleteTopicConfirmContent = memo<DeleteTopicConfirmContentProps>(
  ({ onChange, defaultRemoveFiles = true }) => {
    const { t } = useTranslation('topic');
    const [checked, setChecked] = useState(defaultRemoveFiles);

    return (
      <Flexbox gap={12}>
        {t('actions.confirmRemoveTopic')}
        <Checkbox
          checked={checked}
          onChange={(value) => {
            setChecked(value);
            onChange(value);
          }}
        >
          {t('actions.confirmRemoveTopicFiles')}
        </Checkbox>
      </Flexbox>
    );
  },
);

export default DeleteTopicConfirmContent;
