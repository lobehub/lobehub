'use client';

import type { AgentModelSelectionPolicy } from '@lobechat/types';
import type { FormGroupItemType } from '@lobehub/ui';
import { Alert, Empty, Form, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  Bot,
  EyeIcon,
  InfoIcon,
  LockIcon,
  MonitorSmartphone,
  PencilIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import type { ResourceAccessLevel } from '@/services/resourcePermission';

import PolicySelect, { type PolicyOption } from './PolicySelect';
import { getSelectionPolicyLabelKeys } from './selectionPolicyLabels';
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

  const accessOptions = useMemo((): PolicyOption<ResourceAccessLevel>[] => {
    // A private agent has no members yet, so the level names carry the same
    // "once shared" tense the switch policies already use; the descriptions
    // explain what the level itself means and stay as they are.
    const options: PolicyOption<ResourceAccessLevel>[] = [
      {
        desc: t('permission.generalAccess.editableDesc'),
        icon: PencilIcon,
        label: t(
          isPrivate ? 'permission.page.editableWhenShared' : 'permission.generalAccess.editable',
        ),
        value: 'edit',
      },
      {
        desc: t('permission.generalAccess.usableDesc'),
        icon: PlayIcon,
        label: t(
          isPrivate ? 'permission.page.usableWhenShared' : 'permission.generalAccess.usable',
        ),
        value: 'use',
      },
    ];

    // `view` is a document-only level, but a legacy row can still carry it —
    // list it so the control shows the real current value instead of blank.
    if (accessLevel === 'view') {
      options.push({
        desc: t('permission.generalAccess.viewableDesc'),
        icon: EyeIcon,
        label: t('permission.generalAccess.viewable'),
        value: 'view',
      });
    }

    return options;
  }, [accessLevel, isPrivate, t]);

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
            disabled={!canEditConfig}
            options={modelPolicyOptions}
            value={modelPolicy}
            onChange={setModelPolicy}
          />
        ),
        desc: t('permission.page.modelPolicyDesc'),
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
        desc: t('permission.page.devicePolicyDesc'),
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
