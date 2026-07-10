'use client';

import { Accordion, AccordionItem, Flexbox, Icon, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { LayoutGrid, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../types';
import List from './List';

enum GroupKey {
  PrivateTopics = 'private-topics',
  Topics = 'topics',
  WorkspaceTopics = 'workspace-topics',
}

const Body = memo<GenerationLayoutCommonProps>((props) => {
  const { namespace, useStore, viewModeStatusKey, generationTopicsSelector } = props;
  const { t } = useTranslation(namespace);
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const activeWorkspaceId = useActiveWorkspaceId();

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);

  const generationTopics = useStore(generationTopicsSelector);
  const count = generationTopics?.length || 0;
  const privateCount =
    generationTopics?.filter((topic: any) => topic.visibility === 'private').length || 0;
  const workspaceCount =
    generationTopics?.filter((topic: any) => topic.visibility !== 'private').length || 0;

  const viewModeTabs = (
    <Flexbox horizontal gap={2}>
      <Tabs
        activeKey={viewMode}
        size={'small'}
        items={[
          {
            icon: <Icon icon={ListIcon} />,
            key: 'list',
            label: null,
          },
          {
            icon: <Icon icon={LayoutGrid} />,
            key: 'grid',
            label: null,
          },
        ]}
        onChange={(key) => updateSystemStatus({ [viewModeStatusKey]: key })}
      />
    </Flexbox>
  );

  if (activeWorkspaceId) {
    return (
      <Flexbox gap={1} paddingInline={4}>
        <Accordion defaultExpandedKeys={[GroupKey.PrivateTopics, GroupKey.WorkspaceTopics]} gap={2}>
          <AccordionItem
            action={viewModeTabs}
            itemKey={GroupKey.PrivateTopics}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('topic.privateTitle')}
                {privateCount > 0 && ` ${privateCount}`}
              </Text>
            }
          >
            <List
              namespace={namespace}
              useStore={useStore}
              viewModeStatusKey={viewModeStatusKey}
              visibility="private"
            />
          </AccordionItem>
          <AccordionItem
            itemKey={GroupKey.WorkspaceTopics}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('topic.workspaceTitle')}
                {workspaceCount > 0 && ` ${workspaceCount}`}
              </Text>
            }
          >
            <List
              namespace={namespace}
              useStore={useStore}
              viewModeStatusKey={viewModeStatusKey}
              visibility="public"
            />
          </AccordionItem>
        </Accordion>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={1} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Topics]} gap={2}>
        <AccordionItem
          action={viewModeTabs}
          itemKey={GroupKey.Topics}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          title={
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('topic.title')}
              {count > 0 && ` ${count}`}
            </Text>
          }
        >
          <List namespace={namespace} useStore={useStore} viewModeStatusKey={viewModeStatusKey} />
        </AccordionItem>
      </Accordion>
    </Flexbox>
  );
});

Body.displayName = 'GenerationLayoutBody';

export default Body;
