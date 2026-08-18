'use client';

import { Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const styles = createStaticStyles(({ css }) => ({
  breadcrumb: css`
    ol {
      align-items: center;
    }

    li,
    .ant-breadcrumb-link,
    .ant-breadcrumb-link > a {
      display: flex;
      align-items: center;
    }
  `,
}));

interface GroupBreadcrumbProps {
  groupId: string;
  /** The current section under the group, e.g. 成员权限. */
  title?: ReactNode;
}

/**
 * Breadcrumb for pages that live under an agent group: `<GroupName> › <Section>`,
 * the group-side counterpart of `AgentBreadcrumb`. The group name links back to
 * the group chat.
 */
const GroupBreadcrumb = memo<GroupBreadcrumbProps>(({ groupId, title }) => {
  const { t } = useTranslation('chat');
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const groupTitle = useAgentGroupStore(
    (s) => agentGroupSelectors.getGroupById(groupId)(s)?.title || '',
  );
  const displayTitle = groupTitle || t('group.title');
  const groupHomePath = useMemo(
    () => buildWorkspaceAwarePath(urlJoin('/group', groupId), activeWorkspaceSlug),
    [activeWorkspaceSlug, groupId],
  );

  return (
    <AntBreadcrumb
      className={styles.breadcrumb}
      separator={<Icon icon={ChevronRight} size={14} />}
      items={[
        {
          title: (
            <Link to={groupHomePath}>
              <Text ellipsis as={'span'} color={'inherit'} style={{ maxWidth: 200 }} weight={500}>
                {displayTitle}
              </Text>
            </Link>
          ),
        },
        ...(title === undefined || title === null
          ? []
          : [
              {
                title: (
                  <Text as={'span'} color={'inherit'} weight={500}>
                    {title}
                  </Text>
                ),
              },
            ]),
      ]}
    />
  );
});

GroupBreadcrumb.displayName = 'GroupBreadcrumb';

export default GroupBreadcrumb;
