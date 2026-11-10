'use client';

import type { LinearConnectionView } from '@lobechat/types';
import { ActionIcon, Button, DropdownMenu, Icon } from '@lobehub/ui';
import { DownloadIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import LinearIcon from '@/features/Integrations/Linear/LinearIcon';

import { openLinearIssueImportModal } from './openImportModal';

interface ImportTriggerProps {
  connections: LinearConnectionView[];
  disabled?: boolean;
  onSynced?: () => void;
  projectId: string;
  /** A labelled button in settings, or a bare Linear icon in a page header. */
  variant: 'button' | 'icon';
}

/**
 * Opens the import dialog for this project. With several connected Linear
 * workspaces it first asks which one.
 */
const ImportTrigger = memo<ImportTriggerProps>(
  ({ connections, disabled, onSynced, projectId, variant }) => {
    const { t } = useTranslation('integration');
    const open = (connection: LinearConnectionView) =>
      openLinearIssueImportModal({ connection, onSynced, projectId });

    const single = connections.length === 1 ? connections[0] : undefined;
    const onClick = single ? () => open(single) : undefined;
    const trigger: ReactNode =
      variant === 'icon' ? (
        <ActionIcon
          aria-label={t('linear.sync.project.entry')}
          disabled={disabled}
          icon={LinearIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('linear.sync.project.entry')}
          onClick={onClick}
        />
      ) : (
        <Button disabled={disabled} icon={<Icon icon={DownloadIcon} />} onClick={onClick}>
          {t('linear.sync.importIssues')}
        </Button>
      );

    if (single || disabled) return trigger;

    return (
      <DropdownMenu
        placement={'bottomRight'}
        items={connections.map((connection) => ({
          key: connection.id,
          label: connection.organizationName,
          onClick: () => open(connection),
        }))}
      >
        {trigger}
      </DropdownMenu>
    );
  },
);

ImportTrigger.displayName = 'LinearImportTrigger';

export default ImportTrigger;
