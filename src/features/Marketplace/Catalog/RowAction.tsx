'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { CheckIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RowActionProps {
  addLabel: string;
  disabled?: boolean;
  installed?: boolean;
  installedLabel: string;
  loading?: boolean;
  name: string;
  onAdd: () => void;
}

const RowAction = ({
  addLabel,
  disabled,
  installed,
  installedLabel,
  loading,
  name,
  onAdd,
}: RowActionProps) => {
  const { t } = useTranslation('discover');

  if (installed)
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={CheckIcon} size={14} style={{ color: cssVar.colorSuccess }} />
        <Text fontSize={12} type={'secondary'}>
          {installedLabel}
        </Text>
      </Flexbox>
    );

  return (
    <Button
      aria-label={t('catalog.rowAction', { action: addLabel, name })}
      disabled={disabled || loading}
      icon={PlusIcon}
      loading={loading}
      size={'small'}
      onClick={(event) => {
        event.stopPropagation();
        onAdd();
      }}
    >
      {addLabel}
    </Button>
  );
};

export default RowAction;
