'use client';

import { type EnvironmentKind } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AppWindowMacIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleStopIcon,
  CopyPlusIcon,
  FolderIcon,
  MoreVerticalIcon,
} from 'lucide-react';
import { memo, type ReactNode, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import OptionRow from './OptionRow';
import {
  copyMenuActions,
  type EnvironmentRowState,
  isCopyBuilding,
  isCopyOccupied,
  type PickerCopy,
} from './sandboxEnvironmentRows';

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  inlineCopies: css`
    margin-inline-start: 18px;
    padding-inline-start: 8px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  option: css`
    && {
      padding-inline: 0;
    }
  `,
  submenuArrow: css`
    display: flex;
    align-items: center;
    color: ${cssVar.colorTextQuaternary};
  `,
  submenuTitle: css`
    padding-block: 4px;
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

/**
 * Desktop pointers open a second menu on hover; touch screens and narrow
 * windows have no hover and no room beside the menu, so there the row's arrow
 * expands the copies in place instead.
 */
const HOVER_SUBMENU_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 768px)';

const subscribeHoverQuery = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(HOVER_SUBMENU_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const readHoverQuery = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? true
    : window.matchMedia(HOVER_SUBMENU_QUERY).matches;

export const useHoverSubmenu = () =>
  useSyncExternalStore(subscribeHoverQuery, readHoverQuery, () => true);

/** A listed copy, as the picker receives it from `listInstances`. */
export interface SandboxPickerCopy extends PickerCopy {
  isDefault: boolean;
  name: string;
  workingDirectory: string;
}

export interface SandboxEnvironmentRowProps {
  boundInstanceId?: string;
  /** The environment's preparation is in flight: a lazy creation or another copy. */
  busy?: boolean;
  environment: { id: string; name: string };
  isCreator: boolean;
  kind: EnvironmentKind;
  onReopen: () => void;
  onSelectCopy: (copy: SandboxPickerCopy) => void;
  /** Picks an environment with no copy yet — its creator's copy is made first. */
  onSelectLazy: () => void;
  onStop: (copy: SandboxPickerCopy) => void;
  /** The repository path the environment builds from, when it is one. */
  repository?: string;
  row: EnvironmentRowState<SandboxPickerCopy>;
  /** Copies whose run is being stopped from this menu. */
  stopping: (id: string) => boolean;
}

/**
 * One environment in the composer's picker, and — only when it has more than
 * one copy — the copies under it.
 *
 * The row is what people choose. Which copy that lands the conversation in is
 * decided by `describeEnvironmentRow`, and the second menu exists for the rare
 * person who wants a specific one: a single copy needs no menu to choose it.
 */
const SandboxEnvironmentRow = memo<SandboxEnvironmentRowProps>(
  ({
    boundInstanceId,
    busy,
    environment,
    isCreator,
    kind,
    onReopen,
    onSelectCopy,
    onSelectLazy,
    onStop,
    repository,
    row,
    stopping,
  }) => {
    const { t } = useTranslation('chat');
    const hoverSubmenu = useHoverSubmenu();
    const [expanded, setExpanded] = useState(false);

    const icon = (size: number): ReactNode =>
      repository ? (
        <Github size={size} />
      ) : (
        <Icon icon={kind === 'files' ? FolderIcon : AppWindowMacIcon} size={size} />
      );

    const statusTag = (copy: SandboxPickerCopy | undefined): ReactNode => {
      if (!copy) return undefined;
      if (isCopyBuilding(copy)) return t('sandboxStorage.building');
      if (copy.status === 'error') return t('sandboxStorage.buildFailed');
      if (!copy.inUse) return undefined;

      const occupied = isCopyOccupied(copy);
      const stoppable = occupied && copyMenuActions({ copy, isCreator, kind }).includes('stop');

      // "Running" alone reads as a state, not as the reason the row cannot be
      // picked — the tooltip says how long that lasts, and, for the creator,
      // that it can be ended now from the menu beside it.
      return (
        <Tooltip
          title={t(
            !occupied
              ? 'sandboxStorage.runningOwnHint'
              : stoppable
                ? 'sandboxStorage.runningHintStoppable'
                : 'sandboxStorage.runningHint',
          )}
        >
          <span>{t('sandboxStorage.running')}</span>
        </Tooltip>
      );
    };

    // The menu the stop shipped in, with "open another copy" below it. The same
    // menu on the environment row (acting on the copy the row shows) and on
    // every copy row, so the way out of a busy copy is where the person found it.
    const menu = (copy: SandboxPickerCopy | undefined) => {
      const actions = copyMenuActions({ copy, isCreator, kind });
      if (actions.length === 0) return undefined;

      const isStopping = copy ? stopping(copy.id) : false;

      return (
        <DropdownMenu
          items={actions.map((action) =>
            action === 'stop'
              ? {
                  disabled: isStopping,
                  icon: CircleStopIcon,
                  key: 'stop',
                  label: t('sandboxStorage.stop'),
                  onClick: () => copy && onStop(copy),
                }
              : {
                  desc: t('sandboxStorage.reopenCopyDesc'),
                  disabled: busy,
                  icon: CopyPlusIcon,
                  key: 'reopen',
                  label: t('sandboxStorage.reopenCopy'),
                  onClick: onReopen,
                },
          )}
        >
          <ActionIcon
            data-testid={`sandbox-env-menu-${copy?.id ?? environment.id}`}
            disabled={isStopping}
            icon={MoreVerticalIcon}
            loading={isStopping || busy}
            size={'small'}
          />
        </DropdownMenu>
      );
    };

    const copyRow = (copy: SandboxPickerCopy) => {
      const active = copy.id === boundInstanceId;
      const unavailable = isCopyOccupied(copy) || isCopyBuilding(copy);

      return (
        <OptionRow
          active={active}
          className={styles.option}
          desc={<span className={styles.desc}>{copy.workingDirectory}</span>}
          // Already this conversation's own copy: it stays selectable however
          // the lease reads — "you cannot pick what you are already using" is
          // never the right thing to say.
          disabled={unavailable && !active}
          extra={menu(copy)}
          icon={icon(16)}
          key={copy.id}
          label={copy.name}
          tags={[copy.isDefault ? t('sandboxStorage.defaultCopy') : null, statusTag(copy)].filter(
            Boolean,
          )}
          onClick={() => onSelectCopy(copy)}
        />
      );
    };

    const copyList = (
      <Flexbox data-testid={`sandbox-env-copies-${environment.id}`} gap={2}>
        {row.copies.map((copy) => copyRow(copy))}
      </Flexbox>
    );

    const displayed = row.displayed;
    const desc = row.lazyCreate
      ? t('sandboxStorage.noCopyYetDesc')
      : row.copies.length === 0
        ? t('sandboxStorage.noCopyColleagueDesc')
        : row.hasSubmenu
          ? `${displayed?.name} · ${t('sandboxStorage.copyCount', { count: row.copies.length })}`
          : displayed?.workingDirectory;

    const arrow = row.hasSubmenu ? (
      hoverSubmenu ? (
        <span className={styles.submenuArrow}>
          <Icon icon={ChevronRightIcon} size={14} />
        </span>
      ) : (
        <ActionIcon
          aria-expanded={expanded}
          data-testid={`sandbox-env-expand-${environment.id}`}
          icon={expanded ? ChevronDownIcon : ChevronRightIcon}
          size={'small'}
          title={t('sandboxStorage.showCopies')}
          onClick={() => setExpanded((value) => !value)}
        />
      )
    ) : undefined;

    const menuButton = menu(displayed);
    const extra =
      menuButton || arrow ? (
        <>
          {menuButton}
          {arrow}
        </>
      ) : undefined;

    const environmentRow = (
      <OptionRow
        active={row.copies.some((copy) => copy.id === boundInstanceId)}
        className={styles.option}
        desc={<span className={styles.desc}>{desc}</span>}
        disabled={!row.selectable || busy}
        extra={extra}
        icon={icon(16)}
        label={environment.name}
        tags={[
          t(kind === 'files' ? 'sandboxStorage.kind.files' : 'sandboxStorage.kind.code'),
          statusTag(displayed),
        ].filter(Boolean)}
        onClick={() => {
          if (row.lazyCreate) onSelectLazy();
          else if (row.picked) onSelectCopy(row.picked);
        }}
      />
    );

    if (!row.hasSubmenu)
      return <div data-testid={`sandbox-env-row-${environment.id}`}>{environmentRow}</div>;

    if (hoverSubmenu)
      return (
        <Popover
          arrow={false}
          placement={'rightTop'}
          trigger={'hover'}
          content={
            <Flexbox gap={2} style={{ maxWidth: 320, minWidth: 240 }}>
              <div className={styles.submenuTitle}>{t('sandboxStorage.copies')}</div>
              {copyList}
            </Flexbox>
          }
        >
          <div data-testid={`sandbox-env-row-${environment.id}`}>{environmentRow}</div>
        </Popover>
      );

    return (
      <div data-testid={`sandbox-env-row-${environment.id}`}>
        {environmentRow}
        {expanded && <div className={styles.inlineCopies}>{copyList}</div>}
      </div>
    );
  },
);

SandboxEnvironmentRow.displayName = 'SandboxEnvironmentRow';

export default SandboxEnvironmentRow;
