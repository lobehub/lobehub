'use client';

import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { Button, createModal, useModalContext } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface NotificationDetailParams {
  category?: string;
  content: string;
  context?: string | null;
  createdAt: Date | string;
  onAction?: () => void;
  title: string;
}

const NotificationDetailContent = memo<Omit<NotificationDetailParams, 'title'>>(
  ({ category, content, context, createdAt, onAction }) => {
    const { t } = useTranslation('notification');
    const { close } = useModalContext();

    return (
      <Flexbox gap={12}>
        <Text fontSize={12} type="secondary">
          {category && `${t(`category.${category}`, { defaultValue: category })} · `}
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

export const createNotificationDetailModal = ({
  title,
  category,
  content,
  context,
  createdAt,
  onAction,
}: NotificationDetailParams) =>
  createModal({
    content: (
      <NotificationDetailContent
        category={category}
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
