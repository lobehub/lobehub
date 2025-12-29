'use client';

import { ActionIcon, Dropdown, Icon, type MenuProps } from '@lobehub/ui';
import { App, Button, Checkbox } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { LucideCheck, MoreHorizontal, Search, Trash } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import SidebarHeader from '@/components/SidebarHeader';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, settingsSelectors } from '@/store/user/selectors';
import { TopicDisplayMode } from '@/types/topic';

import TopicSearchBar from './TopicSearchBar';

const Header = memo(() => {
  const { t } = useTranslation(['topic', 'common']);
  const [topicLength, removeUnstarredTopic, removeAllTopic] = useChatStore((s) => [
    topicSelectors.currentTopicLength(s),
    s.removeUnstarredTopic,
    s.removeSessionTopics,
  ]);
  const [topicDisplayMode, updatePreference] = useUserStore((s) => [
    preferenceSelectors.topicDisplayMode(s),
    s.updatePreference,
  ]);
  const settings = useUserStore(settingsSelectors.currentSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  // Use ref to track checkbox state in modal
  const deleteFilesRef = useRef(settings.general?.deleteTopicFiles || false);

  const [showSearch, setShowSearch] = useState(false);
  const { modal } = App.useApp();

  const items = useMemo<MenuProps['items']>(
    () => [
      ...(Object.values(TopicDisplayMode).map((mode) => ({
        icon: topicDisplayMode === mode ? <Icon icon={LucideCheck} /> : <div />,
        key: mode,
        label: t(`groupMode.${mode}`),
        onClick: () => {
          updatePreference({ topicDisplayMode: mode });
        },
      })) as ItemType[]),
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={Trash} />,
        key: 'deleteUnstarred',
        label: t('actions.removeUnstarred'),
        onClick: () => {
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
                      await removeUnstarredTopic();
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
            title: t('actions.confirmRemoveUnstarred'),
          });
        },
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'deleteAll',
        label: t('actions.removeAll'),
        onClick: () => {
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
                      await removeAllTopic();
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
            title: t('actions.confirmRemoveAll'),
          });
        },
      },
    ],
    [topicDisplayMode, settings.general?.deleteTopicFiles, updateGeneralConfig],
  );

  return showSearch ? (
    <Flexbox padding={'12px 16px 4px'}>
      <TopicSearchBar onClear={() => setShowSearch(false)} />
    </Flexbox>
  ) : (
    <SidebarHeader
      actions={
        <>
          <ActionIcon icon={Search} onClick={() => setShowSearch(true)} size={'small'} />
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
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </Dropdown>
        </>
      }
      title={`${t('title')} ${topicLength > 1 ? topicLength + 1 : ''}`}
    />
  );
});

export default Header;
