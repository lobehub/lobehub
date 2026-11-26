'use client';

import { Button, Icon } from '@lobehub/ui';
import { type FormGroupItem } from '@lobehub/ui/form';
import * as stylex from '@stylexjs/stylex';
import { GlobeIcon, LockIcon, UserRoundPlus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentTransferToMemberAction } from '@/business/client/hooks/useAgentTransferToMemberAction';
import {
  type AgentVisibilityOption,
  useAgentVisibilityControl,
} from '@/features/AgentVisibility/useAgentVisibilityControl';
import PolicySelect, { type PolicyOption } from '@/features/ResourcePermission/PolicySelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const styles = stylex.create({
  // Same one-line-icon alignment as the other rows of the Permission form.
  rowIcon: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    display: 'flex',
    height: '1em',
  },
});

/**
 * The "Visibility & ownership" card of the Agent Permission page: the
 * Private / Workspace scope and the handover to another member. Both used to
 * sit in the sidebar row menu; the gates are the same as there, and a viewer
 * who may not act sees the scope read-only and no transfer row at all.
 */
export const useSharingGroup = (agentId: string): FormGroupItem | undefined => {
  const { t } = useTranslation(['setting', 'chat', 'agent']);
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId));

  const visibility = useAgentVisibilityControl({
    id: agentId,
    slug: agent?.slug,
    userId: agent?.userId,
    visibility: agent?.visibility,
  });

  const openTransfer = useAgentTransferToMemberAction(
    agentId,
    {
      avatar: agent?.avatar ?? undefined,
      backgroundColor: agent?.backgroundColor ?? undefined,
      title: agent?.title ?? undefined,
    },
    { userId: agent?.userId, visibility: agent?.visibility },
  );

  const visibilityOptions = useMemo(
    (): PolicyOption<AgentVisibilityOption>[] => [
      {
        desc: t('agent.visibility.privateDesc', { ns: 'chat' }),
        icon: LockIcon,
        label: t('agent.visibility.private', { ns: 'chat' }),
        value: 'private',
      },
      {
        desc: t('agent.visibility.workspaceDesc', { ns: 'chat' }),
        icon: GlobeIcon,
        label: t('agent.visibility.workspace', { ns: 'chat' }),
        value: 'public',
      },
    ],
    [t],
  );

  const { canChange, current, lockReason, select } = visibility;

  const visibilityRow = current
    ? {
        avatar: (
          <span {...stylex.props(styles.rowIcon)}>
            <Icon icon={current === 'private' ? LockIcon : GlobeIcon} size={16} />
          </span>
        ),
        children: (
          <PolicySelect
            disabled={!canChange}
            options={visibilityOptions}
            value={current}
            onChange={select}
          />
        ),
        desc:
          lockReason === 'builtin'
            ? t('permission.page.visibilityBuiltinDesc')
            : lockReason === 'notCreator'
              ? t('permission.page.visibilityCreatorOnlyDesc')
              : t('permission.page.visibilityDesc'),
        label: t('agent.visibility', { ns: 'chat' }),
      }
    : undefined;

  const transferRow = openTransfer
    ? {
        avatar: (
          <span {...stylex.props(styles.rowIcon)}>
            <Icon icon={UserRoundPlus} size={16} />
          </span>
        ),
        children: (
          <Button onClick={openTransfer}>{t('transfer.transferToMember', { ns: 'agent' })}</Button>
        ),
        desc: t('permission.page.transferDesc'),
        label: t('permission.page.transferLabel'),
      }
    : undefined;

  const children = [visibilityRow, transferRow].filter((row) => !!row);
  if (children.length === 0) return;

  return { children, title: t('permission.page.sharingGroup') };
};
