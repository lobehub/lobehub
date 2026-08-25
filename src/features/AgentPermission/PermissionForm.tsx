'use client';

import type { AgentModelSelectionPolicy, AgentTopicSharePolicy } from '@lobechat/types';
import type { FormGroupItemType } from '@lobehub/ui';
import { Empty, Form, Icon } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Bot, InfoIcon, LockIcon, MonitorSmartphone, Share2, UsersIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import PolicySelect, { type PolicyOption } from '@/features/ResourcePermission/PolicySelect';
import { getSelectionPolicyLabelKeys } from '@/features/ResourcePermission/selectionPolicyLabels';
import { useAccessLevelOptions } from '@/features/ResourcePermission/useAccessLevelOptions';

import { useAgentPermission } from './useAgentPermission';

const styles = createStaticStyles(({ css }) => ({
  // FormTitle centres the avatar against title+description; a one-line icon
  // should sit on the title instead, so pin it to the top and centre it inside
  // a box the height of the title's own line (`line-height: 1`, inherited size).
  rowIcon: css`
    display: flex;
    align-items: center;
    align-self: flex-start;
    height: 1em;
  `,
}));

interface PermissionFormProps {
  agentId: string;
}

const PermissionForm = memo<PermissionFormProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const {
    accessError,
    accessLevel,
    accessLoading,
    canEditConfig,
    canEditPolicies,
    canFixExecutionTarget,
    canManageAccess,
    executionTargetPolicy,
    isPrivate,
    isWorkspaceAgent,
    modelPolicy,
    retryAccess,
    setAccessLevel,
    setExecutionTargetPolicy,
    setModelPolicy,
    setTopicSharePolicy,
    topicSharePolicy,
  } = useAgentPermission(agentId);

  const labelKeys = getSelectionPolicyLabelKeys(isPrivate);

  // Same shape as the access-level options: the label is the decision, the
  // description says what it means for a member day to day.
  const modelPolicyOptions = useMemo(
    (): PolicyOption<AgentModelSelectionPolicy>[] => [
      {
        desc: t('permission.page.modelPolicyMemberDesc'),
        icon: UsersIcon,
        label: t(labelKeys.member),
        value: 'member',
      },
      {
        desc: t('permission.page.modelPolicyFixedDesc'),
        icon: LockIcon,
        label: t(labelKeys.fixed),
        value: 'fixed',
      },
    ],
    [labelKeys, t],
  );

  const accessOptions = useAccessLevelOptions({ accessLevel, isPrivate });

  // The three policy rows below share one authority: the server accepts them
  // only from the agent's creator or the workspace owner, and silently drops
  // them from anyone else's otherwise-successful save. Disable rather than
  // hide, so an Admin can see what exists and who to ask.
  const policiesDisabled = !canEditConfig || !canEditPolicies;

  // Deliberately not a `member`/`fixed` pair like the rows below: sharing is a
  // capability, not a setting members switch, so the labels name who may do it.
  const topicSharePolicyOptions = useMemo(
    (): PolicyOption<AgentTopicSharePolicy>[] => [
      {
        desc: t('permission.page.topicSharePolicyMemberDesc'),
        icon: UsersIcon,
        label: t('settingAgent.topicSharePolicy.membersCanShare'),
        value: 'member',
      },
      {
        desc: t('permission.page.topicSharePolicyRestrictedDesc'),
        icon: LockIcon,
        label: t('settingAgent.topicSharePolicy.membersCannotShare'),
        value: 'restricted',
      },
    ],
    [t],
  );

  const executionPolicyOptions = useMemo(
    (): PolicyOption<AgentModelSelectionPolicy>[] => [
      {
        desc: t('permission.page.devicePolicyMemberDesc'),
        icon: UsersIcon,
        label: t(labelKeys.member),
        value: 'member',
      },
      // Nothing to pin to yet — say so where the choice is made rather than
      // letting the click fail silently.
      canFixExecutionTarget
        ? {
            desc: t('permission.page.devicePolicyFixedDesc'),
            icon: LockIcon,
            label: t(labelKeys.fixed),
            value: 'fixed',
          }
        : {
            desc: t('permission.page.devicePolicyUnset'),
            disabled: true,
            icon: LockIcon,
            label: t(labelKeys.fixed),
            value: 'fixed',
          },
    ],
    [canFixExecutionTarget, labelKeys, t],
  );

  if (!isWorkspaceAgent) {
    return (
      <Empty
        description={t('permission.page.personalDesc')}
        icon={LockIcon}
        title={t('permission.page.personalTitle')}
        type={'page'}
      />
    );
  }

  const memberGroup: FormGroupItemType | undefined = !accessError
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
                // switch policies next to it behave the same way.
                disabled={!canManageAccess}
                loading={accessLoading}
                options={accessOptions}
                value={accessLevel}
                onChange={setAccessLevel}
              />
            ),
            desc: canManageAccess
              ? isPrivate
                ? t('permission.page.accessLevelPrivateHint')
                : t('permission.page.generalAccessDesc')
              : t('permission.noManagePermission'),
            label: t('permission.page.accessLevelLabel'),
          },
          // Sits under Access rather than in Editable settings: that card is
          // about run knobs a member may change for themselves, while this is
          // one more thing the workspace may or may not do with the agent —
          // exactly what the access row above already promises to describe.
          {
            avatar: (
              <span className={styles.rowIcon}>
                <Icon icon={Share2} size={16} />
              </span>
            ),
            children: (
              <PolicySelect
                disabled={policiesDisabled}
                options={topicSharePolicyOptions}
                value={topicSharePolicy}
                onChange={setTopicSharePolicy}
              />
            ),
            desc: canEditPolicies
              ? t('permission.page.topicSharePolicyDesc')
              : t('permission.noManagePermission'),
            label: t('settingAgent.topicSharePolicy.title'),
          },
        ],
        title: t('permission.page.memberGroup'),
      }
    : undefined;

  const configGroup: FormGroupItemType = {
    children: [
      {
        avatar: (
          <span className={styles.rowIcon}>
            <Icon icon={Bot} size={16} />
          </span>
        ),
        children: (
          <PolicySelect
            disabled={policiesDisabled}
            options={modelPolicyOptions}
            value={modelPolicy}
            onChange={setModelPolicy}
          />
        ),
        desc: canEditPolicies
          ? t('permission.page.modelPolicyDesc')
          : t('permission.noManagePermission'),
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
            disabled={policiesDisabled}
            options={executionPolicyOptions}
            value={executionTargetPolicy}
            onChange={setExecutionTargetPolicy}
          />
        ),
        desc: canEditPolicies
          ? t('permission.page.devicePolicyDesc')
          : t('permission.noManagePermission'),
        label: t('settingAgent.devicePolicy.title'),
      },
    ],
    title: t('permission.page.configGroup'),
  };

  return (
    <>
      {/* A failed permission fetch must not read as "this agent has no member
          permissions" — name the failure and keep a way back to the data. */}
      {accessError ? (
        <AsyncError error={accessError} variant={'inline'} onRetry={retryAccess} />
      ) : null}
      {/* Everything below describes what happens once the agent is shared, so
          say that once, up front, instead of qualifying each control. */}
      {isPrivate ? (
        <Alert
          icon={<Icon icon={InfoIcon} />}
          style={{ width: '100%' }}
          title={t('permission.page.privateNotice')}
          type={'info'}
          variant={'outlined'}
        />
      ) : null}
      <Form
        collapsible={false}
        items={[...(memberGroup ? [memberGroup] : []), configGroup]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </>
  );
});

PermissionForm.displayName = 'PermissionForm';

export default PermissionForm;
