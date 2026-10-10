'use client';

import { Block, Button, cssVar,Flexbox, Icon, Text   } from '@lobehub/ui';
import { ArrowUpRightIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getDashboardPath } from '@/features/Dashboard/utils/path';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useServerConfigStore } from '@/store/serverConfig';

import type { AddWidgetToDashboardState } from '../../types';

/** Where the widget landed, one click from the board itself. */
const AddedToDashboard = memo<AddWidgetToDashboardState>(
  ({ dashboardId, dashboardTitle, projectId }) => {
    const { t } = useTranslation('dashboard');
    const navigate = useWorkspaceAwareNavigate();
    // Dashboard routes exist only in the desktop shell — on mobile the Open
    // action would navigate nowhere, so the card just states the placement.
    const isMobile = useServerConfigStore((s) => s.isMobile);

    return (
      <Block padding={10} variant={'outlined'} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextSecondary} icon={LayoutDashboardIcon} size={16} />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
            {t('chat.added', { title: dashboardTitle })}
          </Text>
          {!isMobile && (
            <Button
              data-open-dashboard={dashboardId}
              icon={ArrowUpRightIcon}
              size={'small'}
              onClick={() => navigate(getDashboardPath({ id: dashboardId, projectId }))}
            >
              {t('chat.openDashboard')}
            </Button>
          )}
        </Flexbox>
      </Block>
    );
  },
);

AddedToDashboard.displayName = 'DashboardAddedToDashboard';

export default AddedToDashboard;
