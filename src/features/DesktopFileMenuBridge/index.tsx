'use client';

import { SESSION_CHAT_URL } from '@lobechat/const';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCreateMenuItems } from '@/app/[variants]/(main)/home/_layout/hooks/useCreateMenuItems';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

/**
 * Bridge component for handling File menu actions from Electron main process
 * Listens to broadcast events for creating new topics, agents, agent groups, and pages
 */
const DesktopFileMenuBridge = () => {
  const { createAgent, createEmptyGroup, createPage } = useCreateMenuItems();
  const navigate = useNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  // Handle create new topic from File menu
  // If currently in an agent page, create a new topic for the current agent
  // Otherwise, navigate to inbox agent
  const handleCreateNewTopic = useCallback(() => {
    const targetAgentId = activeAgentId || inboxAgentId;
    navigate(SESSION_CHAT_URL(targetAgentId, false));
  }, [activeAgentId, inboxAgentId, navigate]);

  // Handle create new agent from File menu
  const handleCreateNewAgent = useCallback(async () => {
    await createAgent();
  }, [createAgent]);

  // Handle create new agent group from File menu
  const handleCreateNewAgentGroup = useCallback(async () => {
    await createEmptyGroup();
  }, [createEmptyGroup]);

  // Handle create new page from File menu
  const handleCreateNewPage = useCallback(async () => {
    await createPage();
  }, [createPage]);

  useWatchBroadcast('createNewTopic', handleCreateNewTopic);
  useWatchBroadcast('createNewAgent', handleCreateNewAgent);
  useWatchBroadcast('createNewAgentGroup', handleCreateNewAgentGroup);
  useWatchBroadcast('createNewPage', handleCreateNewPage);

  return null;
};

export default DesktopFileMenuBridge;
