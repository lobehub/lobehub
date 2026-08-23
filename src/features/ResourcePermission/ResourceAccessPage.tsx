'use client';

import type { FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Icon, Text } from '@lobehub/ui';
import { Alert, toast } from '@lobehub/ui/base-ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, InfoIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import { FORM_STYLE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import type { PermissionResourceType } from '@/services/resourcePermission';
import { isForbiddenError } from '@/utils/forbiddenError';

import { AddCollaboratorButton, CollaboratorList } from './Collaborators';
import PolicySelect from './PolicySelect';
import { useAccessLevelOptions } from './useAccessLevelOptions';
import { useResourcePermission } from './useResourcePermission';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    position: relative;
    overflow-y: auto;
    display: flex;
  `,
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
  rowIcon: css`
    display: flex;
    align-items: center;
    align-self: flex-start;
    height: 1em;
  `,
}));

interface ResourceAccessPageProps {
  /**
   * Per-type copy, already translated by the caller (static keys keep the
   * typed-i18n check): what the level grants day to day, and the private-mode
   * framing.
   */
  copy: {
    /** Shown under the Collaborators group title when `showCollaborators` is on. */
    collaboratorsDesc?: string;
    generalAccessDesc: string;
    privateHint: string;
    privateNotice: string;
  };
  /** Where a non-manager (or a missing/private-foreign resource) is sent. */
  redirectPath: string;
  /** Workspace-relative path of the resource itself — the breadcrumb's way back. */
  resourceHomePath: string;
  resourceId: string;
  /** Display name for the breadcrumb; omitted while it loads. */
  resourceName?: string | null;
  resourceType: PermissionResourceType;
  /**
   * Render the per-user Collaborators group below General access. Off by
   * default — only resource types whose flows support per-user grants
   * (knowledge bases today) turn it on.
   */
  showCollaborators?: boolean;
}

/**
 * A standalone Member-Permissions page for single-dimension resources
 * (Knowledge Base, Document) — the same page shape as Agent's, minus the
 * agent-specific editable-settings groups. Private resources are configurable
 * by their creator: the level is what members get the moment the resource is
 * published (the server stores it ahead of publishing).
 */
const ResourceAccessPage = memo<ResourceAccessPageProps>(
  ({
    copy,
    redirectPath,
    resourceHomePath,
    resourceId,
    resourceName,
    resourceType,
    showCollaborators,
  }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();
    const activeWorkspaceSlug = useActiveWorkspaceSlug();
    const { data, error, isLoading, mutate, setAccessLevel, updating } = useResourcePermission(
      resourceType,
      resourceId,
    );

    const isPrivate = data?.visibility === 'private';
    const accessOptions = useAccessLevelOptions({
      accessLevel: data?.accessLevel,
      isPrivate,
      resourceType,
    });

    // Managing member access is a manager-only surface, like Agent's page: a
    // non-manager (or a private resource that is not the caller's) gets a
    // reason toast and lands back where they came from.
    const isDenied =
      (!!error && isForbiddenError(error)) || (!isLoading && !!data && !data.canManage);
    useEffect(() => {
      if (!isDenied) return;
      toast.error(t('permission.noManagePermission'));
      navigate(redirectPath, { replace: true });
    }, [isDenied, navigate, redirectPath, t]);

    const accessGroup: FormGroupItemType = {
      children: [
        {
          avatar: (
            <span className={styles.rowIcon}>
              <Icon icon={UsersIcon} size={16} />
            </span>
          ),
          children: (
            <PolicySelect
              loading={updating}
              options={accessOptions}
              value={data?.accessLevel}
              onChange={(level) => void setAccessLevel(level)}
            />
          ),
          desc: isPrivate ? copy.privateHint : copy.generalAccessDesc,
          label: t('permission.page.accessLevelLabel'),
        },
      ],
      title: t('permission.page.memberGroup'),
    };

    const formGroups: FormGroupItemType[] = [accessGroup];
    if (showCollaborators) {
      formGroups.push({
        children: <CollaboratorList resourceId={resourceId} resourceType={resourceType} />,
        desc: copy.collaboratorsDesc,
        extra: <AddCollaboratorButton resourceId={resourceId} resourceType={resourceType} />,
        title: t('permission.collaborators.title'),
      });
    }

    return (
      <Flexbox height={'100%'} width={'100%'}>
        <NavHeader
          styles={{ left: { paddingInlineStart: 24 } }}
          left={
            <AntBreadcrumb
              className={styles.breadcrumb}
              separator={<Icon icon={ChevronRight} size={14} />}
              items={[
                ...(resourceName
                  ? [
                      {
                        title: (
                          <Link to={buildWorkspaceAwarePath(resourceHomePath, activeWorkspaceSlug)}>
                            <Text
                              ellipsis
                              as={'span'}
                              color={'inherit'}
                              style={{ maxWidth: 200 }}
                              weight={500}
                            >
                              {resourceName}
                            </Text>
                          </Link>
                        ),
                      },
                    ]
                  : []),
                {
                  title: (
                    <Text as={'span'} color={'inherit'} weight={500}>
                      {t('permission.page.title')}
                    </Text>
                  ),
                },
              ]}
            />
          }
        />
        <Flexbox className={styles.body} flex={1} width={'100%'}>
          <WideScreenContainer>
            <Flexbox gap={16} paddingBlock={16}>
              {error && !isDenied ? (
                <AsyncError error={error} variant={'inline'} onRetry={() => mutate()} />
              ) : isLoading || isDenied ? (
                <Loading debugId="ResourceAccessPage" />
              ) : (
                <>
                  {isPrivate ? (
                    <Alert
                      icon={<Icon icon={InfoIcon} />}
                      style={{ width: '100%' }}
                      title={copy.privateNotice}
                      type={'info'}
                    />
                  ) : null}
                  <Form items={formGroups} itemsType={'group'} {...FORM_STYLE} />
                </>
              )}
            </Flexbox>
          </WideScreenContainer>
        </Flexbox>
      </Flexbox>
    );
  },
);

ResourceAccessPage.displayName = 'ResourceAccessPage';

export default ResourceAccessPage;
