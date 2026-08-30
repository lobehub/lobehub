'use client';

import type { AcceptanceStatus } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { ActionIcon, confirmModal, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  GitMerge,
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

import NavItem from '@/features/NavPanel/components/NavItem';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import type { AcceptanceListItem } from '@/services/verify';
import { verifyService } from '@/services/verify';

import { getAcceptanceStatusActions } from '../Viewer/statusActions';
import { openMergeAcceptanceModal } from './MergeAcceptanceModal';
import { useAcceptanceProjectMenuItem } from './useAcceptanceProjectMenuItem';

const styles = createStaticStyles(({ css }) => ({
  editRow: css`
    padding-block: 4px;
    padding-inline: 4px;
  `,
  itemTime: css`
    flex: none;
    padding-inline-start: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  itemTitleInput: css`
    width: 100%;
    min-width: 0;
    height: 24px;
    padding-inline: 6px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-size: 13px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &:focus {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
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
  const d = dayjs(value);
  return dayjs().diff(d, 'day') < 7 ? d.fromNow() : d.format('MMM D');
};

/** Extracted desktop row, keeping the list panel focused on layout and filtering. */
const AcceptanceRow = memo<{
  active: boolean;
  item: AcceptanceListItem;
  onChanged: () => Promise<unknown> | unknown;
}>(({ active, item, onChanged }) => {
  const { t } = useTranslation('verify');
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

  const startRename = () => {
    setDraftTitle(title);
    setEditing(true);
  };

  const cancelRename = () => {
    if (isSavingRef.current) return;
    setDraftTitle(title);
    setEditing(false);
  };

  const commitRename = async () => {
    if (isSavingRef.current) return;
    const next = draftTitle.trim();
    if (!next) {
      toast.error(t('acceptance.workspace.renameEmpty'));
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
      toast.success(t('acceptance.workspace.renameSuccess'));
      setEditing(false);
    } catch (error) {
      console.error('[acceptance:rename]', error);
      toast.error(t('acceptance.workspace.renameError'));
    } finally {
      isSavingRef.current = false;
      setMutating(false);
    }
  };

  const changeStatus = async (status: 'accepted' | 'closed' | 'delivered' | 'rejected') => {
    setMutating(true);
    try {
      await verifyService.updateAcceptanceStatus(item.id, status);
      await refresh();
      toast.success(t('acceptance.workspace.statusSuccess'));
    } catch (error) {
      console.error('[acceptance:status]', error);
      toast.error(t('acceptance.workspace.statusError'));
    } finally {
      setMutating(false);
    }
  };

  const assignProject = async (projectId: string | null) => {
    setMutating(true);
    try {
      await verifyService.setAcceptanceProject(item.id, projectId);
      await refresh();
      toast.success(
        projectId
          ? t(
              item.project?.id
                ? 'acceptance.workspace.project.moveSuccess'
                : 'acceptance.workspace.project.addSuccess',
            )
          : t('acceptance.workspace.project.removeSuccess'),
      );
    } catch (error) {
      console.error('[acceptance:project]', error);
      toast.error(t('acceptance.workspace.project.error'));
    } finally {
      setMutating(false);
    }
  };

  const projectItem = useAcceptanceProjectMenuItem({
    currentProjectId: item.project?.id,
    onSelect: (projectId) => void assignProject(projectId),
  });

  /**
   * Fold this entry into another acceptance — its checks (with rounds and
   * evidence) move over and this row disappears. Navigating the active row to
   * the target keeps the reviewer on the surface their checks just moved to,
   * instead of on a 404.
   */
  const mergeIntoAcceptance = () => {
    openMergeAcceptanceModal({
      source: item,
      onConfirm: async (targetId) => {
        setMutating(true);
        try {
          const summary = await verifyService.mergeAcceptance(item.id, targetId);
          if (active) navigate(`/acceptance/${targetId}`, { replace: true });
          await Promise.all([onChanged(), globalMutate(verifyKeys.acceptanceBundle(targetId))]);
          toast.success(t('acceptance.workspace.merge.success', { count: summary.movedChecks }));
          return true;
        } catch (error) {
          console.error('[acceptance:merge]', error);
          toast.error(t('acceptance.workspace.merge.error'));
          return false;
        } finally {
          setMutating(false);
        }
      },
    });
  };

  const removeAcceptance = () => {
    confirmModal({
      cancelText: t('actions.cancel'),
      content: t('acceptance.workspace.deleteConfirmDescription', { title }),
      okButtonProps: { danger: true },
      okText: t('actions.delete'),
      onOk: async () => {
        setMutating(true);
        try {
          await verifyService.deleteAcceptance(item.id);
          if (active) navigate('/acceptance', { replace: true });
          await onChanged();
          toast.success(t('acceptance.workspace.deleteSuccess'));
        } catch (error) {
          console.error('[acceptance:delete]', error);
          toast.error(t('acceptance.workspace.deleteError'));
        } finally {
          setMutating(false);
        }
      },
      title: t('acceptance.workspace.deleteConfirmTitle'),
    });
  };

  const statusItems: DropdownItem[] = getAcceptanceStatusActions(item.status).map((action) => {
    if (action === 'accept') {
      return {
        icon: <Icon icon={CircleCheck} />,
        key: action,
        label: t('acceptance.workspace.actions.markAccepted'),
        onClick: () => void changeStatus('accepted'),
      };
    }
    if (action === 'reopen') {
      return {
        icon: <Icon icon={RotateCcw} />,
        key: action,
        label: t('acceptance.workspace.actions.reopen'),
        onClick: () => void changeStatus('delivered'),
      };
    }
    return {
      icon: <Icon icon={X} />,
      key: action,
      label: t('acceptance.workspace.actions.markClosed'),
      onClick: () => void changeStatus('closed'),
    };
  });

  const menuItems: DropdownItem[] = [
    {
      icon: <Icon icon={Pencil} />,
      key: 'rename',
      label: t('acceptance.workspace.actions.rename'),
      onClick: startRename,
    },
    projectItem,
    {
      icon: <Icon icon={GitMerge} />,
      key: 'merge',
      label: t('acceptance.workspace.actions.merge'),
      onClick: mergeIntoAcceptance,
    },
    ...(statusItems.length > 0
      ? [
          {
            children: statusItems,
            icon: <Icon icon={CircleDashed} />,
            key: 'status',
            label: t('acceptance.workspace.actions.status'),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'delete',
      label: t('acceptance.workspace.actions.delete'),
      onClick: removeAcceptance,
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
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitRename();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelRename();
            }
          }}
        />
      </div>
    );
  }

  return (
    <NavItem
      active={active}
      key={item.id}
      style={mutating ? { opacity: 0.62, pointerEvents: 'none' } : undefined}
      title={title}
      titleColor={cssVar.colorText}
      actions={
        <DropdownMenu
          iconSpaceMode={'group'}
          items={menuItems}
          placement={'bottomRight'}
          popupProps={{ style: { minWidth: 160 } }}
        >
          <ActionIcon
            icon={MoreHorizontal}
            size={'small'}
            title={t('acceptance.workspace.actions.more')}
          />
        </DropdownMenu>
      }
      extra={
        <span className={styles.itemTime}>{relativeTime(item.updatedAt ?? item.createdAt)}</span>
      }
      icon={
        <Icon
          className={SPINNING_GLYPHS.has(glyph) ? styles.spin : undefined}
          icon={meta.icon}
          size={16}
          style={{ color: meta.color }}
        />
      }
      onClick={() => navigate(`/acceptance/${item.id}`)}
    />
  );
});

AcceptanceRow.displayName = 'AcceptanceRow';

export default AcceptanceRow;
