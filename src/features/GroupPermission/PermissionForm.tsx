'use client';

import type { AgentModelSelectionPolicy } from '@lobechat/types';
import type { FormGroupItemType } from '@lobehub/ui';
import { Empty, Form, Icon } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Bot, InfoIcon, LockIcon, MonitorSmartphone, UsersIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import PolicySelect, { type PolicyOption } from '@/features/ResourcePermission/PolicySelect';
import { getSelectionPolicyLabelKeys } from '@/features/ResourcePermission/selectionPolicyLabels';
import { useAccessLevelOptions } from '@/features/ResourcePermission/useAccessLevelOptions';

import { resolveGroupPermissionSections } from './permissionSections';
import { useGroupPermission } from './useGroupPermission';

const styles = createStaticStyles(({ css }) => ({
  // Same one-line-icon alignment the Agent Permission form uses: FormTitle
  // centres the avatar against title+description, which drops a single-line
  // icon below the label it belongs to.
  rowIcon: css`
    display: flex;
    align-items: center;
    align-self: flex-start;
    height: 1em;
  `,
}));

interface PermissionFormProps {
  groupId: string;
}

const PermissionForm = memo<PermissionFormProps>(({ groupId }) => {
  const { t } = useTranslation('setting');
  const {
    accessError,
    accessLevel,
    accessLoading,
    canEditConfig,
    canFixExecutionTarget,
    canManageAccess,
    executionTargetPolicy,
    hasSupervisor,
    isPrivate,
    isWorkspaceGroup,
    modelPolicy,
    retryAccess,
    setAccessLevel,
    setExecutionTargetPolicy,
    setModelPolicy,
  } = useGroupPermission(groupId);

  const accessOptions = useAccessLevelOptions({ accessLevel, isPrivate });
  const labelKeys = getSelectionPolicyLabelKeys(isPrivate);
  const sections = resolveGroupPermissionSections({
    accessError,
    canManageAccess,
    hasSupervisor,
    isPrivate,
    isWorkspaceGroup,
  });

  const modelPolicyOptions = useMemo(
    (): PolicyOption<AgentModelSelectionPolicy>[] => [
      {
        desc: t('permission.page.groupModelPolicyMemberDesc'),
        icon: UsersIcon,
        label: t(labelKeys.member),
        value: 'member',
      },
      {
        desc: t('permission.page.groupModelPolicyFixedDesc'),
        icon: LockIcon,
        label: t(labelKeys.fixed),
        value: 'fixed',
      },
    ],
    [labelKeys, t],
  );

  const executionPolicyOptions = useMemo(
    (): PolicyOption<AgentModelSelectionPolicy>[] => [
      {
        desc: t('permission.page.groupDevicePolicyMemberDesc'),
        icon: UsersIcon,
        label: t(labelKeys.member),
        value: 'member',
      },
      // Nothing to pin to yet — say so where the choice is made rather than
      // letting the click fail silently.
      canFixExecutionTarget
        ? {
            desc: t('permission.page.groupDevicePolicyFixedDesc'),
            icon: LockIcon,
            label: t(labelKeys.fixed),
            value: 'fixed',
          }
        : {
            desc: t('permission.page.groupDevicePolicyUnset'),
            disabled: true,
            icon: LockIcon,
            label: t(labelKeys.fixed),
            value: 'fixed',
          },
    ],
    [canFixExecutionTarget, labelKeys, t],
  );

  if (sections.showPersonalEmpty) {
    return (
      <Empty
        description={t('permission.page.groupPersonalDesc')}
        icon={LockIcon}
        title={t('permission.page.groupPersonalTitle')}
        type={'page'}
      />
    );
  }

  const memberGroup: FormGroupItemType | undefined = sections.showAccessCard
    ? {
        children: [
          {
            avatar: (
              <span className={styles.rowIcon}>
                <Icon icon={UsersIcon} size={16} />
              </span>
            ),
            children: (
              <PolicySelect
                // Not disabled while the write is in flight: the level updates
                // optimistically and a failure rolls back with a toast, so
                // greying the control out only adds a visible dead beat — the
                // policies next to it behave the same way.
                disabled={!canManageAccess}
                loading={accessLoading}
                options={accessOptions}
                value={accessLevel}
                onChange={setAccessLevel}
              />
            ),
            desc: t(sections.accessDescKey),
            label: t('permission.page.accessLevelLabel'),
          },
        ],
        title: t('permission.page.memberGroup'),
      }
    : undefined;

  // Both rows write to the supervisor agent. Until group detail resolves one
  // there is no row to write to, so the whole card waits rather than offering
  // controls whose save would silently target nothing.
  const configGroup: FormGroupItemType | undefined = sections.showConfigCard
    ? {
        children: [
          {
            avatar: (
              <span className={styles.rowIcon}>
                <Icon icon={Bot} size={16} />
              </span>
            ),
            children: (
              <PolicySelect
                disabled={!canEditConfig}
                options={modelPolicyOptions}
                value={modelPolicy}
                onChange={setModelPolicy}
              />
            ),
            desc: t('permission.page.groupModelPolicyDesc'),
            label: t('settingAgent.modelPolicy.title'),
          },
          {
            avatar: (
              <span className={styles.rowIcon}>
                <Icon icon={MonitorSmartphone} size={16} />
              </span>
            ),
            children: (
              <PolicySelect
                disabled={!canEditConfig}
                options={executionPolicyOptions}
                value={executionTargetPolicy}
                onChange={setExecutionTargetPolicy}
              />
            ),
            desc: t('permission.page.groupDevicePolicyDesc'),
            label: t('settingAgent.devicePolicy.title'),
          },
        ],
        title: t('permission.page.configGroup'),
      }
    : undefined;

  return (
    <>
      {/* A failed permission fetch must not read as "this group has no member
          permissions" — name the failure and keep a way back to the data. */}
      {accessError ? (
        <AsyncError error={accessError} variant={'inline'} onRetry={retryAccess} />
      ) : null}
      {/* Everything below describes what happens once the group is shared, so
          say that once, up front, instead of qualifying each control. */}
      {sections.showPrivateNotice ? (
        <Alert
          icon={<Icon icon={InfoIcon} />}
          style={{ width: '100%' }}
          title={t('permission.page.groupPrivateNotice')}
          type={'info'}
          variant={'outlined'}
        />
      ) : null}
      <Form
        collapsible={false}
        items={[...(memberGroup ? [memberGroup] : []), ...(configGroup ? [configGroup] : [])]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </>
  );
});

PermissionForm.displayName = 'GroupPermissionForm';

export default PermissionForm;
