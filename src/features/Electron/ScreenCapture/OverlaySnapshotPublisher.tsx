'use client';

import type {
  ScreenCaptureAgentOption,
  ScreenCaptureModelOption,
  ScreenCaptureOverlayTheme,
} from '@lobechat/electron-client-ipc';
import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useMemo, useRef } from 'react';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import {
  homeSidebarSelectors,
  useHomeSidebarProjection,
} from '@/projection/modules/home/sidebarHooks';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentMeta, useAgentValue } from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { resolveOverlayAgentOptions, resolveOverlayDefaultAgentId } from './overlaySnapshot';

const PANEL_SHADOW_DARK = '0 4px 4px color-mix(in srgb, #000 40%, transparent)';
const PANEL_SHADOW_LIGHT = '0 4px 4px color-mix(in srgb, #000 4%, transparent)';

/**
 * Mirrors the main renderer's current agent/model lists into the electron main
 * process so the screen-capture overlay selector can render them. Data flow is
 * one-directional: renderer → main (cache) → overlay on open.
 */
const OverlaySnapshotPublisher = memo(() => {
  useFetchAgentList();

  const allAgents = useHomeSidebarProjection(homeSidebarSelectors.allAgents, isEqual);
  const theme = useTheme();
  const enabledChatModels = useEnabledChatModels();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentMeta(inboxAgentId);
  const agents = useMemo(() => allAgents.filter((item) => item.type === 'agent'), [allAgents]);

  const agentOptions = useMemo<ScreenCaptureAgentOption[]>(
    () =>
      resolveOverlayAgentOptions({
        agents,
        inboxAgentId,
        inboxMeta,
      }),
    [agents, inboxAgentId, inboxMeta],
  );

  const defaultAgentId = useMemo(
    () =>
      resolveOverlayDefaultAgentId({
        activeAgentId,
        agentOptions,
        inboxAgentId,
      }),
    [activeAgentId, agentOptions, inboxAgentId],
  );

  const modelOptions = useMemo<ScreenCaptureModelOption[]>(
    () =>
      enabledChatModels.flatMap((provider) =>
        provider.children.map((model) => ({
          displayName: model.displayName ?? model.id,
          id: model.id,
          provider: provider.id,
        })),
      ),
    [enabledChatModels],
  );

  const defaultModel = useAgentValue(defaultAgentId, (agent) =>
    defaultAgentId ? agentProjectionSelectors.model(agent) : undefined,
  );
  const defaultProvider = useAgentValue(defaultAgentId, (agent) =>
    defaultAgentId ? agentProjectionSelectors.provider(agent) : undefined,
  );

  const overlayTheme = useMemo<ScreenCaptureOverlayTheme>(
    () => ({
      colorBgElevated: theme.colorBgElevated,
      colorBorderSecondary: theme.colorBorderSecondary,
      colorFill: theme.colorFill,
      colorFillQuaternary: theme.colorFillQuaternary,
      colorFillSecondary: theme.colorFillSecondary,
      colorFillTertiary: theme.colorFillTertiary,
      colorPrimary: theme.colorPrimary,
      colorPrimaryActive: theme.colorPrimaryActive,
      colorPrimaryHover: theme.colorPrimaryHover,
      colorText: theme.colorText,
      colorTextLightSolid: theme.colorTextLightSolid,
      colorTextQuaternary: theme.colorTextQuaternary,
      colorTextSecondary: theme.colorTextSecondary,
      colorTextTertiary: theme.colorTextTertiary,
      panelBorder: theme.isDarkMode ? theme.colorFillSecondary : theme.colorFill,
      panelShadow: theme.isDarkMode ? PANEL_SHADOW_DARK : PANEL_SHADOW_LIGHT,
    }),
    [
      theme.colorBgElevated,
      theme.colorBorderSecondary,
      theme.colorFill,
      theme.colorFillQuaternary,
      theme.colorFillSecondary,
      theme.colorFillTertiary,
      theme.colorPrimary,
      theme.colorPrimaryActive,
      theme.colorPrimaryHover,
      theme.colorText,
      theme.colorTextLightSolid,
      theme.colorTextQuaternary,
      theme.colorTextSecondary,
      theme.colorTextTertiary,
      theme.isDarkMode,
    ],
  );

  const lastPublishedRef = useRef<string>('');

  useEffect(() => {
    const payload = {
      agents: agentOptions,
      defaultAgentId,
      defaultModelId: defaultModel,
      defaultProvider,
      models: modelOptions,
      theme: overlayTheme,
    };
    const signature = JSON.stringify(payload);
    if (signature === lastPublishedRef.current) return;
    lastPublishedRef.current = signature;

    try {
      ensureElectronIpc().screenCapture.publishOverlaySnapshot(payload);
    } catch (error) {
      // Preload bridge not mounted (e.g. web build) — publisher is a no-op.
      console.warn('[OverlaySnapshotPublisher] publish failed:', error);
    }
  }, [agentOptions, modelOptions, defaultAgentId, defaultModel, defaultProvider, overlayTheme]);

  return null;
});

OverlaySnapshotPublisher.displayName = 'OverlaySnapshotPublisher';

export default OverlaySnapshotPublisher;
