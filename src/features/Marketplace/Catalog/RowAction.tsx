'use client';

import { ActionIcon, Center, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { CheckIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';

interface RowActionProps {
  addLabel: string;
  disabled?: boolean;
  installed?: boolean;
  installedLabel: string;
  loading?: boolean;
  onAdd: () => void;
}

/**
 * The one trailing action of a catalog row, as in Codex: `+` adds the item,
 * a check says it is already in the library. Its clicks never reach the row
 * (which opens the detail).
 */
const RowAction = memo<RowActionProps>(
  ({ addLabel, disabled, installed, installedLabel, loading, onAdd }) => {
    if (installed)
      return (
        <Tooltip title={installedLabel}>
          <Center aria-label={installedLabel} height={28} role={'img'} width={28}>
            <Icon icon={CheckIcon} size={18} style={{ color: cssVar.colorSuccess }} />
          </Center>
        </Tooltip>
      );

    return (
      <ActionIcon
        disabled={disabled}
        icon={PlusIcon}
        loading={loading}
        title={addLabel}
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      />
    );
  },
);

RowAction.displayName = 'MarketplaceCatalogRowAction';

export default RowAction;
