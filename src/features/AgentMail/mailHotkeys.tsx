'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { toast } from '@lobehub/ui';
import { useLatest } from 'ahooks';
import { createContext, type ReactNode, use, useLayoutEffect, useRef, useState } from 'react';

import { useMailHotkey, useRegisterMailHotkeys } from '@/hooks/useHotkeys/mailScope';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyId } from '@/types/hotkey';
import { isMobileSurface } from '@/utils/mobileSurface';

import { undoLast } from './mailUndo';
import type { MailView } from './useMailList';

/** What the row keys do; each list or pane decides what it applies to. */
export type MailRowCommand = 'purge' | 'read' | 'star' | 'trash' | 'unread';

/** The list's side: focus, selection and the rows in focus. */
export interface MailListHotkeyTarget {
  /** On the selection, else the focused row; `false` when neither exists. */
  act: (command: MailRowCommand) => boolean;
  clearSearch: () => boolean;
  clearSelection: () => boolean;
  focusRow: (id: string) => void;
  focusSearch: () => void;
  /** Move the row focus without opening anything. */
  move: (step: 1 | -1) => void;
  /** `true` selects every loaded row, `false` clears the selection. */
  selectAll: (select: boolean) => boolean;
  toggleSelect: () => boolean;
}

/** The open conversation's side, only while it can be acted on. */
export interface MailDetailHotkeyTarget {
  act: (command: MailRowCommand) => boolean;
  /** Why answering is unavailable: shown instead of silently ignoring the key. */
  blockedReason?: { forward?: string; reply?: string };
  forward?: () => void;
  reply?: () => void;
  replyAll?: () => void;
}

interface Targets {
  detail?: MailDetailHotkeyTarget;
  list?: MailListHotkeyTarget;
}

interface TargetRegistry {
  /** Take `target` back, unless a newer one already replaced it. */
  release: <K extends keyof Targets>(kind: K, target: Targets[K]) => void;
  set: <K extends keyof Targets>(kind: K, target: Targets[K]) => void;
}

const MailHotkeyContext = createContext<TargetRegistry | null>(null);

/** Offer this list or pane to the page's hotkeys while mounted; the latest render wins. */
export const useMailHotkeyTarget = <K extends keyof Targets>(kind: K, target?: Targets[K]) => {
  const registry = use(MailHotkeyContext);
  useLayoutEffect(() => {
    registry?.set(kind, target);
    return () => registry?.release(kind, target);
  });
};

/**
 * The key a control's tooltip names, as the person has it bound. None on a
 * phone, where no key is registered: a tooltip must only show keys that work.
 */
export const useMailHotkeyHint = (id: HotkeyId) => {
  const keys = useUserStore(settingsSelectors.getHotkeyById(id));
  return isMobileSurface() || !keys ? undefined : keys;
};

/** Offers a target from inside JSX, for a component whose values exist only past its early returns. */
export const MailHotkeyTarget = <K extends keyof Targets>({
  kind,
  target,
}: {
  kind: K;
  target?: Targets[K];
}) => {
  useMailHotkeyTarget(kind, target);
  return null;
};

export interface MailPageHotkeys {
  /** Close the open mail or composer; `false` when neither is open. */
  back: () => boolean;
  changeView: (view: MailView) => void;
  /** `undefined` while the address cannot send; the reason is shown instead. */
  compose?: () => void;
  composeBlockedReason?: string;
}

const blocked = (reason?: string) => {
  if (reason) toast.info({ title: reason });
  return Boolean(reason);
};

/**
 * The mail page's keyboard, after Gmail (spec §7). Mounted by the page; the
 * list and the reading pane offer their halves through `useMailHotkeyTarget`.
 */
