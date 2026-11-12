'use client';

import { ActionIcon, Button, DropdownMenu, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck, FolderInput, Trash2, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceProjectMenu } from './useAcceptanceProjectMenuItem';

const styles = stylex.create({
  bar: {
    flex: 'none',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface AcceptanceBatchBarProps {
  /** Selected rows the accept sweep can actually move. */
  acceptCount: number;
  /** Whether any selected row is filed under a project, so "remove" has work. */
  canRemoveProject: boolean;
  /** Selected rows the close sweep can actually move. */
  closeCount: number;
  onAccept: () => void;
  onClose: () => void;
  onDelete: () => void;
  /** `null` takes the selection out of its projects. */
  onMoveToProject: (projectId: string | null) => void;
  pending: boolean;
}

/**
 * The multi-select action strip, docked under the acceptance list.
 *
 * Each status action is disabled when nothing in the selection can take it —
 * an already-accepted delivery cannot be accepted again — so a live button is
 * always a button that will change something. The move action opens the same
 * project menu a single row offers; which rows a given project can actually
 * move is only known once a target is picked, so the button itself only waits
 * on the selection. Move and delete stay icons: the bar lives in a panel that
 * narrows to 260px, and a third labeled button would spill out of it.
 */
const AcceptanceBatchBar = memo<AcceptanceBatchBarProps>(
  ({
    acceptCount,
    canRemoveProject,
    closeCount,
    onAccept,
    onClose,
    onDelete,
    onMoveToProject,
    pending,
  }) => {
    const { t } = useTranslation('verify');
    const projectMenu = useAcceptanceProjectMenu({
      onSelect: onMoveToProject,
      showRemove: canRemoveProject,
    });

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.bar).className} gap={6}>
        <Button
          disabled={pending || acceptCount === 0}
          icon={CircleCheck}
          size={'small'}
          type={'fill'}
          onClick={onAccept}
        >
          {t('acceptance.workspace.batch.accept')}
        </Button>
        <Button
          disabled={pending || closeCount === 0}
          icon={X}
          size={'small'}
          type={'fill'}
          onClick={onClose}
        >
          {t('acceptance.workspace.batch.close')}
        </Button>
        <DropdownMenu
          items={projectMenu.items}
          placement={'topLeft'}
          popupProps={{ style: { minWidth: 160 } }}
          onOpenChange={projectMenu.onOpenChange}
        >
          <ActionIcon
            disabled={pending}
            icon={FolderInput}
            size={'small'}
            title={t('acceptance.workspace.batch.move')}
          />
        </DropdownMenu>
        <Flexbox flex={1} />
        <ActionIcon
          danger
          disabled={pending}
          icon={Trash2}
          size={'small'}
          title={t('acceptance.workspace.actions.delete')}
          onClick={onDelete}
        />
      </Flexbox>
    );
  },
);

AcceptanceBatchBar.displayName = 'AcceptanceBatchBar';

export default AcceptanceBatchBar;
