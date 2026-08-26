'use client';

import { AGENT_SHARE_MAX_TOPICS_PER_VISITOR } from '@lobechat/const';
import { getActivePluginIds } from '@lobechat/types';
import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button, Select, Switch, toast } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginTag from '@/features/ProfileEditor/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { type AgentShareLimitDraft, clearCommittedLimitDraft } from './limitDraft';
import { Section, SettingRow } from './SectionLayout';
import { type AgentShareConfigPatch, useAgentShare } from './useAgentShare';
import { type AgentShareLimitPatch, useDebouncedLimitPatch } from './useDebouncedLimitPatch';

type FileAccess = 'none' | 'read';

interface SettingsContentProps {
  agentId: string;
}

/**
 * Permission / tool / limit configuration sections of the share settings page.
 * Every control saves immediately (issue acceptance): each patch is merged over
 * the server-normalized config because `updateShareConfig` replaces the whole
 * object under a strict schema.
 */
const SettingsContent = memo<SettingsContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');

  const { createError, isCreating, isLoading, retryCreate, shareInfo, updateConfig } =
    useAgentShare(agentId, true);
  const shareConfig = shareInfo?.shareConfig;

  const agentConfig = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const candidateToolIds = getActivePluginIds(agentConfig?.plugins);

  const handleConfigChange = useCallback(
    async (patch: AgentShareConfigPatch) => {
      try {
        await updateConfig(patch);
      } catch {
        toast.error(t('share.updateError'));
      }
    },
    [updateConfig, t],
  );

  const toggleTool = useCallback(
    (toolId: string) => {
      handleConfigChange((currentConfig) => {
        const currentToolIds = currentConfig.enabledToolIds ?? [];

        return {
          enabledToolIds: currentToolIds.includes(toolId)
            ? currentToolIds.filter((id) => id !== toolId)
            : [...currentToolIds, toolId],
        };
      });
    },
    [handleConfigChange],
  );

  // Visitor limits keep a local draft so typing doesn't fire a request per
  // keystroke; valid values commit after a short debounce (blur alone would
  // lose stepper-button edits when the modal closes right after).
  const [limitDraft, setLimitDraft] = useState<AgentShareLimitDraft>({});
  const clearLimitDraft = useCallback((patch: AgentShareLimitPatch) => {
    setLimitDraft((draft) => clearCommittedLimitDraft(draft, patch));
  }, []);
  const handleLimitCommit = useCallback(
    async (patch: AgentShareLimitPatch) => {
      await updateConfig(patch);
      clearLimitDraft(patch);
    },
    [clearLimitDraft, updateConfig],
  );
  const handleLimitCommitError = useCallback(
    (patch: AgentShareLimitPatch) => {
      clearLimitDraft(patch);
      toast.error(t('share.updateError'));
    },
    [clearLimitDraft, t],
  );
  const scheduleLimitCommit = useDebouncedLimitPatch(handleLimitCommit, handleLimitCommitError);

  const handleLimitChange = useCallback(
    (field: 'maxTopicsPerVisitor' | 'maxTurnsPerTopic', value: number | null) => {
      setLimitDraft((prev) => ({ ...prev, [field]: value }));
      scheduleLimitCommit(field, value);
    },
    [scheduleLimitCommit],
  );

  if (createError) {
    return (
      <Flexbox align="flex-start" gap={12}>
        <Text type="danger">{t('share.createError')}</Text>
        <Button loading={isCreating} size="small" onClick={retryCreate}>
          {t('retry', { ns: 'common' })}
        </Button>
      </Flexbox>
    );
  }

  if (isLoading || !shareConfig) {
    return (
      <Flexbox gap={16}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Flexbox>
    );
  }

  const fileAccessOptions = [
    { label: t('share.settings.permissions.fileAccess.none'), value: 'none' },
    { label: t('share.settings.permissions.fileAccess.read'), value: 'read' },
  ];

  const filePermission = shareConfig.filePermissionConfig;

  return (
    <Flexbox gap={16}>
      <Section
        desc={t('share.settings.permissions.desc')}
        title={t('share.settings.permissions.title')}
      >
        <Flexbox gap={12}>
          <SettingRow label={t('share.settings.permissions.allowReadMemory')}>
            <Switch
              checked={shareConfig.allowReadMemory ?? false}
              onChange={(checked) => handleConfigChange({ allowReadMemory: checked })}
            />
          </SettingRow>
          <SettingRow label={t('share.settings.permissions.agentFiles')}>
            <Select
              options={fileAccessOptions}
              style={{ width: 160 }}
              value={filePermission?.agentFiles ?? 'none'}
              onChange={(value: FileAccess) =>
                handleConfigChange({
                  filePermissionConfig: { agentFiles: value },
                })
              }
            />
          </SettingRow>
          <SettingRow label={t('share.settings.permissions.knowledgeBase')}>
            <Select
              options={fileAccessOptions}
              style={{ width: 160 }}
              value={filePermission?.knowledgeBase ?? 'none'}
              onChange={(value: FileAccess) =>
                handleConfigChange({
                  filePermissionConfig: { knowledgeBase: value },
                })
              }
            />
          </SettingRow>
          {/* v1 has no visitor upload entry point (VisitorComposer is text-only and
          shareChat.execAgent has no file parameter), so the switch stays disabled
          rather than confirming a permission the UI cannot exercise yet. The
          underlying `uploadAllowed` field is left alone for forward compatibility. */}
          <SettingRow
            desc={t('share.settings.permissions.uploadAllowedComingSoon')}
            label={t('share.settings.permissions.uploadAllowed')}
          >
            <Switch disabled checked={filePermission?.uploadAllowed ?? false} />
          </SettingRow>
        </Flexbox>
      </Section>

      <Section desc={t('share.settings.tools.desc')} title={t('share.settings.tools.title')}>
        {candidateToolIds.length === 0 ? (
          <Text fontSize={12} type="secondary">
            {t('share.settings.tools.empty')}
          </Text>
        ) : (
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            {candidateToolIds.map((toolId) => (
              <PluginTag
                selectable
                useAllMetaList
                agentId={agentId}
                key={toolId}
                pluginId={toolId}
                selected={(shareConfig.enabledToolIds ?? []).includes(toolId)}
                onSelect={() => toggleTool(toolId)}
              />
            ))}
          </Flexbox>
        )}
      </Section>

      <Section desc={t('share.settings.limits.desc')} title={t('share.settings.limits.title')}>
        <Flexbox gap={12}>
          <SettingRow
            label={t('share.settings.limits.maxTopicsPerVisitor')}
            desc={t('share.settings.limits.maxTopicsPerVisitorHint', {
              // i18next's generated interpolation types default `{{max}}` to
              // `string` (no `{{max, number}}` format specifier), so pass a
              // string even though the source constant is numeric.
              max: String(AGENT_SHARE_MAX_TOPICS_PER_VISITOR),
            })}
          >
            <InputNumber
              max={AGENT_SHARE_MAX_TOPICS_PER_VISITOR}
              min={1}
              precision={0}
              style={{ width: 160 }}
              value={limitDraft.maxTopicsPerVisitor ?? shareConfig.maxTopicsPerVisitor}
              onChange={(value) => handleLimitChange('maxTopicsPerVisitor', value)}
            />
          </SettingRow>
          <SettingRow label={t('share.settings.limits.maxTurnsPerTopic')}>
            <InputNumber
              min={1}
              precision={0}
              style={{ width: 160 }}
              value={limitDraft.maxTurnsPerTopic ?? shareConfig.maxTurnsPerTopic}
              onChange={(value) => handleLimitChange('maxTurnsPerTopic', value)}
            />
          </SettingRow>
        </Flexbox>
      </Section>
    </Flexbox>
  );
});

SettingsContent.displayName = 'AgentShareSettingsContent';

export default SettingsContent;