export const MailHotkeys = ({ children, page }: { children: ReactNode; page: MailPageHotkeys }) => {
  const targets = useRef<Targets>({});
  const [registry] = useState<TargetRegistry>(() => ({
    release: (kind, target) => {
      if (targets.current[kind] === target) targets.current[kind] = undefined;
    },
    set: (kind, target) => {
      targets.current[kind] = target;
    },
  }));
  const pageRef = useLatest(page);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  useRegisterMailHotkeys();

  const list = () => targets.current.list;
  const detail = () => targets.current.detail;
  /** The selection or focused row first, then the open conversation. */
  const rowCommand = (command: MailRowCommand) =>
    Boolean(list()?.act(command)) || Boolean(detail()?.act(command));

  useMailHotkey(HotkeyEnum.MailCompose, () => {
    const { compose, composeBlockedReason } = pageRef.current;
    if (blocked(composeBlockedReason)) return;
    if (!compose) return false;
    compose();
  });

  const answer = (pick: (target: MailDetailHotkeyTarget) => (() => void) | undefined) => {
    const target = detail();
    const run = target && pick(target);
    if (!target || !run) return false;
    run();
  };
  useMailHotkey(HotkeyEnum.MailReply, () => {
    if (blocked(detail()?.blockedReason?.reply)) return;
    return answer((target) => target.reply);
  });
  useMailHotkey(HotkeyEnum.MailReplyAll, () => {
    if (blocked(detail()?.blockedReason?.reply)) return;
    return answer((target) => target.replyAll);
  });
  useMailHotkey(HotkeyEnum.MailForward, () => {
    if (blocked(detail()?.blockedReason?.forward)) return;
    return answer((target) => target.forward);
  });

  useMailHotkey(HotkeyEnum.MailTrash, () => rowCommand('trash'));
  useMailHotkey(HotkeyEnum.MailTrashDelete, () => rowCommand('trash'));
  useMailHotkey(HotkeyEnum.MailPurge, () => rowCommand('purge'));
  useMailHotkey(HotkeyEnum.MailStar, () => rowCommand('star'));
  useMailHotkey(HotkeyEnum.MailMarkRead, () => rowCommand('read'));
  useMailHotkey(HotkeyEnum.MailMarkUnread, () => rowCommand('unread'));
  useMailHotkey(HotkeyEnum.MailUndo, () => undoLast());

  useMailHotkey(HotkeyEnum.MailNext, () => list()?.move(1));
  useMailHotkey(HotkeyEnum.MailPrevious, () => list()?.move(-1));
  useMailHotkey(HotkeyEnum.MailSelect, () => Boolean(list()?.toggleSelect()));
  useMailHotkey(HotkeyEnum.MailSelectAll, () => Boolean(list()?.selectAll(true)), {
    sequence: true,
    useKey: true,
  });
  useMailHotkey(HotkeyEnum.MailDeselectAll, () => Boolean(list()?.selectAll(false)), {
    sequence: true,
    useKey: true,
  });
  useMailHotkey(HotkeyEnum.MailSearch, () => list()?.focusSearch());

  // Esc steps out one layer at a time: the open mail, the selection, the search.
  useMailHotkey(
    HotkeyEnum.MailBack,
    () =>
      pageRef.current.back() || Boolean(list()?.clearSelection()) || Boolean(list()?.clearSearch()),
  );

  const go = (view: MailView) => () => pageRef.current.changeView(view);
  useMailHotkey(HotkeyEnum.MailGoInbox, go('inbox'), { sequence: true });
  useMailHotkey(HotkeyEnum.MailGoSent, go('sent'), { sequence: true });
  useMailHotkey(HotkeyEnum.MailGoDrafts, go('drafts'), { sequence: true });
  useMailHotkey(HotkeyEnum.MailGoStarred, go('starred'), { sequence: true });
  useMailHotkey(HotkeyEnum.MailGoTrash, go('trash'), { sequence: true });

  useMailHotkey(HotkeyEnum.MailHotkeyHelp, () => updateSystemStatus({ showHotkeyHelper: true }));

  return <MailHotkeyContext value={registry}>{children}</MailHotkeyContext>;
};
