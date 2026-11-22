'use client';

import type { HeteroPermissionMode } from '@lobechat/types';
import { HETERO_PERMISSION_MODES } from '@lobechat/types';
import { type DropdownItem } from '@lobehub/ui';
import { Button, Center, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Check,
  ChevronDown,
  ClipboardList,
  FilePen,
  Hand,
  type LucideIcon,
  ShieldOff,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { densityTokens } from '@/styles/density.stylex';

import { usePermissionMode } from './usePermissionMode';

const MODE_ICONS: Record<HeteroPermissionMode, LucideIcon> = {
  acceptEdits: FilePen,
  auto: Sparkles,
  bypassPermissions: ShieldOff,
  default: Hand,
  plan: ClipboardList,
};

const styles = stylex.create({
  desc: { fontSize: '12px', lineHeight: 1.4, color: cssVar.colorTextDescription },
  icon: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  label: {
    display: {
      'default': null,
      '@container runtimebar (width < 600px)': 'none',
    },
  },
  modeButton: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
  notice: {
    maxWidth: '280px',
    paddingBlock: '4px',
    paddingInline: '4px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorWarning,
  },
  title: {
    fontSize: densityTokens['--lobe-density-font-size'],
    fontWeight: 500,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
  trigger: { overflow: 'hidden', borderRadius: cssVar.borderRadius },
  warning: { color: cssVar.colorWarning },
});

const ModeItemLabel = memo<{ desc: string; icon: LucideIcon; title: string }>(
  ({ desc, icon, title }) => (
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Center className={stylex.props(styles.icon).className} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1} style={{ minWidth: 160 }}>
        <div {...stylex.props(styles.title)}>{title}</div>
        <div {...stylex.props(styles.desc)}>{desc}</div>
      </Flexbox>
    </Flexbox>
  ),
);

interface PermissionModeSelectorProps {
  agentId: string;
  topicId: string | null | undefined;
}

/**
 * The composer's Claude Code permission mode (Better Coding Experience lab).
 * The chip names the mode the topic's run is in; when that is not the picked
 * one (root, an outdated `lh`), it says why.
 */
const PermissionModeSelector = memo<PermissionModeSelectorProps>(({ agentId, topicId }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const { fallback, mode, runningMode, select, switchPending } = usePermissionMode(
    agentId,
    topicId,
  );

  const title = useCallback(
    (value: HeteroPermissionMode) => t(`heteroAgent.permissionMode.${value}.title`),
    [t],
  );
  const notice = switchPending
    ? t('heteroAgent.permissionMode.switchPendingNotice', {
        next: title(mode),
        running: title(runningMode),
      })
    : fallback
      ? t(`heteroAgent.permissionMode.fallback.${fallback}`, { mode: title(mode) })
      : undefined;
  const warn = switchPending || !!fallback;

  const items: DropdownItem[] = [
    ...(notice
      ? [
          {
            disabled: true,
            key: 'notice',
            label: <div {...stylex.props(styles.notice)}>{notice}</div>,
          } satisfies DropdownItem,
          { type: 'divider' as const },
        ]
      : []),
    ...HETERO_PERMISSION_MODES.map((value) => ({
      extra: value === mode ? <Icon icon={Check} /> : undefined,
      key: value,
      label: (
        <ModeItemLabel
          desc={t(`heteroAgent.permissionMode.${value}.desc`)}
          icon={MODE_ICONS[value]}
          title={title(value)}
        />
      ),
      onClick: () => void select(value),
    })),
  ];

  const button = (
    <Button
      aria-label={t('heteroAgent.permissionMode.label')}
      className={stylex.props(styles.modeButton).className}
      icon={ChevronDown}
      iconPosition="end"
      size="small"
      type={'text'}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon
          icon={warn ? TriangleAlert : MODE_ICONS[runningMode]}
          size={14}
          {...(warn ? stylex.props(styles.warning) : {})}
        />
        <span {...stylex.props(styles.label)}>{title(runningMode)}</span>
      </Flexbox>
    </Button>
  );

  return (
    <DropdownMenu items={items} open={open} placement="topRight" onOpenChange={setOpen}>
      <div data-testid={'hetero-permission-mode'} {...stylex.props(styles.trigger)}>
        {open ? (
          button
        ) : (
          <Tooltip title={notice ?? t('heteroAgent.permissionMode.tooltip')}>{button}</Tooltip>
        )}
      </div>
    </DropdownMenu>
  );
});

PermissionModeSelector.displayName = 'PermissionModeSelector';

export default PermissionModeSelector;
