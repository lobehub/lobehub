'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import { type Klavis } from 'klavis';

import { BuiltinSkillDetailContent } from './BuiltinSkillDetailContent';
import { KlavisSkillDetailContent } from './KlavisSkillDetailContent';
import { LobehubSkillDetailContent } from './LobehubSkillDetailContent';

export interface CreateBuiltinSkillDetailModalOptions {
  identifier: string;
}

export const createBuiltinSkillDetailModal = ({
  identifier,
}: CreateBuiltinSkillDetailModalOptions) =>
  createModal({
    children: <BuiltinSkillDetailContent identifier={identifier} />,
    destroyOnHidden: true,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });

export interface CreateKlavisSkillDetailModalOptions {
  identifier: string;
  serverName: Klavis.McpServerName;
}

export const createKlavisSkillDetailModal = ({
  identifier,
  serverName,
}: CreateKlavisSkillDetailModalOptions) =>
  createModal({
    children: <KlavisSkillDetailContent identifier={identifier} serverName={serverName} />,
    destroyOnHidden: true,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });

export interface CreateLobehubSkillDetailModalOptions {
  identifier: string;
}

export const createLobehubSkillDetailModal = ({
  identifier,
}: CreateLobehubSkillDetailModalOptions) =>
  createModal({
    children: <LobehubSkillDetailContent identifier={identifier} />,
    destroyOnHidden: true,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });
