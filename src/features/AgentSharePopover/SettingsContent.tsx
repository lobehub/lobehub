'use client';

import { getActivePluginIds } from '@lobechat/types';
import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Select, Switch, toast } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentShareSettingsExtension from '@/business/client/features/AgentShareSettingsExtension';
import PluginTag from '@/features/ProfileEditor/PluginTag';
import type { AgentShareConfigInput } from '@/server/routers/lambda/agentShare';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { Section, SettingRow } from './SectionLayout';
import { useAgentShare } from './useAgentShare';

type FileAccess = 'none' | 'read';

const LIMIT_COMMIT_DELAY = 500;

interface SettingsContentProps {
  agentId: string;
}

/**
 * The heavier share configuration behind the popover's "Share Settings" entry.
 * Every control saves immediately (issue acceptance): each patch is merged over
 * the server-normalized config because `updateShareConfig` replaces the whole
 * object under a strict schema.
 */
const SettingsContent = memo<SettingsContentProps>(({ agentId }) => {
  const { t } = useTranslation('agent');

  const { isLoading, shareInfo, updateConfig } = useAgentShare(agentId, true);
  const shareConfig = shareInfo?.shareConfig;

  const agentConfig = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const candidateToolIds = getActivePluginIds(agentConfig?.plugins);

  const handleConfigChange = useCallback(
    async (patch: Partial<AgentShareConfigInput>) => {
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
      const current = shareConfig?.enabledToolIds ?? [];
      const next = current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId];
      handleConfigChange({ enabledToolIds: next });
    },
    [shareConfig?.enabledToolIds, handleConfigChange],
  );

  // Visitor limits keep a local draft so typing doesn't fire a request per
  // keystroke; valid values commit after a short debounce (blur alone would
  // lose stepper-button edits when the modal closes right after).
  const [limitDraft, setLimitDraft] = useState<{
    maxTopicsPerVisitor?: number | null;
    maxTurnsPerTopic?: number | null;
  }>({});
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    },
    [],
  );

  const handleLimitChange = useCallback(
    (field: 'maxTopicsPerVisitor' | 'maxTurnsPerTopic', value: number | null) => {
      setLimitDraft((prev) => ({ ...prev, [field]: value }));
      if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return;
      limitTimerRef.current = setTimeout(() => {
        handleConfigChange({ [field]: value });
      }, LIMIT_COMMIT_DELAY);
    },
    [handleConfigChange],
  );

  if (isLoading || !shareConfig) {
    return (
      <Flexbox gap={16} padding={16}>
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
    <Flexbox gap={24} padding={16} style={{ maxHeight: '65vh', overflowY: 'auto' }}>
      <AgentShareSettingsExtension agentId={agentId} />
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
                  filePermissionConfig: { ...filePermission, agentFiles: value },
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
                  filePermissionConfig: { ...filePermission, knowledgeBase: value },
                })
              }
            />
          </SettingRow>
          <SettingRow label={t('share.settings.permissions.uploadAllowed')}>
            <Switch
              checked={filePermission?.uploadAllowed ?? false}
              onChange={(checked) =>
                handleConfigChange({
                  filePermissionConfig: { ...filePermission, uploadAllowed: checked },
                })
              }
            />
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
          <SettingRow label={t('share.settings.limits.maxTopicsPerVisitor')}>
            <InputNumber
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
