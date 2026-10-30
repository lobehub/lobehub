'use client';

import type { DeviceGitWorktreeBase } from '@lobechat/types';
import { cssVar, Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  AutoComplete,
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

import { useFetchGitBranches } from '@/store/device';

import { useWorktreeBase } from './useWorktreeBase';
import { useWorktreeBranchSeed } from './useWorktreeBranchSeed';
import { formatWorktreeBase } from './worktreeHelpers';

interface CreateWorktreeContentProps {
  deviceId?: string;
  /**
   * Create the worktree on a fresh branch. Return an error message to show
   * inline and keep the modal open; return undefined on success (modal closes).
   */
  onSubmit: (branch: string, base?: DeviceGitWorktreeBase) => Promise<string | undefined>;
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
    // Unedited, the field shows the source HEAD and creation forks from it.
    const [editedBase, setEditedBase] = useState<string>();
    const { data: branches } = useFetchGitBranches(deviceId, path);
    const {
      base,
      headBase,
      isInvalid: isBaseInvalid,
      isPending: isBasePending,
      ref: baseRef,
      unavailable: isBaseUnavailable,
    } = useWorktreeBase(deviceId, path, editedBase);
    const headLabel = headBase ? formatWorktreeBase(headBase) : '';
    // A typed ref only blocks while it can't be proven to be honored.
    const isBaseBlocked = isBaseInvalid || isBasePending || (!!baseRef && isBaseUnavailable);
    const baseOptions = useMemo(
      () => branches?.map(({ name }) => ({ label: name, value: name })) ?? [],
      [branches],
    );

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
      if (!branch || isBaseBlocked) return;
      setLoading(true);
      try {
        const message = await onSubmit(branch, base);
        if (message) {
          setError(message);
          return;
        }
        close();
      } finally {
        setLoading(false);
      }
    }, [base, close, isBaseBlocked, loading, onSubmit, value]);

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
        <Flexbox gap={6}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {tDevice('workingDirectory.newWorktreeBaseLabel')}
          </Text>
          {/* The default is a label (`canary @9a1b3127`), not a ref to extend, so
              typing replaces it instead of appending to it. */}
          <div
            onFocus={(event) => {
              if (editedBase === undefined && event.target instanceof HTMLInputElement)
                event.target.select();
            }}
          >
            <AutoComplete
              filter={editedBase === undefined ? null : undefined}
              options={baseOptions}
              placeholder={headLabel || tDevice('workingDirectory.newWorktreeBasePlaceholder')}
              value={editedBase ?? headLabel}
              onChange={(next) => setEditedBase(next)}
            />
          </div>
          {isBaseUnavailable ? (
            <Text style={{ color: cssVar.colorWarning, fontSize: 12 }}>
              {tDevice('workingDirectory.newWorktreeBaseUnavailable')}
            </Text>
          ) : isBaseInvalid ? (
            <Text style={{ color: cssVar.colorError, fontSize: 12 }}>
              {tDevice('workingDirectory.newWorktreeBaseInvalid', { ref: baseRef })}
            </Text>
          ) : base?.detached ? (
            <Text style={{ color: cssVar.colorWarning, fontSize: 12 }}>
              {tDevice('workingDirectory.newWorktreeBaseDetached', {
                sha: formatWorktreeBase(base),
              })}
            </Text>
          ) : baseRef && base ? (
            <Text style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
              {tDevice('workingDirectory.newWorktreeBaseResolved', {
                base: formatWorktreeBase(base),
              })}
            </Text>
          ) : null}
        </Flexbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button
            disabled={!isReady || !trimmed || isBaseBlocked}
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
 * sibling directory the new worktree will occupy and an editable base, which
 * defaults to the source HEAD so what the branch forks from is visible before
 * confirming. Submitting runs `git worktree add -b <branch> <path> <base>` and
 * switches into it.
 *
 * The name is drawn against the working directory's full local branch list, so
 * the directory it reads is part of the contract.
 */
export const openCreateWorktreeModal = (options: {
  deviceId?: string;
  onSubmit: (branch: string, base?: DeviceGitWorktreeBase) => Promise<string | undefined>;
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
