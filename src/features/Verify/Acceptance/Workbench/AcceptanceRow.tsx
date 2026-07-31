'use client';

import type { AcceptanceStatus } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { confirmModal, DropdownMenu } from '@lobehub/ui/base-ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Icon from '@lobehub/ui/es/Icon/index';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { mutate as globalMutate } from 'swr';

import { verifyKeys } from '@/libs/swr/keys';
import type { AcceptanceListItem } from '@/services/verify';
import { verifyService } from '@/services/verify';

import { getAcceptanceStatusActions } from '../statusActions';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;

    text-align: start;
  `,
  editRow: css`
    padding-block: 4px;
    padding-inline: 4px;
  `,
  itemSub: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  itemTitleInput: css`
    width: 100%;
    min-width: 0;
    height: 32px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: 14px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &:focus {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  main: css`
    cursor: pointer;

    display: flex;
    flex: 1;
    gap: 10px;
    align-items: center;

    min-width: 0;
    padding: 0;
    border: 0;

    color: inherit;

    background: transparent;
  `,
  row: css`
    display: flex;
    gap: 6px;
    align-items: center;

    min-height: 52px;
    padding-block: 7px;
    padding-inline: 10px 6px;
    border-radius: ${cssVar.borderRadiusLG};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  spin: css`
    animation: acceptance-spin 1.1s linear infinite;

    @keyframes acceptance-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

type Glyph = 'accepted' | 'awaiting' | 'bad' | 'closed' | 'repairing' | 'running' | 'unsure';

const RUNNING_STATUSES = new Set<AcceptanceStatus>([
  'pending',
  'planned',
  'verifying',
  'repairing',
]);

const glyphOf = (status: AcceptanceStatus): Glyph => {
  if (status === 'repairing') return 'repairing';
  if (RUNNING_STATUSES.has(status)) return 'running';
  if (status === 'accepted') return 'accepted';
  if (status === 'closed') return 'closed';
  if (status === 'rejected') return 'bad';
  if (status === 'errored') return 'unsure';
  return 'awaiting';
};

const SPINNING_GLYPHS = new Set<Glyph>(['running', 'repairing']);

const glyphMeta: Record<Glyph, { color: string; icon: typeof BadgeCheck }> = {
  accepted: { color: cssVar.colorSuccess, icon: BadgeCheck },
  awaiting: { color: cssVar.colorInfo, icon: CircleDashed },
  bad: { color: cssVar.colorError, icon: CircleX },
  closed: { color: cssVar.colorTextTertiary, icon: X },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw },
  running: { color: cssVar.colorInfo, icon: LoaderCircle },
  unsure: { color: cssVar.colorWarning, icon: CircleHelp },
};

const relativeTime = (value?: Date | string | null) => {
  if (!value) return '';
  const date = dayjs(value);
  return dayjs().diff(date, 'day') < 7 ? date.fromNow() : date.format('MMM D');
};

interface AcceptanceRowProps {
  item: AcceptanceListItem;
  onChanged: () => Promise<unknown> | unknown;
}

