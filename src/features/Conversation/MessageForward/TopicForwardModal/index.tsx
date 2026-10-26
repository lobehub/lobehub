'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import type { TopicForwardContentProps } from './Content';
import { TopicForwardContent } from './Content';

export const createTopicForwardModal = (props: TopicForwardContentProps) =>
  createModal({
    content: <TopicForwardContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { overflow: 'hidden', padding: 16 } },
    // A handoff moves the work and stops the source's own continuation, so it
    // gets its own wording; a plain forward only shares a copy of the context.
    title: t(
      props.cancelSourceContinuation
        ? 'messageForward.topic.handoff.title'
        : 'messageForward.topic.modalTitle',
      { ns: 'chat' },
    ),
    width: 'min(90%, 760px)',
  });
