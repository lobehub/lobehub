'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { Button, createModal, Text, useModalContext } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface NotificationDetailParams {
  content: string;
  context?: string | null;
  createdAt: Date | string;
  onAction?: () => void;
  title: string;
}

const NotificationDetailContent = memo<Omit<NotificationDetailParams, 'title'>>(
  ({ content, context, createdAt, onAction }) => {
    const { t } = useTranslation('notification');
    const { close } = useModalContext();

    return (
      <Flexbox gap={12}>
        <Text fontSize={12} type="secondary">
          {dayjs(createdAt).format('YYYY-MM-DD HH:mm')}
        </Text>
        {context && (
          <Text ellipsis title={context} type="secondary">
            {context}
          </Text>
        )}
        <Markdown fontSize={14} variant={'chat'}>
          {content}
        </Markdown>
        {onAction && (
          <Flexbox horizontal justify="flex-end">
            <Button
              type="primary"
              onClick={() => {
                close();
                onAction();
              }}
            >
              {t('inbox.viewDetail')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

NotificationDetailContent.displayName = 'NotificationDetailContent';

export const createNotificationDetailModal = ({
  title,
  content,
  context,
  createdAt,
  onAction,
}: NotificationDetailParams) =>
  createModal({
    content: (
      <NotificationDetailContent
        content={content}
        context={context}
        createdAt={createdAt}
        onAction={onAction}
      />
    ),
    footer: null,
    maskClosable: true,
    title,
    width: 640,
  });
