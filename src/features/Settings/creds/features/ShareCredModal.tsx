'use client';

import { type UserCredSummary } from '@lobechat/types';
import {
  Button,
  confirmModal,
  createModal,
  Flexbox,
  Icon,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { Lock, Users } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceOptionLabel } from '@/business/client/hooks/useWorkspaceOptionLabel';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { createWorkspaceLambdaClient, lambdaQuery } from '@/libs/trpc/client';

import { credErrorKey } from './credError';

type Visibility = 'private' | 'public';

const styles = stylex.create({
  optionHint: {
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    marginInlineStart: 'auto',
  },
  optionRow: {
    minWidth: 0,
    paddingBlock: '2px',
    width: '100%',
  },
  sharedRow: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadius,
    paddingBlock: '8px',
    paddingInline: '12px',
  },
});

interface ShareCredContentProps {
  credId: number;
}

/**
 * Body of the "Share to workspace" modal opened from a personal credential
 * row — the credential counterpart of the device share modal. Lists the
 * workspaces the credential is already shared into (each can be revoked),
 * then shares it into one more. Calls run under the target workspace's scope
 * via `createWorkspaceLambdaClient`, since the personal settings page has no
 * active workspace to inherit.
 */
const ShareCredContent = memo<ShareCredContentProps>(({ credId }) => {
  const { t: tSetting } = useTranslation('setting');
  const workspaces = useWorkspaces();
  const renderWorkspaceLabel = useWorkspaceOptionLabel();

  // Shares the personal list's query key, so a share here refreshes the page
  // behind the modal too.
  const { data, refetch } = lambdaQuery.market.creds.list.useQuery();
  const cred = data?.data?.find((c) => c.id === credId);

  const [targetId, setTargetId] = useState<string>();
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [sharing, setSharing] = useState(false);

  const sharedVisibility = useMemo(
    () =>
      new Map(
        (cred?.shares ?? []).flatMap((share) =>
          share.workspaceId ? [[share.workspaceId, share.visibility] as const] : [],
        ),
      ),
    [cred?.shares],
  );
  const sharedWorkspaces = workspaces.filter((workspace) => sharedVisibility.has(workspace.id));

  const scopeLabel = (value: Visibility) =>
    tSetting(
      value === 'public'
        ? 'workspace.general.transferScope.workspace.label'
        : 'workspace.general.transferScope.private.label',
    );

  const targetOptions = useMemo(
    () =>
      workspaces.map((workspace) => {
        const shared = sharedVisibility.has(workspace.id);
        const isViewer = workspace.role === 'viewer';
        return {
          disabled: shared || isViewer || !!workspace.lockedOut,
          label: (
            <Flexbox horizontal align={'center'} {...stylex.props(styles.optionRow)} gap={8}>
              {renderWorkspaceLabel(workspace)}
              {shared && (
                <Tag size={'small'} style={{ flex: 'none', margin: 0 }}>
                  {tSetting('creds.share.alreadyShared')}
                </Tag>
              )}
              {!shared && isViewer && (
                <span {...stylex.props(styles.optionHint)}>
                  {tSetting('creds.share.viewerHint')}
                </span>
              )}
            </Flexbox>
          ),
          title: workspace.name,
          value: workspace.id,
        };
      }),
    [workspaces, sharedVisibility, tSetting, renderWorkspaceLabel],
  );

  const effectiveTargetId = targetId ?? targetOptions.find((option) => !option.disabled)?.value;

  const visibilityOptions = (
    [
      { desc: 'private.desc', icon: Lock, label: 'private.label', value: 'private' },
      { desc: 'workspace.desc', icon: Users, label: 'workspace.label', value: 'public' },
    ] as const
  ).map((item) => ({
    label: (
      <Flexbox horizontal align={'center'} {...stylex.props(styles.optionRow)} gap={8}>
        <Icon icon={item.icon} size={14} />
        <Text style={{ fontSize: 13, fontWeight: 500 }}>
          {tSetting(`workspace.general.transferScope.${item.label}`)}
        </Text>
        <span {...stylex.props(styles.optionHint)}>
          {tSetting(`workspace.general.transferScope.${item.desc}`)}
        </span>
      </Flexbox>
    ),
    title: tSetting(`workspace.general.transferScope.${item.label}`),
    value: item.value,
  }));

  const handleShare = async () => {
    const target = workspaces.find((w) => w.id === effectiveTargetId);
    if (!target) return;

    setSharing(true);
    try {
      await createWorkspaceLambdaClient(target.id).market.creds.share.mutate({
        id: credId,
        visibility,
      });
      await refetch();
      setTargetId(undefined);
      toast.success(tSetting('creds.share.success', { name: target.name }));
    } catch (error) {
      toast.error(tSetting(credErrorKey(error, 'creds.share.error')));
    } finally {
      setSharing(false);
    }
  };

  const handleRevoke = (workspaceId: string, name: string) =>
    confirmModal({
      content: tSetting('creds.share.revokeConfirmDesc'),
      okButtonProps: { danger: true },
      okText: tSetting('creds.share.revoke'),
      onOk: async () => {
        try {
          await createWorkspaceLambdaClient(workspaceId).market.creds.unshare.mutate({
            id: credId,
          });
          await refetch();
        } catch (error) {
          toast.error(tSetting(credErrorKey(error, 'creds.share.error')));
        }
      },
      title: tSetting('creds.share.revokeConfirmTitle', { name }),
    });

  return (
    <Flexbox gap={16} paddingBlock={8}>
      <Text style={{ fontSize: 13 }} type={'secondary'}>
        {tSetting('creds.share.modalDesc')}
      </Text>

      {sharedWorkspaces.length > 0 && (
        <Flexbox gap={6}>
          <Text style={{ fontSize: 13, fontWeight: 500 }}>
            {tSetting('creds.share.sharedLabel')}
          </Text>
          {sharedWorkspaces.map((workspace) => (
            <Flexbox
              horizontal
              align={'center'}
              {...stylex.props(styles.sharedRow)}
              gap={8}
              justify={'space-between'}
              key={workspace.id}
            >
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                {renderWorkspaceLabel(workspace)}
                <Tag size={'small'} style={{ flex: 'none', margin: 0 }}>
                  {scopeLabel(sharedVisibility.get(workspace.id)!)}
                </Tag>
              </Flexbox>
              <Button size={'small'} onClick={() => handleRevoke(workspace.id, workspace.name)}>
                {tSetting('creds.share.revoke')}
              </Button>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {workspaces.length === 0 ? (
        <Flexbox align={'center'} justify={'center'} paddingBlock={24}>
          <Text fontSize={12} type={'secondary'}>
            {tSetting('creds.share.empty')}
          </Text>
        </Flexbox>
      ) : (
        <>
          <Flexbox gap={6}>
            <Text style={{ fontSize: 13, fontWeight: 500 }}>
              {tSetting('creds.share.targetLabel')}
            </Text>
            <Select
              showSearch
              options={targetOptions}
              placeholder={tSetting('creds.share.selectPlaceholder')}
              style={{ width: '100%' }}
              value={effectiveTargetId}
              onChange={(value) => setTargetId(value as string)}
            />
          </Flexbox>

          <Flexbox gap={6}>
            <Text style={{ fontSize: 13, fontWeight: 500 }}>
              {tSetting('workspace.general.transferScope.title')}
            </Text>
            <Select
              options={visibilityOptions}
              style={{ width: '100%' }}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </Flexbox>

          <Flexbox horizontal justify={'flex-end'}>
            <Button
              disabled={!effectiveTargetId}
              loading={sharing}
              type={'primary'}
              onClick={handleShare}
            >
              {tSetting('creds.share.confirm')}
            </Button>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

ShareCredContent.displayName = 'ShareCredContent';

export const openShareCredModal = (cred: UserCredSummary) =>
  createModal({
    content: <ShareCredContent credId={cred.id} />,
    footer: null,
    styles: {
      content: { paddingBlock: 8, paddingInline: 24 },
    },
    title: t('creds.share.modalTitle', { ns: 'setting' }),
    width: 'min(92vw, 520px)',
  });
