'use client';

import { Avatar, Flexbox, Icon, Popover, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BotIcon, CheckSquareIcon, FileTextIcon } from 'lucide-react';
import { memo, type PropsWithChildren, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';
import { documentService } from '@/services/document';
import { taskService } from '@/services/task';

import type { InternalLinkReference } from '../internalLink';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    width: 320px;
    padding: 16px;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};
  `,
  icon: css`
    display: grid;
    flex: none;
    place-items: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    overflow: hidden;

    font-weight: 600;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  type: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface PreviewData {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  title?: string | null;
}

const getPreviewData = async (reference: InternalLinkReference): Promise<PreviewData | null> => {
  switch (reference.type) {
    case 'agent': {
      return agentService.getAgentConfigById(reference.agentId);
    }
    case 'document': {
      const document = await documentService.getDocumentById(reference.documentId);
      return document
        ? {
            description: document.content,
            title: document.title || document.filename,
          }
        : null;
    }
    case 'task': {
      const result = await taskService.getDetail(reference.taskId);
      const task = result.data;
      return task
        ? {
            description: task.description || task.instruction,
            title: task.name || task.identifier,
          }
        : null;
    }
    case 'route': {
      return null;
    }
  }
};

interface InternalEntityPreviewProps extends PropsWithChildren {
  fallbackTitle: string;
  reference: Exclude<InternalLinkReference, { type: 'route' }>;
}

export const InternalEntityPreview = memo<InternalEntityPreviewProps>(
  ({ children, fallbackTitle, reference }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const { data, isLoading } = useClientDataSWR(
      open ? ['internal-entity-preview', reference.type, reference.pathname] : null,
      () => getPreviewData(reference),
      { revalidateOnFocus: false },
    );

    const icon =
      reference.type === 'agent'
        ? BotIcon
        : reference.type === 'task'
          ? CheckSquareIcon
          : FileTextIcon;
    const typeLabel = t(`internalLink.preview.${reference.type}`);

    const content = isLoading ? (
      <div className={styles.content}>
        <Skeleton active avatar paragraph={{ rows: 2 }} />
      </div>
    ) : (
      <Flexbox className={styles.content} gap={12}>
        <Flexbox horizontal align="center" gap={12}>
          {reference.type === 'agent' && data?.avatar ? (
            <Avatar
              avatar={data.avatar}
              background={data.backgroundColor ?? undefined}
              shape="square"
              size={36}
            />
          ) : (
            <span className={styles.icon}>
              <Icon icon={icon} size={19} />
            </span>
          )}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <span className={styles.type}>{typeLabel}</span>
            <span className={styles.title}>{data?.title || fallbackTitle}</span>
          </Flexbox>
        </Flexbox>
        {data?.description && (
          <Text className={styles.description} fontSize={13}>
            {data.description}
          </Text>
        )}
      </Flexbox>
    );

    return (
      <Popover
        content={content}
        mouseEnterDelay={0.35}
        open={open}
        placement="top"
        styles={{ content: { borderRadius: 12, overflow: 'hidden', padding: 0 } }}
        trigger="hover"
        triggerProps={{ role: 'link' }}
        onOpenChange={setOpen}
      >
        {children}
      </Popover>
    );
  },
);

InternalEntityPreview.displayName = 'InternalEntityPreview';
