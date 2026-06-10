'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import type { GenerationLayoutCommonProps } from '../types';

const AddButton = memo<Pick<GenerationLayoutCommonProps, 'namespace' | 'useStore'>>((props) => {
  const { namespace, useStore } = props;
  const { t } = useTranslation(namespace);
  const { allowed: canCreate } = usePermission('create_content');
  const openNewGenerationTopic = useStore((s: any) => s.openNewGenerationTopic);

  return (
    <ActionIcon
      disabled={!canCreate}
      icon={SquarePenIcon}
      title={t('topic.createNew')}
      size={{
        blockSize: 32,
        size: 18,
      }}
      onClick={() => {
        if (!canCreate) return;

        openNewGenerationTopic();
      }}
    />
  );
});

AddButton.displayName = 'GenerationLayoutAddButton';

export default AddButton;
