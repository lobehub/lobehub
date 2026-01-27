'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import { MemoryRouter } from 'react-router-dom';

import { isDesktop } from '@/const/version';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';

import { SkillStoreContent } from './SkillStoreContent';

export const createSkillStoreModal = () =>
  createModal({
    allowFullscreen: true,
    children: (
      <MemoryRouter>
        <MarketAuthProvider isDesktop={isDesktop}>
          <SkillStoreContent />
        </MarketAuthProvider>
      </MemoryRouter>
    ),
    destroyOnHidden: false,
    footer: null,
    styles: {
      body: { overflow: 'hidden', padding: 0 },
    },
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
