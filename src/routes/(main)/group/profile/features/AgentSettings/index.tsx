'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';

import Content from './Content';

export const openGroupAgentSettingsModal = (): ModalInstance =>
  createModal({
    content: <Content />,
    footer: null,
    maskClosable: true,
    styles: {
      content: {
        height: '60vh',
        overflow: 'scroll',
        padding: 0,
        position: 'relative',
      },
      header: { display: 'none' },
    },
    width: 960,
  });
