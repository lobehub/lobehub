'use client';

import { builtinTools } from '@lobechat/builtin-tools';
import type { BuiltinToolManifest, LobeChatPluginApi } from '@lobechat/types';

import type { ToolRenderFixture } from '../lifecycleMode';
import { buildSchemaSample, humanize, single, type ToolsetFixtureModule } from './_helpers';
import claudeCode from './claude-code';
import codex from './codex';
import github from './github';
import lobeActivator from './lobe-activator';
import lobeAgentBuilder from './lobe-agent-builder';
import lobeAgentDocuments from './lobe-agent-documents';
import lobeAgentManagement from './lobe-agent-management';
import lobeCloudSandbox from './lobe-cloud-sandbox';
import lobeGroupAgentBuilder from './lobe-group-agent-builder';
import lobeGroupManagement from './lobe-group-management';
import lobeGtd from './lobe-gtd';
import lobeKnowledgeBase from './lobe-knowledge-base';
import lobeLocalSystem from './lobe-local-system';
import lobeNotebook from './lobe-notebook';
import lobePageAgent from './lobe-page-agent';
import lobeSkillStore from './lobe-skill-store';
import lobeSkills from './lobe-skills';
import lobeUserInteraction from './lobe-user-interaction';
import lobeUserMemory from './lobe-user-memory';
import lobeWebBrowsing from './lobe-web-browsing';
import lobeWebOnboarding from './lobe-web-onboarding';

export type { ToolRenderFixture, ToolRenderFixtureVariant } from '../lifecycleMode';

export interface ToolRenderMeta {
  api?: LobeChatPluginApi;
  apiName: string;
  description?: string;
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export const DEVTOOLS_GROUP_ID = 'devtools-preview-group';

export const DEVTOOLS_GROUP_DETAIL = {
  agents: [
    {
      avatar: '🧭',
      backgroundColor: '#E8F3FF',
      id: 'researcher-agent',
      title: 'Researcher',
    },
    {
      avatar: '🛠',
      backgroundColor: '#FFF3E8',
      id: 'builder-agent',
      title: 'Builder',
    },
  ],
  avatar: '👥',
  backgroundColor: '#EEF2FF',
  description: 'Fixture group used by /devtools to preview grouped task renders.',
  id: DEVTOOLS_GROUP_ID,
  title: 'Devtools Preview Group',
};

const toolsetModules: ToolsetFixtureModule[] = [
  claudeCode,
  codex,
  github,
  lobeActivator,
  lobeAgentBuilder,
  lobeAgentDocuments,
  lobeAgentManagement,
  lobeCloudSandbox,
  lobeGroupAgentBuilder,
  lobeGroupManagement,
  lobeGtd,
  lobeKnowledgeBase,
  lobeLocalSystem,
  lobeNotebook,
  lobePageAgent,
  lobeSkillStore,
  lobeSkills,
  lobeUserInteraction,
  lobeUserMemory,
  lobeWebBrowsing,
  lobeWebOnboarding,
];

const fixtureRegistry = new Map<string, ToolRenderFixture>();
const customToolsets = new Map<string, ToolsetFixtureModule>();

for (const toolset of toolsetModules) {
  customToolsets.set(toolset.identifier, toolset);
  for (const [apiName, fixture] of Object.entries(toolset.fixtures)) {
    fixtureRegistry.set(`${toolset.identifier}:${apiName}`, fixture);
  }
}

const manifestByIdentifier = new Map<string, BuiltinToolManifest>(
  builtinTools.map((tool) => [tool.identifier, tool.manifest]),
);

export const getToolRenderFixture = (
  identifier: string,
  apiName: string,
  api?: LobeChatPluginApi,
): ToolRenderFixture => {
  const fixture = fixtureRegistry.get(`${identifier}:${apiName}`);
  if (fixture) return fixture;

  return single({
    args: buildSchemaSample(api?.parameters, apiName) || {},
  });
};

export const getToolRenderMeta = (identifier: string, apiName: string): ToolRenderMeta => {
  const manifest = manifestByIdentifier.get(identifier);
  const api = manifest?.api.find((item) => item.name === apiName);
  const customToolset = customToolsets.get(identifier);
  const customApi = customToolset?.apiList?.find((item) => item.name === apiName);

  return {
    api,
    apiName,
    description: api?.description || customApi?.description,
    identifier,
    toolsetDescription: manifest?.meta.description || customToolset?.meta?.description,
    toolsetName: manifest?.meta.title || customToolset?.meta?.title || humanize(identifier),
  };
};