const AcceptanceRow = memo<AcceptanceRowProps>(({ item, onChanged }) => {
  const { t } = useTranslation(['verify', 'common']);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const isSavingRef = useRef(false);

  const glyph = glyphOf(item.status as AcceptanceStatus);
  const meta = glyphMeta[glyph];
  const title = item.subject.title || item.subjectId;
  const [draftTitle, setDraftTitle] = useState(title);

  const refresh = () =>
    Promise.all([onChanged(), globalMutate(verifyKeys.acceptanceBundle(item.id))]);

  const commitRename = async () => {
    if (isSavingRef.current) return;
    const next = draftTitle.trim();
    if (!next) {
      message.error(t('verify:acceptance.workspace.renameEmpty'));
      setDraftTitle(title);
      setEditing(false);
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }

    isSavingRef.current = true;
    setMutating(true);
    try {
      await verifyService.renameAcceptance(item.id, next);
      await refresh();
      message.success(t('verify:acceptance.workspace.renameSuccess'));
      setEditing(false);
    } catch (error) {
      console.error('[acceptance:rename]', error);
      message.error(t('verify:acceptance.workspace.renameError'));
    } finally {
      isSavingRef.current = false;
      setMutating(false);
    }
  };

  const changeStatus = async (status: 'accepted' | 'closed' | 'delivered') => {
    setMutating(true);
    try {
      await verifyService.updateAcceptanceStatus(item.id, status);
      await refresh();
      message.success(t('verify:acceptance.workspace.statusSuccess'));
    } catch (error) {
      console.error('[acceptance:status]', error);
      message.error(t('verify:acceptance.workspace.statusError'));
    } finally {
      setMutating(false);
    }
  };

  const statusItems: DropdownItem[] = getAcceptanceStatusActions(item.status).map((action) => {
    if (action === 'accept') {
      return {
        icon: <Icon icon={CircleCheck} />,
        key: action,
        label: t('verify:acceptance.workspace.actions.markAccepted'),
        onClick: () => void changeStatus('accepted'),
      };
    }
    if (action === 'reopen') {
      return {
        icon: <Icon icon={RotateCcw} />,
        key: action,
        label: t('verify:acceptance.workspace.actions.reopen'),
        onClick: () => void changeStatus('delivered'),
      };
    }
    return {
      icon: <Icon icon={X} />,
      key: action,
      label: t('verify:acceptance.workspace.actions.markClosed'),
      onClick: () => void changeStatus('closed'),
    };
  });

  const menuItems: DropdownItem[] = [
    {
      icon: <Icon icon={Pencil} />,
      key: 'rename',
      label: t('verify:acceptance.workspace.actions.rename'),
      onClick: () => {
        setDraftTitle(title);
        setEditing(true);
      },
    },
    ...(statusItems.length > 0
      ? [
          {
            children: statusItems,
            icon: <Icon icon={CircleDashed} />,
            key: 'status',
            label: t('verify:acceptance.workspace.actions.status'),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'delete',
      label: t('verify:acceptance.workspace.actions.delete'),
      onClick: () => {
        confirmModal({
          cancelText: t('common:cancel'),
          content: t('verify:acceptance.workspace.deleteConfirmDescription', { title }),
          okButtonProps: { danger: true },
          okText: t('common:delete'),
          onOk: async () => {
            setMutating(true);
            try {
              await verifyService.deleteAcceptance(item.id);
              await onChanged();
              message.success(t('verify:acceptance.workspace.deleteSuccess'));
            } catch (error) {
              console.error('[acceptance:delete]', error);
              message.error(t('verify:acceptance.workspace.deleteError'));
            } finally {
              setMutating(false);
            }
          },
          title: t('verify:acceptance.workspace.deleteConfirmTitle'),
        });
      },
    },
  ];

  if (editing) {
    return (
      <div className={styles.editRow}>
        <input
          autoFocus
          className={styles.itemTitleInput}
          value={draftTitle}
          onBlur={() => void commitRename()}
          onChange={(event) => setDraftTitle(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitRename();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftTitle(title);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={styles.row}
      style={mutating ? { opacity: 0.62, pointerEvents: 'none' } : undefined}
    >
      <button
        className={styles.main}
        type={'button'}
        onClick={() => navigate(`/acceptance/${item.id}`)}
      >
        <Icon
          className={SPINNING_GLYPHS.has(glyph) ? styles.spin : undefined}
          icon={meta.icon}
          size={17}
          style={{ color: meta.color }}
        />
        <span className={styles.content}>
          <span className={styles.title}>{title}</span>
          <Flexbox horizontal className={styles.itemSub} gap={8}>
            <span>
              {item.checkCount != null
                ? t('acceptance.workspace.checkCount', { count: item.checkCount })
                : t(`acceptance.status.${item.status}` as any)}
            </span>
            <span>{relativeTime(item.updatedAt ?? item.createdAt)}</span>
          </Flexbox>
        </span>
      </button>
      <DropdownMenu
        iconSpaceMode={'group'}
        items={menuItems}
        placement={'bottomRight'}
        popupProps={{ style: { minWidth: 160 } }}
      >
        <ActionIcon
          icon={MoreHorizontal}
          size={'small'}
          title={t('verify:acceptance.workspace.actions.more')}
        />
      </DropdownMenu>
    </div>
  );
});

AcceptanceRow.displayName = 'WorkbenchAcceptanceRow';

export default AcceptanceRow;
