'use client';

import type { useFileTree } from '@pierre/trees/react';
import debug from 'debug';
import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { NormalizedTree } from '../adapter';
import type {
  ExplorerTreeEntryKind,
  ExplorerTreeNameCheck,
  ExplorerTreeNode,
  ExplorerTreeProps,
} from '../types';
import { getItemPathFromEventPath } from './eventPath';

const log = debug('lobe-explorer-tree:inline-edit');

type FileTreeModel = ReturnType<typeof useFileTree>['model'];

// Leaf name of the placeholder row a new entry is typed into. The input is
// cleared before the user sees it, and a lone zero-width space can't collide
// with a name anyone would type.
const PLACEHOLDER_NAME = '​';
const RENAME_INPUT_ATTRIBUTE = 'data-item-rename-input';

export interface PendingCreate {
  kind: ExplorerTreeEntryKind;
  parentId: string | null;
  /** Canonical tree path of the placeholder row. */
  path: string;
}

export interface NameInputHintState {
  left: number;
  message: string;
  top: number;
  width: number;
}

const isRenameInput = (target: EventTarget | undefined): target is HTMLInputElement =>
  target instanceof HTMLInputElement && target.hasAttribute(RENAME_INPUT_ATTRIBUTE);

/** Pushes a value into the tree's controlled rename input the way typing would. */
const setRenameInputValue = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Select the name without its extension, as VS Code and Finder do. */
const selectStem = (input: HTMLInputElement, isFolder: boolean) => {
  const dot = isFolder ? -1 : input.value.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
};

interface UseInlineNameEditParams<TData> {
  adapterRef: RefObject<NormalizedTree<TData>>;
  model: FileTreeModel;
  pendingCreateRef: RefObject<PendingCreate | null>;
  propsRef: RefObject<ExplorerTreeProps<TData>>;
  resync: () => void;
}

/**
 * Inline new-entry and rename input on top of @pierre/trees' rename row:
 * - `startCreating` inserts a placeholder row and opens the input on it;
 * - every commit (Enter or blur) runs `validateName` first and, when it fails,
 *   keeps the input open with a hint under it instead of committing;
 * - a new entry is committed here (the tree's own rename refuses `a/b` names)
 *   and handed to `onCommitCreate`.
 *
 * The rename input lives in the tree's shadow DOM, so everything hooks native
 * capture listeners, which run before the tree's own handlers.
 */
