'use client';

import { cssVar, Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  Input,
  type ModalInstance,
  Skeleton,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { DicesIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorktreeBranchSeed } from './useWorktreeBranchSeed';

interface CreateWorktreeContentProps {
  deviceId?: string;
  /**
   * Create the worktree on a fresh branch. Return an error message to show
   * inline and keep the modal open; return undefined on success (modal closes).
   */
  onSubmit: (branch: string) => Promise<string | undefined>;
  path: string;
  /** Preview the target directory the new worktree will occupy for a branch name. */
  resolvePath: (branch: string) => string;
}

const CreateWorktreeContent = memo<CreateWorktreeContentProps>(
  ({ deviceId, onSubmit, path, resolvePath }) => {
    const { t: tDevice } = useTranslation('device');
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    // Seeded with a generated name so creating a worktree is a single Enter
    // press. The field stays editable, and the dice re-rolls it, for anyone who
    // would rather name the branch after the work. The name only appears once
    // the branch list behind it has settled — see `useWorktreeBranchSeed`.
    const { isReady, name, reroll } = useWorktreeBranchSeed(deviceId, path);
    // Typing (and an explicit re-roll) shadows the generated name, so a redraw
    // never overwrites what the user chose.
    const [edited, setEdited] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const inputRef = useRef<HTMLInputElement>(null);

    const value = edited ?? name ?? '';
    const trimmed = value.trim();

    // Focus once the field exists; while the branch list is loading there is
    // nothing to focus yet.
    useEffect(() => {
      if (!isReady) return;
      queueMicrotask(() => inputRef.current?.focus());
    }, [isReady]);

    // Show where the worktree will land so the destination is never a surprise.
    const previewPath = useMemo(
      () => (trimmed ? resolvePath(trimmed) : ''),
      [resolvePath, trimmed],
    );

    const rollName = useCallback(() => {
      setEdited(undefined);
      reroll();
      setError(undefined);
    }, [reroll]);

    const handleSubmit = useCallback(async () => {
      if (loading) return;
      const branch = value.trim();
      if (!branch) return;
      setLoading(true);
      try {
        const message = await onSubmit(branch);
        if (message) {
          setError(message);
          return;
        }
        close();
      } finally {
        setLoading(false);
      }
    }, [close, loading, onSubmit, value]);

    return (
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          {isReady ? (
            <Input
              placeholder={tDevice('workingDirectory.newBranchPlaceholder')}
              ref={inputRef}
              value={value}
              suffix={
                <ActionIcon
                  icon={DicesIcon}
                  size={'small'}
                  title={tDevice('workingDirectory.rollBranchName')}
                  onClick={rollName}
                />
              }
              onPressEnter={handleSubmit}
              onChange={(e) => {
                setEdited(e.target.value);
                setError(undefined);
              }}
            />
          ) : (
            <Skeleton height={32} radius={cssVar.borderRadius} />
          )}
          {!isReady ? <Skeleton height={16} radius={4} width={'70%'} /> : null}
          {isReady && previewPath ? (
            <Text style={{ color: cssVar.colorTextTertiary, fontSize: 12, wordBreak: 'break-all' }}>
              {tDevice('workingDirectory.newWorktreeLocation', { path: previewPath })}
            </Text>
          ) : null}
          {isReady && error ? (
            <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text>
          ) : null}
        </Flexbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!isReady || !trimmed}
            loading={loading}
            type={'primary'}
            onClick={handleSubmit}
          >
            {tDevice('workingDirectory.createWorktreeSubmit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

CreateWorktreeContent.displayName = 'CreateWorktreeContent';

/**
 * Branch-name entry for "create worktree". Mirrors the create-branch modal but
 * seeds the field with a generated branch name (time prefix + word pair, so it
 * sorts chronologically and needs no inventing) and adds a live preview of the
 * sibling directory the new worktree will occupy. Submitting runs
 * `git worktree add -b <branch> <path>` and switches into it.
 *
 * The name is drawn against the working directory's full local branch list, so
 * the directory it reads is part of the contract.
 */
export const openCreateWorktreeModal = (options: {
  deviceId?: string;
  onSubmit: (branch: string) => Promise<string | undefined>;
  path: string;
  resolvePath: (branch: string) => string;
}): ModalInstance =>
  createModal({
    content: (
      <CreateWorktreeContent
        deviceId={options.deviceId}
        path={options.path}
        resolvePath={options.resolvePath}
        onSubmit={options.onSubmit}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('workingDirectory.createWorktreeTitle', { ns: 'device' }),
    width: 'min(90vw, 480px)',
  });
