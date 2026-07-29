'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import type { TopicForwardContentProps } from './Content';
import { TopicForwardContent } from './Content';

export const createTopicForwardModal = (props: TopicForwardContentProps) =>
  createModal({
    content: <TopicForwardContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { overflow: 'hidden', padding: 16 } },
    title: t('messageForward.topic.modalTitle', { ns: 'chat' }),
    width: 'min(90%, 760px)',
  });
