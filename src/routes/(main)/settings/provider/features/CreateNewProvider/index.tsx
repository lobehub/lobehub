'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { BrainIcon } from 'lucide-react';

import CreateNewProviderContent from './Content';

export const createCreateNewProviderModal = (): ModalInstance =>
  createModal({
    content: <CreateNewProviderContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { paddingBlock: 16, paddingInline: 24 },
    },
    title: (
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={BrainIcon} />
        {t('createNewAiProvider.title', { ns: 'modelProvider' })}
      </Flexbox>
    ),
    width: 'min(90vw, 640px)',
  });
