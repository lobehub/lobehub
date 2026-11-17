'use client';

import type { BrowserSidebarImportResult } from '@lobechat/electron-client-ipc';
import { createModal, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';

import { ImportLoginDataContent } from './Content';

export const openImportLoginDataModal = (options: {
  onImported?: (result: BrowserSidebarImportResult) => void;
}): ModalInstance =>
  createModal({
    content: <ImportLoginDataContent {...options} />,
    footer: null,
    maskClosable: true,
    title: t('workingPanel.browser.import.modal.title', { ns: 'chat' }),
    width: 'min(90vw, 520px)',
  });
