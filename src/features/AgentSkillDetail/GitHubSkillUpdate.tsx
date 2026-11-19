'use client';

import type { SkillListItem } from '@lobechat/types';
import { ActionIcon, Button, confirmModal, Flexbox, Input, Text, toast } from '@lobehub/ui';
import { RefreshCw } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useToolStore } from '@/store/tool';
import { AGENT_SKILL_LIST_KEY } from '@/store/tool/slices/agentSkills/projection';

export const hasGitHubSource = (skill: SkillListItem) =>
  !!skill.upstream ||
  (skill.source === 'market' &&
    /^(?:https?:\/\/)?(?:github\.com\/|[\w.-]+\/[\w.-]+$)/.test(skill.manifest?.sourceUrl ?? ''));

export const GitHubSkillUpdate = memo<{ compact?: boolean; skill: SkillListItem }>(
  ({ compact, skill }) => {
    const { t } = useTranslation('setting');
    const [saving, setSaving] = useState(false);
    const { allowed: canEdit } = usePermission('edit_own_content');
    const canManage = useResourceManageable(skill.userId);
    const sync = useToolStore((s) => s.syncGitHubSkill);
    const checks = useToolStore((s) => s.useCheckGitHubSkills)();
    const status = useToolStore((s) => s.gitHubUpdateMap[AGENT_SKILL_LIST_KEY]?.[skill.id]);
    const check = checks.error ? { status: 'unavailable' as const } : status;
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
      return (
        <Button
          disabled={disabled}
          loading={saving}
          size="small"
          onClick={(event) => {
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
          }}
        >
          {t('agentSkillUpdate.apply')}
        </Button>
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
    if (!check && !checks.isValidating) return null;
    return (
      <Flexbox horizontal align="center" gap={4}>
        <Text type="secondary">{t(`agentSkillUpdate.${check?.status ?? 'checking'}`)}</Text>
        {check?.status !== 'pinned' && (
          <ActionIcon
            icon={RefreshCw}
            loading={checks.isValidating}
            size="small"
            title={t('agentSkillUpdate.check')}
            onClick={() => void checks.revalidate()}
          />
        )}
      </Flexbox>
    );
  },
);
GitHubSkillUpdate.displayName = 'GitHubSkillUpdate';
