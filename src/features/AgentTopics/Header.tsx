'use client';

import { ActionIcon, Button, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckSquare2, LayoutGrid, List, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { SESSION_CHAT_URL } from '@/const/url';
import NavHeader from '@/features/NavHeader';

import { useTopicsViewStore } from './store';

interface HeaderProps {
  agentId: string;
  total: number;
}

const Header = memo<HeaderProps>(({ agentId, total }) => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setViewMode = useTopicsViewStore((s) => s.setViewMode);
  const selectMode = useTopicsViewStore((s) => s.selectMode);
  const toggleSelectMode = useTopicsViewStore((s) => s.toggleSelectMode);

  return (
    <NavHeader
      left={
        <Flexbox horizontal align={'center'} gap={8} paddingInline={4}>
          <Text fontSize={15} weight={600}>
            {t('management.title')}
          </Text>
          {total > 0 && (
            <Text fontSize={13} style={{ color: cssVar.colorTextQuaternary }}>
              {total}
            </Text>
          )}
        </Flexbox>
      }
      right={
        <Flexbox horizontal align={'center'} gap={6}>
          <Segmented
            size={'small'}
            value={viewMode}
            variant={'borderless'}
            options={[
              {
                icon: <Icon icon={LayoutGrid} />,
                title: t('management.view.card'),
                value: 'card',
              },
              {
                icon: <Icon icon={List} />,
                title: t('management.view.list'),
                value: 'list',
              },
            ]}
            onChange={(v) => setViewMode(v as 'card' | 'list')}
          />
          <ActionIcon
            active={selectMode}
            icon={CheckSquare2}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('management.actions.select')}
            onClick={() => toggleSelectMode()}
          />
          <Button icon={Plus} type={'primary'} onClick={() => navigate(SESSION_CHAT_URL(agentId))}>
            {t('management.actions.newChat')}
          </Button>
        </Flexbox>
      }
    />
  );
});

Header.displayName = 'AgentTopicsHeader';

export default Header;
