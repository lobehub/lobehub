'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ArrowUpRightIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getDashboardPath } from '@/features/Dashboard/utils/path';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import type { AddWidgetToDashboardState } from '../../types';

/** Where the widget landed, one click from the board itself. */
const AddedToDashboard = memo<AddWidgetToDashboardState>(
  ({ dashboardId, dashboardTitle, projectId }) => {
    const { t } = useTranslation('dashboard');
    const navigate = useWorkspaceAwareNavigate();

    return (
      <Block padding={10} variant={'outlined'} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextSecondary} icon={LayoutDashboardIcon} size={16} />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
            {t('chat.added', { title: dashboardTitle })}
          </Text>
          <Button
            data-open-dashboard={dashboardId}
            icon={ArrowUpRightIcon}
            size={'small'}
            onClick={() => navigate(getDashboardPath({ id: dashboardId, projectId }))}
          >
            {t('chat.openDashboard')}
          </Button>
        </Flexbox>
      </Block>
    );
  },
);

AddedToDashboard.displayName = 'DashboardAddedToDashboard';

export default AddedToDashboard;
