'use client';

import { upsertPluginMode } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useEffect, useRef, useState } from 'react';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface PendingConnection {
  authConfigId: string;
  connectedAccountId: string;
  redirectUrl?: string;
}

interface Options {
  agentId: string;
  appSlug: string;
  identifier: string;
  label: string;
}

/**
 * Agent-scoped Composio connect — the "clean" path that does NOT touch the
 * user-scoped composio store. It drives the connect/activate flow directly
 * against the lambda router with `agentId`, so the account lands on an
 * agent-owned connector row (`user_connectors.agent_id`), and derives
 * "connected" from the agent's own connectors (not the user's).
 */
export const useAgentComposioConnect = ({ agentId, appSlug, identifier, label }: Options) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const pendingRef = useRef<PendingConnection | null>(null);
  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agentConnectors = useToolStore(connectorSelectors.agentConnectors(agentId), isEqual);
  const fetchAgentConnectors = useToolStore((s) => s.fetchAgentConnectors);
  const detachConnectorFromAgent = useToolStore((s) => s.detachConnectorFromAgent);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const agentRow = agentConnectors.find(
    (c) => c.identifier === identifier && c.agentId === agentId && !!c.metadata?.composio,
  );
  const isConnected = !!agentRow;

  const cleanup = useCallback(() => {
    for (const ref of [windowCheckIntervalRef, pollIntervalRef]) {
      if (ref.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    oauthWindowRef.current = null;
    setIsWaitingAuth(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  /** After OAuth returns ACTIVE, write the agent connector row + pin the tool. */
  const activate = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    try {
      const status = await lambdaClient.composio.getConnection.query({
        connectedAccountId: pending.connectedAccountId,
      });
      if (status.status !== 'ACTIVE') return;

      const toolsResp = await toolsClient.composio.listActions.query({ appSlug });
      const tools = (toolsResp.tools ?? []).map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
      }));

      await lambdaClient.composio.updateComposioPlugin.mutate({
        agentId,
        appSlug,
        authConfigId: pending.authConfigId,
        connectedAccountId: pending.connectedAccountId,
        identifier,
        label,
        redirectUrl: pending.redirectUrl,
        status: 'ACTIVE',
        tools,
      });

      // Pin the tool for this agent so the runtime actually resolves it.
      const config = agentSelectors.getAgentConfigById(agentId)(useAgentStore.getState());
      await updateAgentConfigById(agentId, {
        plugins: upsertPluginMode(config?.plugins, identifier, 'pinned'),
      });

      await fetchAgentConnectors(agentId);
      pendingRef.current = null;
    } catch (error) {
      console.error('[AgentSkillStore] activate failed:', error);
    }
  }, [agentId, appSlug, identifier, label, updateAgentConfigById, fetchAgentConnectors]);

  const startFallbackPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      activate().then(() => {
        if (pendingRef.current === null) cleanup();
      });
    }, POLL_INTERVAL_MS);
    pollTimeoutRef.current = setTimeout(cleanup, POLL_TIMEOUT_MS);
  }, [activate, cleanup]);

  const startWindowMonitor = useCallback(
    (oauthWindow: Window) => {
      windowCheckIntervalRef.current = setInterval(async () => {
        if (oauthWindow.closed) {
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          await activate();
          cleanup();
        }
      }, 500);
    },
    [activate, cleanup],
  );

  const openOAuthWindow = useCallback(
    (redirectUrl: string) => {
      cleanup();
      setIsWaitingAuth(true);
      const oauthWindow = window.open(redirectUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow);
      } else {
        startFallbackPolling();
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  const handleConnect = useCallback(async () => {
    if (isConnected) return;
    setIsConnecting(true);
    try {
      const conn = await lambdaClient.composio.createConnection.mutate({
        agentId,
        appSlug,
        identifier,
        label,
      });
      pendingRef.current = {
        authConfigId: conn.authConfigId,
        connectedAccountId: conn.connectedAccountId,
        redirectUrl: conn.redirectUrl,
      };
      if (conn.redirectUrl) {
        openOAuthWindow(conn.redirectUrl);
      } else {
        await activate();
      }
    } catch (error) {
      console.error('[AgentSkillStore] connect failed:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnected, agentId, appSlug, identifier, label, openOAuthWindow, activate]);

  const handleDisconnect = useCallback(async () => {
    if (!agentRow) return;
    await detachConnectorFromAgent(agentRow.id, agentId, 'delete');
  }, [agentRow, agentId, detachConnectorFromAgent]);

  return {
    handleConnect,
    handleDisconnect,
    isConnected,
    isConnecting: isConnecting || isWaitingAuth,
  };
};
