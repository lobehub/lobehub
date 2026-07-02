'use client';

import { CopyButton, Flexbox } from '@lobehub/ui';
import { type BreadcrumbProps } from 'antd';
import { Breadcrumb as AntdBreadcrumb } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { DiscoverTab } from '@/types/discover';

const Breadcrumb = memo<{ identifier: string; tab: DiscoverTab }>(({ tab, identifier }) => {
  const { t } = useTranslation('discover');

  const tabLabel = useMemo(() => {
    if (tab === DiscoverTab.Mcp) return 'MCP Servers';
    if (tab === DiscoverTab.User) return t('tab.user');
    return t(`tab.${tab}` as any);
  }, [tab, t]);

  // For user tab, we don't show the middle breadcrumb as there's no user list page
  const items: BreadcrumbProps['items'] = useMemo(() => {
    if (tab === DiscoverTab.User) {
      return [
        {
          title: <WorkspaceLink to="/community">Community</WorkspaceLink>,
        },
        {
          title: (
            <Flexbox
              horizontal
              align="center"
              gap={4}
              style={{
                color: cssVar.colorTextSecondary,
              }}
            >
              @{identifier}
            </Flexbox>
          ),
        },
      ];
    }

    return [
      {
        title: <WorkspaceLink to="/community">Community</WorkspaceLink>,
      },
      {
        title: <WorkspaceLink to={`/community/${tab}`}>{tabLabel}</WorkspaceLink>,
      },
      {
        title: (
          <Flexbox
            horizontal
            align="center"
            gap={4}
            style={{
              color: cssVar.colorTextSecondary,
            }}
          >
            {identifier}
            <CopyButton
              content={identifier}
              size={{
                blockSize: 22,
                size: 14,
              }}
            />
          </Flexbox>
        ),
      },
    ];
  }, [tab, identifier, tabLabel]);

  return <AntdBreadcrumb items={items} />;
});

export default Breadcrumb;
