'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import type { ReactNode } from 'react';

import { isDesktop } from '@/const/version';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';

import { MarketSkillStoreContent } from './MarketSkillStoreContent';
import { SkillStoreContent } from './SkillStoreContent';

const openStore = (content: ReactNode) =>
  createModal({
    content: <MarketAuthProvider isDesktop={isDesktop}>{content}</MarketAuthProvider>,
    footer: null,
    title: t('skillStore.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });

export const createSkillStoreModal = () => openStore(<SkillStoreContent />);

export const createMarketSkillStoreModal = () => openStore(<MarketSkillStoreContent />);
