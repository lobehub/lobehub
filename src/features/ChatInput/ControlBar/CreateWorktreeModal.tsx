'use client';

import { generateWorktreeBranchName } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  Input,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { t } from 'i18next';
import { DicesIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CreateWorktreeContentProps {
  /**
   * Branch names the caller already has in view. The generated default avoids
   * handing out one of them.
   */
  excludeBranches?: string[];
  /**
   * Create the worktree on a fresh branch. Return an error message to show
   * inline and keep the modal open; return undefined on success (modal closes).
   */
  onSubmit: (branch: string) => Promise<string | undefined>;
  /** Preview the target directory the new worktree will occupy for a branch name. */
  resolvePath: (branch: string) => string;
}

const CreateWorktreeContent = memo<CreateWorktreeContentProps>(
  ({ excludeBranches, onSubmit, resolvePath }) => {
    const { t: tDevice } = useTranslation('device');
    const { t: tCommon } = useTranslation('common');
    const { close } = useModalContext();
    // Seeded with a generated name so creating a worktree is a single Enter
    // press. The field stays editable, and the dice re-rolls it, for anyone who
    // would rather name the branch after the work.
    const [value, setValue] = useState(() =>
      generateWorktreeBranchName({ exclude: excludeBranches }),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const inputRef = useRef<HTMLInputElement>(null);

    const rollName = useCallback(() => {
      setValue(generateWorktreeBranchName({ exclude: excludeBranches }));
      setError(undefined);
    }, [excludeBranches]);

    useEffect(() => {
      queueMicrotask(() => inputRef.current?.focus());
    }, []);

    const trimmed = value.trim();
    // Show where the worktree will land so the destination is never a surprise.
    const previewPath = useMemo(
      () => (trimmed ? resolvePath(trimmed) : ''),
      [resolvePath, trimmed],
    );

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
              setValue(e.target.value);
              setError(undefined);
            }}
          />
          {previewPath ? (
            <Text style={{ color: cssVar.colorTextTertiary, fontSize: 12, wordBreak: 'break-all' }}>
              {tDevice('workingDirectory.newWorktreeLocation', { path: previewPath })}
            </Text>
          ) : null}
          {error ? <Text style={{ color: cssVar.colorError, fontSize: 12 }}>{error}</Text> : null}
        </Flexbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={loading} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!trimmed} loading={loading} type={'primary'} onClick={handleSubmit}>
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
 */
export const openCreateWorktreeModal = (options: {
  excludeBranches?: string[];
  onSubmit: (branch: string) => Promise<string | undefined>;
  resolvePath: (branch: string) => string;
}): ModalInstance =>
  createModal({
    content: (
      <CreateWorktreeContent
        excludeBranches={options.excludeBranches}
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
