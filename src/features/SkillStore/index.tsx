'use client';

import { createModal, LOBE_THEME_APP_ID } from '@lobehub/ui';
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
    // Render the antd Modal inside appElement instead of document.body,
    // so the modal and DropdownMenu portals share the same stacking context
    getContainer: () => document.getElementById(LOBE_THEME_APP_ID) || document.body,
    styles: {
      body: { overflow: 'hidden', padding: 0 },
    },
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
