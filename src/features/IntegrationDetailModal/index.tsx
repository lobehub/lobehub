'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import type { Klavis } from 'klavis';

import { IntegrationDetailContent, type IntegrationType } from './IntegrationDetailContent';

export type { IntegrationType } from './IntegrationDetailContent';

export interface CreateIntegrationDetailModalOptions {
  identifier: string;
  serverName?: Klavis.McpServerName;
  type: IntegrationType;
}

export const createIntegrationDetailModal = ({
  identifier,
  serverName,
  type,
}: CreateIntegrationDetailModalOptions) =>
  createModal({
    children: (
      <IntegrationDetailContent identifier={identifier} serverName={serverName} type={type} />
    ),
    destroyOnHidden: true,
    footer: null,
    title: t('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });
