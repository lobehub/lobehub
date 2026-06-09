'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { type Klavis } from 'klavis';

import { BuiltinAgentSkillDetailContent } from './BuiltinAgentSkillDetailContent';
import { BuiltinSkillDetailContent } from './BuiltinSkillDetailContent';
import { KlavisSkillDetailContent } from './KlavisSkillDetailContent';
import { LobehubSkillDetailContent } from './LobehubSkillDetailContent';

export interface CreateBuiltinAgentSkillDetailModalOptions {
  identifier: string;
}

export const createBuiltinAgentSkillDetailModal = ({
  identifier,
}: CreateBuiltinAgentSkillDetailModalOptions) =>
  createModal({
    content: <BuiltinAgentSkillDetailContent identifier={identifier} />,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });

export interface CreateBuiltinSkillDetailModalOptions {
  identifier: string;
}

export const createBuiltinSkillDetailModal = ({
  identifier,
}: CreateBuiltinSkillDetailModalOptions) =>
  createModal({
    content: <BuiltinSkillDetailContent identifier={identifier} />,
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
    content: <KlavisSkillDetailContent identifier={identifier} serverName={serverName} />,
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
    content: <LobehubSkillDetailContent identifier={identifier} />,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });
