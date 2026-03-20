'use client';

import { Accordion, AccordionItem, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { LayoutGrid, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../types';
import List from './List';

enum GroupKey {
  Topics = 'topics',
}

const Body = memo<GenerationLayoutCommonProps>((props) => {
  const { namespace, useStore, viewModeStatusKey, generationTopicsSelector } = props;
  const { t } = useTranslation(namespace);
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);

  const generationTopics = useStore(generationTopicsSelector);
  const count = generationTopics?.length || 0;

  return (
    <Flexbox gap={1} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Topics]} gap={2}>
        <AccordionItem
          itemKey={GroupKey.Topics}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          action={
            <Flexbox horizontal gap={2}>
              <Segmented
                size={'small'}
                value={viewMode}
                variant={'borderless'}
                options={[
                  {
                    icon: <Icon icon={ListIcon} />,
                    value: 'list',
                  },
                  {
                    icon: <Icon icon={LayoutGrid} />,
                    value: 'grid',
                  },
                ]}
                onChange={(v) => updateSystemStatus({ [viewModeStatusKey]: v })}
              />
            </Flexbox>
          }
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
