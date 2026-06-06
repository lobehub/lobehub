'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { isDesktop } from '@/const/version';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';

import { SkillStoreContent } from './SkillStoreContent';

export const createSkillStoreModal = () =>
  createModal({
    content: (
      <MarketAuthProvider isDesktop={isDesktop}>
        <SkillStoreContent />
      </MarketAuthProvider>
    ),
    footer: null,
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
