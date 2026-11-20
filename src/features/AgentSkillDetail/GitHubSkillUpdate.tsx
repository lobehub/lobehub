'use client';

import type { SkillListItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Icon,
  Input,
  Popover,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { memo, type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useToolStore } from '@/store/tool';
import { AGENT_SKILL_LIST_KEY } from '@/store/tool/slices/agentSkills/projection';

export const hasGitHubSource = (skill: SkillListItem) =>
  !!skill.upstream ||
  (skill.source === 'market' &&
    /^(?:https?:\/\/)?(?:github\.com\/|[\w.-]+\/[\w.-]+$)/.test(skill.manifest?.sourceUrl ?? ''));

const useGitHubSkillCheck = (id: string) => {
  const checks = useToolStore((s) => s.useCheckGitHubSkills)();
  const status = useToolStore((s) => s.gitHubUpdateMap[AGENT_SKILL_LIST_KEY]?.[id]);
  return { check: checks.error ? { status: 'unavailable' as const } : status, checks };
};

export const GitHubSkillUpdateIndicator = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('setting');
  const { check } = useGitHubSkillCheck(id);
  if (check?.status !== 'update') return null;

  return (
    <Text
      color={cssVar.colorInfoText}
      fontSize={12}
      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {t('agentSkillUpdate.available')}
    </Text>
  );
});
GitHubSkillUpdateIndicator.displayName = 'GitHubSkillUpdateIndicator';

export const GitHubSkillUpdate = memo<{ compact?: boolean; skill: SkillListItem }>(
  ({ compact, skill }) => {
    const { t } = useTranslation(['setting', 'plugin', 'common']);
    const [saving, setSaving] = useState(false);
    const { allowed: canEdit, reason } = usePermission('edit_own_content');
    const canManage = useResourceManageable(skill.userId);
    const sync = useToolStore((s) => s.syncGitHubSkill);
    const { check, checks } = useGitHubSkillCheck(skill.id);
    const disabled = saving || !canEdit || !canManage;
    const save = async (input: Parameters<typeof sync>[0]) => {
      setSaving(true);
      try {
        await sync(input);
        toast.success(t('agentSkillUpdate.saved'));
      } catch (error) {
        toast.error({
          title: t('agentSkillUpdate.failed'),
          description: error instanceof Error ? error.message : undefined,
        });
        await checks.revalidate();
      } finally {
        setSaving(false);
      }
    };
    if (check?.status === 'update') {
      const apply = () =>
        save({
          commit: check.commit,
          id: skill.id,
          overwriteLocal: check.localChanges,
          revision: check.revision,
        });
      const onClick = (event: MouseEvent) => {
        event.stopPropagation();
        if (check.localChanges)
          confirmModal({
            title: t('agentSkillUpdate.overwriteTitle'),
            content: t('agentSkillUpdate.overwriteBody'),
            okText: t('agentSkillUpdate.replace'),
            okButtonProps: { danger: true },
            onOk: apply,
          });
        else void apply();
      };
      const label = t('agentSkillUpdate.apply');
      const disabledReason =
        reason ?? (!canManage ? t('plugin:store.actions.manageOnlyCreator') : undefined);
      return (
        <Tooltip title={disabledReason}>
          <Button
            aria-label={label}
            disabled={disabled}
            loading={saving}
            size="small"
            type={compact ? 'text' : 'default'}
            onClick={onClick}
          >
            {compact ? t('common:update') : label}
          </Button>
        </Tooltip>
      );
    }
    if (compact) return null;
    if (check?.status === 'chooseRef') {
      return (
        <Button
          disabled={disabled}
          loading={saving}
          size="small"
          onClick={() => {
            let ref = 'HEAD';
            confirmModal({
              title: t('agentSkillUpdate.chooseRef'),
              content: (
                <Input
                  aria-label={t('agentSkillUpdate.branch')}
                  defaultValue="HEAD"
                  placeholder={t('agentSkillUpdate.branch')}
                  onChange={(event) => {
                    ref = event.target.value.trim();
                  }}
                />
              ),
              okText: t('agentSkillUpdate.track'),
              onOk: () => save({ id: skill.id, ref: ref || 'HEAD', revision: check.revision }),
            });
          }}
        >
          {t('agentSkillUpdate.chooseRef')}
        </Button>
      );
    }
    return null;
  },
);
GitHubSkillUpdate.displayName = 'GitHubSkillUpdate';

export const GitHubSkillSource = memo<{ skill: SkillListItem }>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { check, checks } = useGitHubSkillCheck(skill.id);
  const { manifest, upstream } = skill;
  const label = t('agentSkillDetail.githubSource');
  const repositoryName = upstream ? `${upstream.owner}/${upstream.repo}` : manifest.repository;
  const repositoryUrl = manifest.repository ?? (upstream && `https://github.com/${repositoryName}`);
  const ref = upstream?.ref;
  const pinned = !!ref && ref === upstream?.installedCommit;
  const trackingLabel =
    ref === 'HEAD' ? t('agentSkillUpdate.defaultBranch') : pinned ? ref.slice(0, 7) : ref;
  const status = check?.status === 'update' ? 'available' : (check?.status ?? 'checking');

  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      content={
        <Flexbox gap={8} style={{ maxWidth: 'min(320px, 80vw)', overflowWrap: 'anywhere' }}>
          {repositoryUrl && (
            <a href={repositoryUrl} rel="noreferrer" target="_blank">
              {repositoryName}
            </a>
          )}
          {trackingLabel && (
            <Flexbox horizontal align="center" gap={4}>
              <Icon
                color={cssVar.colorTextSecondary}
                icon={pinned ? GitCommitHorizontal : GitBranch}
                size={14}
              />
              <Text fontSize={12} type="secondary">
                {trackingLabel}
              </Text>
            </Flexbox>
          )}
          {manifest.sourceUrl && manifest.sourceUrl !== repositoryUrl && (
            <a href={manifest.sourceUrl} rel="noreferrer" target="_blank">
              {upstream?.path || t('agentSkillDetail.installedSource')}
            </a>
          )}
          {(check || checks.isValidating) && (
            <Flexbox horizontal align="center" gap={8} justify="space-between">
              <Text fontSize={12} type="secondary">
                {t(`agentSkillUpdate.${status}`)}
              </Text>
              {check?.status !== 'pinned' && (
                <ActionIcon
                  aria-label={t('agentSkillUpdate.check')}
                  icon={RefreshCw}
                  loading={checks.isValidating}
                  size="small"
                  title={t('agentSkillUpdate.check')}
                  onClick={() => void checks.revalidate()}
                />
              )}
            </Flexbox>
          )}
        </Flexbox>
      }
    >
      <ActionIcon
        aria-label={label}
        fill={cssVar.colorTextDescription}
        icon={Github}
        size="small"
        title={label}
      />
    </Popover>
  );
});
GitHubSkillSource.displayName = 'GitHubSkillSource';
