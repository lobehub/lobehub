'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Segmented, Switch } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { App } from 'antd';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

interface ShareToggleProps {
  cred: UserCredSummary;
  /**
   * Called after a share/unshare/visibility change lands — may be async.
   * The mutation waits for it to settle before releasing its optimistic
   * override (see below), so the switch never reverts-then-jumps once fresh
   * data arrives.
   */
  onChange: () => Promise<unknown> | void;
}

/**
 * Per-row control for the workspace creds page's "your personal credentials"
 * section. Lets the owner share one of their own personal credentials into
 * the current workspace's Market organization (or unshare it), and — once
 * shared — flip its visibility between 'private' (draft, only the owner can
 * see it's linked) and 'public' (visible to the rest of the workspace).
 *
 * Always targets the *active* workspace: the underlying `market.creds.share`
 * procedure resolves the org from `ctx.workspaceId` server-side (verified
 * membership), never from client input — this component never needs to know
 * the workspace's Market org id.
 */
const ShareToggle: FC<ShareToggleProps> = ({ cred, onChange }) => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  // A personal credential can only be linked to one organization at a time,
  // so `organizationAccountId != null` alone can't tell "shared to *this*
  // workspace" apart from "shared to some other workspace previously" — the
  // list procedure resolves that distinction server-side. Defaults to false
  // (safe: never surfaces an unshare/visibility control for a link that
  // actually belongs to a different workspace) when unset, e.g. outside a
  // workspace context or when the active workspace's org isn't set up yet.
  const isShared = cred.sharedToActiveWorkspace ?? false;

  // `cred` only reflects the real server state once the parent's list(s)
  // refetch — which we deliberately wait on inside the mutations below, so
  // there's a real gap between "user clicked" and "`cred` prop updates".
  // Without a local optimistic override, the switch/segmented would sit
  // frozen (looking unresponsive) for that whole round-trip, then snap on
  // their own once fresh data lands. `null` means "no override, trust `cred`".
  const [pendingShared, setPendingShared] = useState<boolean | null>(null);
  const [pendingVisibility, setPendingVisibility] = useState<'private' | 'public' | null>(null);

  const clearPending = () => {
    setPendingShared(null);
    setPendingVisibility(null);
  };

  const shareMutation = useMutation({
    mutationFn: async (visibility: 'private' | 'public') => {
      await lambdaClient.market.creds.share.mutate({ id: cred.id, visibility });
    },
    onError: () => {
      message.error(t('creds.share.error'));
    },
    // Awaited by react-query before onSettled fires, so the optimistic
    // override below only lifts once the refetched `cred` prop already
    // agrees with it — never a moment earlier.
    onSuccess: async () => {
      await onChange();
    },
    onSettled: clearPending,
  });

  const unshareMutation = useMutation({
    mutationFn: async () => {
      await lambdaClient.market.creds.unshare.mutate({ id: cred.id });
    },
    onError: () => {
      message.error(t('creds.share.error'));
    },
    onSuccess: async () => {
      await onChange();
    },
    onSettled: clearPending,
  });

  const isPending = shareMutation.isPending || unshareMutation.isPending;
  const shared = pendingShared ?? isShared;
  const visibility = pendingVisibility ?? cred.visibility ?? 'private';

  const handleSwitchChange = (checked: boolean) => {
    setPendingShared(checked);
    if (checked) {
      setPendingVisibility('private');
      shareMutation.mutate('private');
    } else {
      unshareMutation.mutate();
    }
  };

  const handleVisibilityChange = (value: 'private' | 'public') => {
    setPendingVisibility(value);
    shareMutation.mutate(value);
  };

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {shared && (
        <Segmented
          disabled={isPending}
          size={'small'}
          value={visibility}
          options={[
            { label: t('creds.share.visibility.private'), value: 'private' },
            { label: t('creds.share.visibility.public'), value: 'public' },
          ]}
          onChange={handleVisibilityChange}
        />
      )}
      <Switch
        checked={shared}
        loading={isPending}
        title={t('creds.share.toggle')}
        onChange={handleSwitchChange}
      />
    </Flexbox>
  );
};

export default ShareToggle;
