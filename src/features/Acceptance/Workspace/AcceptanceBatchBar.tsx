'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheck, Trash2, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    flex: none;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface AcceptanceBatchBarProps {
  /** Selected rows the accept sweep can actually move. */
  acceptCount: number;
  /** Selected rows the close sweep can actually move. */
  closeCount: number;
  onAccept: () => void;
  onClose: () => void;
  onDelete: () => void;
  pending: boolean;
}

/**
 * The multi-select action strip, docked under the acceptance list.
 *
 * Each status action is disabled when nothing in the selection can take it —
 * an already-accepted delivery cannot be accepted again — so a live button is
 * always a button that will change something. Delete stays an icon: it is the
 * destructive one and must not read as a peer of the two routine sweeps.
 */
const AcceptanceBatchBar = memo<AcceptanceBatchBarProps>(
  ({ acceptCount, closeCount, onAccept, onClose, onDelete, pending }) => {
    const { t } = useTranslation('verify');

    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={6}>
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
