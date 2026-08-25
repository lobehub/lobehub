'use client';

import { ActionIcon, Avatar, DropdownMenu, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import {
  ChevronRightIcon,
  MoreVerticalIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import ClientIdDisplay from '../ClientIdDisplay';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }
  `,
}));

interface AppItemProps {
  app: OAuthAppItem;
  canEdit: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  onOpen: () => void;
}

const AppItem = memo<AppItemProps>(({ app, canEdit, onChanged, onDeleted, onOpen }) => {
  const { t } = useTranslation('auth');

  const setEnabled = lambdaQuery.oauthApp.setEnabled.useMutation({ onSuccess: onChanged });
  const deleteApp = lambdaQuery.oauthApp.delete.useMutation({ onSuccess: onDeleted });

  const handleDelete = () =>
    confirmModal({
      content: t('oauthApp.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('oauthApp.deleteConfirm.ok'),
      onOk: async () => {
        await deleteApp.mutateAsync({ id: app.id });
      },
      title: t('oauthApp.deleteConfirm.title'),
    });

  const lastUsed = app.lastUsedAt
    ? t('oauthApp.item.lastUsed', { time: dayjs(app.lastUsedAt).fromNow() })
    : t('oauthApp.list.neverUsed');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.row}
      gap={12}
      role={'button'}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Avatar avatar={app.logoUri || app.name} shape={'square'} size={36} title={app.name} />

      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text ellipsis weight={500}>
            {app.name}
          </Text>
          {!app.enabled && <Tag>{t('oauthApp.item.disabledTag')}</Tag>}
        </Flexbox>
        <span style={{ alignSelf: 'flex-start' }} onClick={(e) => e.stopPropagation()}>
          <ClientIdDisplay clientId={app.id} />
        </span>
        <span className={styles.meta}>
          {t('oauthApp.type.deviceFlow')} · {lastUsed}
        </span>
      </Flexbox>

      {canEdit && (
        <span style={{ flex: 'none' }} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            items={[
              app.enabled
                ? {
                    icon: <Icon icon={PowerOffIcon} />,
                    key: 'disable',
                    label: t('oauthApp.actions.disable'),
                    onClick: () => setEnabled.mutate({ enabled: false, id: app.id }),
                  }
                : {
                    icon: <Icon icon={PowerIcon} />,
                    key: 'enable',
                    label: t('oauthApp.actions.enable'),
                    onClick: () => setEnabled.mutate({ enabled: true, id: app.id }),
                  },
              {
                danger: true,
                icon: <Icon icon={Trash2Icon} />,
                key: 'delete',
                label: t('oauthApp.list.actions.delete'),
                onClick: handleDelete,
              },
            ]}
          >
            <ActionIcon icon={MoreVerticalIcon} size={'small'} />
          </DropdownMenu>
        </span>
      )}

      <Icon className={styles.chevron} icon={ChevronRightIcon} size={'small'} />
    </Flexbox>
  );
});

AppItem.displayName = 'AppItem';

export default AppItem;