export const useInlineNameEdit = <TData>({
  adapterRef,
  model,
  pendingCreateRef,
  propsRef,
  resync,
}: UseInlineNameEditParams<TData>) => {
  const [hint, setHint] = useState<NameInputHintState | null>(null);

  const findRenameInput = useCallback((): HTMLInputElement | null => {
    const input = model
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector(`[${RENAME_INPUT_ATTRIBUTE}]`);
    return input instanceof HTMLInputElement ? input : null;
  }, [model]);

  // The input mounts on the tree's next render, which can be a frame or two away.
  const whenRenameInputMounts = useCallback(
    (run: (input: HTMLInputElement) => void, attempts = 5) => {
      requestAnimationFrame(() => {
        const input = findRenameInput();
        if (input) run(input);
        else if (attempts > 1) whenRenameInputMounts(run, attempts - 1);
      });
    },
    [findRenameInput],
  );

  const showHint = useCallback((message: string | null | undefined, input: HTMLInputElement) => {
    if (!message) {
      setHint(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    setHint({ left: rect.left, message, top: rect.bottom, width: rect.width });
  }, []);

  const describeInput = useCallback(
    (
      input: HTMLInputElement,
      eventPath: EventTarget[],
    ): { check: ExplorerTreeNameCheck<TData>; pending?: PendingCreate } | null => {
      const itemPath = getItemPathFromEventPath(eventPath);
      if (!itemPath) return null;
      const a = adapterRef.current;
      const pending = pendingCreateRef.current;
      if (pending && pending.path === itemPath) {
        const parentNode = pending.parentId ? (a.nodeById.get(pending.parentId) ?? null) : null;
        return {
          check: { kind: pending.kind, mode: 'create', name: input.value, parentNode },
          pending,
        };
      }
      const id = a.idByPath.get(itemPath);
      const node: ExplorerTreeNode<TData> | undefined = id ? a.nodeById.get(id) : undefined;
      if (!node) return null;
      return { check: { mode: 'rename', name: input.value, node } };
    },
    [adapterRef, pendingCreateRef],
  );

  useEffect(() => {
    // The host element is attached after this effect first runs, so listen on
    // the document (capture phase: still ahead of the tree's own handlers) and
    // keep only events that come from this tree's rename input.
    const fromThisTree = (event: Event) => {
      const host = model.getFileTreeContainer();
      return !!host && event.composedPath().includes(host);
    };

    const validate = (check: ExplorerTreeNameCheck<TData>) =>
      propsRef.current.validateName?.(check) ?? null;

    const handleInput = (event: Event) => {
      if (!fromThisTree(event)) return;
      const eventPath = event.composedPath();
      const [target] = eventPath;
      if (!isRenameInput(target)) return;
      const described = describeInput(target, eventPath);
      if (!described) return;
      // An empty new-entry name only cancels, so it is not worth flagging.
      if (described.pending && target.value === '') {
        setHint(null);
        return;
      }
      showHint(validate(described.check), target);
    };

    const commitCreate = (pending: PendingCreate, name: string, check: ExplorerTreeNameCheck) => {
      const parentNode = check.mode === 'create' ? check.parentNode : null;
      const parentPath = pending.parentId
        ? (adapterRef.current.pathById.get(pending.parentId) ?? '')
        : '';
      const optimisticPath = `${parentPath}${name}${pending.kind === 'folder' ? '/' : ''}`;
      // Runs after the tree has dropped the placeholder on its own commit.
      setTimeout(() => {
        try {
          model.add(optimisticPath);
        } catch (error) {
          log('optimistic add of %s failed: %O', optimisticPath, error);
        }
        void Promise.resolve(
          propsRef.current.onCommitCreate?.({
            kind: pending.kind,
            name,
            parentNode: parentNode as ExplorerTreeNode<TData> | null,
          }),
        ).then(
          (result) => {
            if (result === false) resync();
          },
          () => resync(),
        );
      }, 0);
    };

    const handleCommitAttempt = (event: Event) => {
      if (!fromThisTree(event)) return;
      const eventPath = event.composedPath();
      const [target] = eventPath;
      if (!isRenameInput(target)) return;
      const described = describeInput(target, eventPath);
      if (!described) return;
      const { check, pending } = described;

      // Blank new-entry name: let the tree drop the placeholder.
      if (pending && target.value.trim() === '') {
        pendingCreateRef.current = null;
        setHint(null);
        return;
      }

      const error = validate(check);
      if (error) {
        event.preventDefault();
        event.stopPropagation();
        showHint(error, target);
        return;
      }
      setHint(null);
      if (!pending) return;

      // Take the commit over from the tree: clearing the input makes its own
      // commit remove the placeholder, and the entry is created from here.
      pendingCreateRef.current = null;
      const name = target.value;
      setRenameInputValue(target, '');
      commitCreate(pending, name, check);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!fromThisTree(event)) return;
      const eventPath = event.composedPath();
      const [target] = eventPath;
      if (!isRenameInput(target)) {
        // The tree opens the rename input on F2 by itself; trim the selection
        // down to the stem once it is there.
        if (event.key === 'F2') {
          whenRenameInputMounts((input) => {
            selectStem(input, getItemPathFromEventPath(eventPath)?.endsWith('/') ?? false);
          });
        }
        return;
      }
      if (event.key === 'Escape') {
        if (pendingCreateRef.current) pendingCreateRef.current = null;
        setHint(null);
        return;
      }
      if (event.key !== 'Enter' || event.isComposing) return;
      handleCommitAttempt(event);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('blur', handleCommitAttempt, true);
    document.addEventListener('input', handleInput, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('blur', handleCommitAttempt, true);
      document.removeEventListener('input', handleInput, true);
    };
  }, [
    adapterRef,
    describeInput,
    model,
    pendingCreateRef,
    propsRef,
    resync,
    showHint,
    whenRenameInputMounts,
  ]);

  const startCreating = useCallback(
    (parentId: string | null, kind: ExplorerTreeEntryKind) => {
      const parentPath = parentId == null ? '' : adapterRef.current.pathById.get(parentId);
      if (parentPath === undefined) return;

      const stale = pendingCreateRef.current;
      pendingCreateRef.current = null;
      if (stale) {
        try {
          model.remove(stale.path, { recursive: true });
        } catch {
          // Already gone with a data refresh.
        }
      }

      const path = `${parentPath}${PLACEHOLDER_NAME}${kind === 'folder' ? '/' : ''}`;
      try {
        model.add(path);
      } catch (error) {
        log('cannot insert placeholder %s: %O', path, error);
        return;
      }
      pendingCreateRef.current = { kind, parentId, path };
      if (!model.startRenaming(path, { removeIfCanceled: true })) {
        pendingCreateRef.current = null;
        model.remove(path, { recursive: true });
        return;
      }
      whenRenameInputMounts((input) => setRenameInputValue(input, ''));
    },
    [adapterRef, model, pendingCreateRef, whenRenameInputMounts],
  );

  const selectRenameStem = useCallback(
    (isFolder: boolean) => whenRenameInputMounts((input) => selectStem(input, isFolder)),
    [whenRenameInputMounts],
  );

  return { hint, selectRenameStem, startCreating };
};
