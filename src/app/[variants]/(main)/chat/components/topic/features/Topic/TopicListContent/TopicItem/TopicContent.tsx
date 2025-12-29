import { ActionIcon, Dropdown, EditableText, Icon, type MenuProps, Text } from '@lobehub/ui';
import { App, Button, Checkbox } from 'antd';
import { createStyles } from 'antd-style';
import {
  ExternalLink,
  LucideCopy,
  LucideLoader2,
  MoreVertical,
  PencilLine,
  Star,
  Trash,
  Wand2,
} from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import { isDesktop } from '@/const/version';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const useStyles = createStyles(({ css }) => ({
  content: css`
    position: relative;
    overflow: hidden;
    flex: 1;
  `,
  title: css`
    flex: 1;
    height: 28px;
    line-height: 28px;
    text-align: start;
  `,
}));

interface TopicContentProps {
  fav?: boolean;
  id: string;
  showMore?: boolean;
  title: string;
}

const TopicContent = memo<TopicContentProps>(({ id, title, fav, showMore }) => {
  const { t } = useTranslation(['topic', 'common']);

  const mobile = useIsMobile();

  const openTopicInNewWindow = useGlobalStore((s) => s.openTopicInNewWindow);

  const settings = useUserStore(settingsSelectors.currentSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  // Use ref to track checkbox state in modal
  const deleteFilesRef = useRef(settings.general?.deleteTopicFiles || false);

  const [
    editing,
    favoriteTopic,
    updateTopicTitle,
    removeTopic,
    autoRenameTopicTitle,
    duplicateTopic,
    isLoading,
    activeId,
  ] = useChatStore((s) => [
    s.topicRenamingId === id,
    s.favoriteTopic,
    s.updateTopicTitle,
    s.removeTopic,
    s.autoRenameTopicTitle,
    s.duplicateTopic,
    s.topicLoadingIds.includes(id),
    s.activeId,
  ]);
  const { styles, theme } = useStyles();

  const toggleEditing = (visible?: boolean) => {
    useChatStore.setState({ topicRenamingId: visible ? id : '' });
  };

  const { modal } = App.useApp();

  const items = useMemo<MenuProps['items']>(
    () => [
      {
        icon: <Icon icon={Wand2} />,
        key: 'autoRename',
        label: t('actions.autoRename'),
        onClick: () => {
          autoRenameTopicTitle(id);
        },
      },
      {
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          toggleEditing(true);
        },
      },
      ...(isDesktop
        ? [
            {
              icon: <Icon icon={ExternalLink} />,
              key: 'openInNewWindow',
              label: t('actions.openInNewWindow'),
              onClick: () => {
                openTopicInNewWindow(activeId, id);
              },
            },
          ]
        : []),
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={LucideCopy} />,
        key: 'duplicate',
        label: t('actions.duplicate'),
        onClick: () => {
          duplicateTopic(id);
        },
      },
      // {
      //   icon: <Icon icon={LucideDownload} />,
      //   key: 'export',
      //   label: t('topic.actions.export'),
      //   onClick: () => {
      //     configService.exportSingleTopic(sessionId, id);
      //   },
      // },
      {
        type: 'divider',
      },
      // {
      //   icon: <Icon icon={Share2} />,
      //   key: 'share',
      //   label: t('share'),
      // },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          if (!id) return;

          // Reset ref to current setting value when opening modal
          deleteFilesRef.current = settings.general?.deleteTopicFiles || false;

          const { destroy } = modal.confirm({
            centered: true,
            footer: (
              <Flexbox align="center" horizontal justify="space-between" style={{ marginTop: 24 }}>
                <Checkbox
                  defaultChecked={deleteFilesRef.current}
                  onChange={(e) => {
                    deleteFilesRef.current = e.target.checked;
                    updateGeneralConfig({ deleteTopicFiles: e.target.checked });
                  }}
                >
                  {t('actions.deleteTopicFiles')}
                </Checkbox>
                <Flexbox gap={8} horizontal>
                  <Button onClick={() => destroy()}>{t('cancel', { ns: 'common' })}</Button>
                  <Button
                    danger
                    onClick={async () => {
                      await removeTopic(id);
                      destroy();
                    }}
                    type="primary"
                  >
                    {t('ok', { ns: 'common' })}
                  </Button>
                </Flexbox>
              </Flexbox>
            ),
            maskClosable: true,
            title: t('actions.confirmRemoveTopic'),
          });
        },
      },
    ],
    [
      id,
      activeId,
      autoRenameTopicTitle,
      duplicateTopic,
      removeTopic,
      t,
      toggleEditing,
      openTopicInNewWindow,
      settings.general?.deleteTopicFiles,
      updateGeneralConfig,
    ],
  );

  return (
    <Flexbox
      align={'center'}
      gap={8}
      horizontal
      justify={'space-between'}
      onDoubleClick={(e) => {
        if (!id) return;
        if (e.altKey) toggleEditing(true);
      }}
    >
      <ActionIcon
        color={fav && !isLoading ? theme.colorWarning : undefined}
        fill={fav && !isLoading ? theme.colorWarning : 'transparent'}
        icon={isLoading ? LucideLoader2 : Star}
        onClick={(e) => {
          e.stopPropagation();
          if (!id) return;
          favoriteTopic(id, !fav);
        }}
        size={'small'}
        spin={isLoading}
      />
      {!editing ? (
        title === LOADING_FLAT || (isLoading && !title) ? (
          <Flexbox flex={1} height={28} justify={'center'}>
            <BubblesLoading />
          </Flexbox>
        ) : (
          <Text
            className={styles.title}
            ellipsis={{ rows: 1, tooltip: { placement: 'left', title } }}
            onDoubleClick={() => {
              if (isDesktop) {
                openTopicInNewWindow(activeId, id);
              }
            }}
            style={{ margin: 0 }}
          >
            {title}
          </Text>
        )
      ) : (
        <EditableText
          editing={editing}
          onBlur={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (title !== v) {
              updateTopicTitle(id, v);
            }
            toggleEditing(false);
          }}
          onChangeEnd={(v) => {
            if (title !== v) {
              updateTopicTitle(id, v);
            }
            toggleEditing(false);
          }}
          onEditingChange={toggleEditing}
          showEditIcon={false}
          style={{ height: 28 }}
          value={title}
        />
      )}
      {(showMore || mobile) && !editing && (
        <Dropdown
          arrow={false}
          menu={{
            items: items,
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
            },
          }}
          trigger={['click']}
        >
          <ActionIcon
            className="topic-more"
            icon={MoreVertical}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            size={'small'}
          />
        </Dropdown>
      )}
    </Flexbox>
  );
});

export default TopicContent;
