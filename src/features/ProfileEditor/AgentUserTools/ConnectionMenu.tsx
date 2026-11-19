'use client';

import { ActionIcon, Center, DropdownMenu, Icon } from '@lobehub/ui';
import {
  LibraryIcon,
  MoreHorizontalIcon,
  Settings2Icon,
  Trash2Icon,
  UserRoundPlusIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { isComposioConnection, useOwnConnection } from './useOwnConnection';

interface ConnectionMenuProps {
  agentId: string;
  /** The library offers this tool, so giving up the own connection falls back to it. */
  fallbackConnectionId?: string;
  /** The library's connection, when the agent may take one of its own from it. */
  libraryConnection?: ConnectorWithTools;
  /** The agent's own connection, when the current person may manage it. */
  ownConnection?: ConnectorWithTools;
}

/**
 * The "…" of a tool row: what can be done about the connection it runs on. A row with nothing
 * to choose (a built-in tool, a plugin, a connection someone else manages) has no menu.
 */
const ConnectionMenu = ({
  agentId,
  fallbackConnectionId,
  libraryConnection,
  ownConnection,
}: ConnectionMenuProps) => {
  const { t } = useTranslation('setting');
  const inWorkspace = !!useActiveWorkspaceId();
  const { create, manage, remove, revertToLibrary } = useOwnConnection(agentId);

  const items = ownConnection
    ? [
        {
          icon: <Icon icon={Settings2Icon} />,
          key: 'manage',
          label: t('settingAgent.tools.connection.manage'),
          onClick: () => manage(ownConnection),
        },
        fallbackConnectionId
          ? {
              icon: <Icon icon={LibraryIcon} />,
              key: 'useLibrary',
              label: t(
                inWorkspace
                  ? 'settingAgent.tools.connection.useWorkspace'
                  : 'settingAgent.tools.connection.useLibrary',
              ),
              onClick: () => revertToLibrary(ownConnection, fallbackConnectionId),
            }
          : {
              danger: true,
              icon: <Icon icon={Trash2Icon} />,
              key: 'remove',
              label: t('settingAgent.tools.remove'),
              onClick: () => remove(ownConnection),
            },
      ]
    : libraryConnection
      ? [
          {
            desc: t('settingAgent.tools.connection.createDesc'),
            icon: <Icon icon={UserRoundPlusIcon} />,
            key: 'create',
            label: t(
              isComposioConnection(libraryConnection)
                ? 'settingAgent.tools.connection.createAccount'
                : 'settingAgent.tools.connection.create',
            ),
            onClick: () => void create(libraryConnection),
          },
        ]
      : [];

  // The slot keeps its width when empty, so the kind labels of every row stay in one column.
  return (
    <Center flex={'none'} width={24}>
      {items.length > 0 ? (
        <DropdownMenu items={items} placement={'bottomRight'}>
          <ActionIcon
            aria-label={t('settingAgent.tools.connection.menu')}
            icon={MoreHorizontalIcon}
            size={'small'}
            title={t('settingAgent.tools.connection.menu')}
          />
        </DropdownMenu>
      ) : null}
    </Center>
  );
};

export default ConnectionMenu;
