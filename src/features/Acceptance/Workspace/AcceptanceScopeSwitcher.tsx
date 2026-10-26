'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { DropdownItem } from '@lobehub/ui';
import { Avatar, Button, DropdownMenu, Icon } from '@lobehub/ui';
import { Check, ChevronsUpDown } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

import { acceptanceListPath } from '../Viewer/routes';

/**
 * Switches the acceptance list between personal and workspace scope. The URL
 * is the source of truth for the active workspace, so switching is navigation:
 * `/acceptance` is personal, `/:workspaceSlug/acceptance` is that workspace.
 * Renders nothing when the user belongs to no workspace.
 */
const AcceptanceScopeSwitcher = memo(() => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();

  const items = useMemo<DropdownItem[]>(() => {
    const check = (selected: boolean) =>
      selected ? <Icon icon={Check} size={14} /> : <span style={{ width: 14 }} />;
    return [
      {
        extra: check(!active),
        key: '__personal__',
        label: t('acceptance.workspace.scope.personal'),
        onClick: () => navigate(acceptanceListPath()),
      },
      ...workspaces.map((workspace) => ({
        extra: check(active?.id === workspace.id),
        icon: <Avatar avatar={workspace.avatar || DEFAULT_AVATAR} shape={'square'} size={18} />,
        key: workspace.id,
        label: workspace.name,
        onClick: () => navigate(`/${workspace.slug}${acceptanceListPath()}`),
      })),
    ];
  }, [active, navigate, t, workspaces]);

  if (workspaces.length === 0) return null;

  return (
    <DropdownMenu items={items} placement={'bottomLeft'}>
      <Button
        aria-label={t('acceptance.workspace.scope.switch')}
        size={'small'}
        title={t('acceptance.workspace.scope.switch')}
        type={'text'}
      >
        {active?.name ?? t('acceptance.workspace.scope.personal')}
        <Icon icon={ChevronsUpDown} size={12} />
      </Button>
    </DropdownMenu>
  );
});

AcceptanceScopeSwitcher.displayName = 'AcceptanceScopeSwitcher';

export default AcceptanceScopeSwitcher;
