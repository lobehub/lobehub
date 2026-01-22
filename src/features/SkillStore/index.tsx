'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import { SkillStoreContent } from './SkillStoreContent';

export const createSkillStoreModal = () =>
  createModal({
    allowFullscreen: true,
    children: <SkillStoreContent />,
    destroyOnHidden: false,
    footer: null,
    styles: {
      body: { overflow: 'hidden', padding: 0 },
    },
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
