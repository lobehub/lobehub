'use client';

import { Block, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleCheck, CircleX, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

/**
 * Acceptance lifecycle states worth surfacing on the Task page.
 *
 * The task badge can only say `paused` (rendered as 待审阅), so a delivery being
 * repaired, waiting on the user, or already sent back are indistinguishable from
 * there. `TaskAcceptance` already loads the whole bundle — this just stops
 * throwing `acceptance.status` away.
 */
const STATUS_META = {
  accepted: {
    color: cssVar.colorSuccess,
    icon: CircleCheck,
    labelKey: 'acceptance.status.accepted',
  },
  delivered: {
    color: cssVar.colorWarning,
    icon: Loader2,
    labelKey: 'acceptance.status.delivered',
  },
  errored: { color: cssVar.colorError, icon: CircleX, labelKey: 'acceptance.status.errored' },
  failed: { color: cssVar.colorError, icon: CircleX, labelKey: 'acceptance.status.failed' },
  rejected: { color: cssVar.colorError, icon: RotateCcw, labelKey: 'acceptance.status.rejected' },
  repairing: {
    color: cssVar.colorWarning,
    icon: RefreshCw,
    labelKey: 'acceptance.status.repairing',
    spin: true,
  },
  verifying: {
    color: cssVar.colorInfo,
    icon: Loader2,
    labelKey: 'acceptance.status.verifying',
    spin: true,
  },
} as const;

interface TaskAcceptanceHeaderProps {
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  /** Acceptance aggregate status; omitted while the bundle is still loading. */
  status?: string;
}

/** Canonical Task detail header shared by acceptance definition and result modes. */
export const TaskAcceptanceHeader = memo<TaskAcceptanceHeaderProps>(
  ({ count, isOpen, onToggle, status }) => {
    const { t } = useTranslation(['chat', 'verify']);
    const meta = status ? STATUS_META[status as keyof typeof STATUS_META] : undefined;

    return (
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        style={{ cursor: 'pointer', width: 'fit-content' }}
        variant={'borderless'}
        onClick={onToggle}
      >
        <Icon color={cssVar.colorTextDescription} icon={ShieldCheck} size={16} />
        <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
          {t('taskDetail.acceptance.title')}
        </Text>
        {Boolean(count) && <Tag size={'small'}>{count}</Tag>}
        {meta && (
          <Tag
            icon={<Icon icon={meta.icon} size={11} spin={'spin' in meta && meta.spin} />}
            size={'small'}
          >
            <span style={{ color: meta.color }}>{t(meta.labelKey, { ns: 'verify' })}</span>
          </Tag>
        )}
        <AccordionArrowIcon isOpen={isOpen} style={{ color: cssVar.colorTextDescription }} />
      </Block>
    );
  },
);

TaskAcceptanceHeader.displayName = 'TaskAcceptanceHeader';
