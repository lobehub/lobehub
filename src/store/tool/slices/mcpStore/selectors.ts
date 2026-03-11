import { type InstallPluginMeta } from '@/types/tool/plugin';

import { type ToolStoreState } from '../../initialState';

const mcpPluginList = (s: ToolStoreState) => {
  const installedPluginIds = new Set(s.installedPlugins.map((i) => i.identifier));
  const list =
    s.listType === 'mcp'
      ? s.mcpPluginItems
      : s.mcpPluginItems.filter((p) => installedPluginIds.has(p.identifier));

  return list.map<InstallPluginMeta>((p) => ({
    author: p.author,
    createdAt: p.createdAt,
    homepage: p.homepage,
    identifier: p.identifier,
    meta: {
      avatar: p.icon!,
      description: p.description,
      tags: p.tags,
      title: p.name,
    },
    type: 'plugin',
  }));
};

const isPluginInstallLoading = (id: string) => (s: ToolStoreState) => s.pluginInstallLoading[id];

const getMCPInstallProgress = (id: string) => (s: ToolStoreState) => s.mcpInstallProgress[id];

const isMCPInstalling = (id: string) => (s: ToolStoreState) => !!s.mcpInstallProgress[id];

const getPluginById = (id: string) => (s: ToolStoreState) => {
  return s.mcpPluginItems.find((i) => i.identifier === id);
};

const activeMCPPluginIdentifier = (s: ToolStoreState) => s.activeMCPIdentifier;

const getMCPPluginRequiringConfig = (id: string) => (s: ToolStoreState) =>
  s.mcpInstallProgress[id]?.configSchema;

const isMCPPluginRequiringConfig = (id: string) => (s: ToolStoreState) =>
  !!s.mcpInstallProgress[id]?.configSchema;

// Check if plugin is installing (has install progress and not in config stage)
const isMCPInstallInProgress = (id: string) => (s: ToolStoreState) => {
  const progress = s.mcpInstallProgress[id];

  return !!progress && !progress.needsConfig && progress.step !== 'Error';
};

// Test connection related selectors
const isMCPConnectionTesting = (id: string) => (s: ToolStoreState) => s.mcpTestLoading[id] || false;

const getMCPConnectionTestError = (id: string) => (s: ToolStoreState) => s.mcpTestErrors[id];

const getMCPConnectionTestState = (id: string) => (s: ToolStoreState) => ({
  error: s.mcpTestErrors[id],
  loading: s.mcpTestLoading[id] || false,
});

export const mcpStoreSelectors = {
  activeMCPPluginIdentifier,
  getMCPConnectionTestError,
  getMCPConnectionTestState,
  getMCPInstallProgress,
  getMCPPluginRequiringConfig,
  getPluginById,
  isMCPConnectionTesting,
  isMCPInstallInProgress,
  isMCPInstalling,
  isMCPPluginRequiringConfig,
  isPluginInstallLoading,
  mcpPluginList,
};
