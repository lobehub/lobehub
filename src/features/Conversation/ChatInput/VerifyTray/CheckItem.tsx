'use client';

import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDown, ChevronRight, CircleDashed, PencilIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCheckEditModal } from './EditModal';
import type { TrayCheck } from './types';

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    padding-block: 2px 4px;
    padding-inline-start: 22px;
  `,
  head: css`
    cursor: pointer;
    user-select: none;
  `,
  method: css`
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding-block: 6px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover .verify-tray-row-edit {
      opacity: 1;
    }
  `,
  rowEdit: css`
    opacity: 0;
    transition: opacity 0.15s;
  `,
  secLabel: css`
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
}));

interface CheckItemProps {
  check: TrayCheck;
  onRemove: () => void;
  onUpdate: (patch: Partial<Omit<TrayCheck, 'id'>>) => void;
}

const CheckItem = memo<CheckItemProps>(({ check, onRemove, onUpdate }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);

  return (
    <Flexbox className={styles.row} gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.head}
        gap={8}
        justify={'space-between'}
        onClick={() => setOpen(!open)}
      >
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          {/* Draft item has no verdict yet — a neutral glyph, not a false pass/fail. */}
          <Icon color={cssVar.colorTextQuaternary} icon={CircleDashed} size={14} />
          <Text ellipsis fontSize={13}>
            {check.name}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4} style={{ flexShrink: 0 }}>
          <Tooltip title={t('acceptance.tray.editModal.editTitle')}>
            <ActionIcon
              className={cx('verify-tray-row-edit', styles.rowEdit)}
              icon={PencilIcon}
              size={'small'}
              onClick={(e) => {
                e.stopPropagation();
                openCheckEditModal({ initial: check, onRemove, onSubmit: onUpdate });
              }}
            />
          </Tooltip>
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={open ? ChevronDown : ChevronRight}
            size={14}
          />
        </Flexbox>
      </Flexbox>

      {open && (
        <Flexbox className={styles.detail} gap={5}>
          <Text className={styles.secLabel}>{t('acceptance.tray.section.method')}</Text>
          <Text className={styles.method} fontSize={12}>
            {check.method || t('acceptance.tray.section.methodEmpty')}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

CheckItem.displayName = 'VerifyTrayCheckItem';

export default CheckItem;
