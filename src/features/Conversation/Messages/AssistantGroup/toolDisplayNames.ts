import { type ChatToolPayloadWithResult } from '@lobechat/types';

import { type AssistantContentBlock } from '@/types/index';

// apiName → past-tense human-readable label
const toolDisplayNames: Record<string, string> = {
  // Web browsing
  crawlMultiPages: 'Crawled pages',
  crawlSinglePage: 'Crawled a page',
  search: 'Searched the web',

  // Knowledge base
  readKnowledge: 'Read knowledge',
  searchKnowledgeBase: 'Searched knowledge base',

  // Notebook
  createDocument: 'Created a document',
  deleteDocument: 'Deleted a document',
  getDocument: 'Read a document',
  updateDocument: 'Updated a document',

  // Agent documents
  copyDocument: 'Copied a document',
  editDocument: 'Edited a document',
  listDocuments: 'Listed documents',
  readDocument: 'Read a document',
  readDocumentByFilename: 'Read a document',
  removeDocument: 'Removed a document',
  renameDocument: 'Renamed a document',
  upsertDocumentByFilename: 'Updated a document',
  updateLoadRule: 'Updated load rule',

  // Calculator
  calculate: 'Calculated',
  evaluate: 'Evaluated expression',
  solve: 'Solved equation',
  execute: 'Executed calculation',

  // Local system
  editLocalFile: 'Edited a file',
  globLocalFiles: 'Searched files',
  grepContent: 'Searched content',
  killCommand: 'Stopped a command',
  listLocalFiles: 'Listed files',
  moveLocalFiles: 'Moved files',
  readLocalFile: 'Read a file',
  renameLocalFile: 'Renamed a file',
  runCommand: 'Ran a command',
  searchLocalFiles: 'Searched files',
  writeLocalFile: 'Wrote a file',
  getCommandOutput: 'Read command output',

  // Cloud sandbox
  executeCode: 'Executed code',

  // GTD
  createPlan: 'Created a plan',
  createTodos: 'Created todos',
  updatePlan: 'Updated plan',
  updateTodos: 'Updated todos',
  clearTodos: 'Cleared todos',
  execTask: 'Executed a task',
  execTasks: 'Executed tasks',

  // Memory
  addActivityMemory: 'Saved memory',
  addContextMemory: 'Saved memory',
  addExperienceMemory: 'Saved memory',
  addIdentityMemory: 'Saved memory',
  addPreferenceMemory: 'Saved memory',
  removeIdentityMemory: 'Removed memory',
  searchUserMemory: 'Searched memory',
  updateIdentityMemory: 'Updated memory',

  // Agent management
  callAgent: 'Called an agent',
  createAgent: 'Created an agent',
  deleteAgent: 'Deleted an agent',
  searchAgent: 'Searched agents',
  updateAgent: 'Updated an agent',

  // Page agent
  editTitle: 'Edited title',
  getPageContent: 'Read page content',
  initPage: 'Initialized page',
  modifyNodes: 'Modified page',
  replaceText: 'Replaced text',

  // Skills
  activateSkill: 'Activated a skill',
  activateTools: 'Activated tools',
  execScript: 'Executed a script',

  // Skill store
  importFromMarket: 'Imported from market',
  importSkill: 'Imported a skill',
  searchSkill: 'Searched skills',

  // Misc
  finishOnboarding: 'Finished onboarding',
  getOnboardingState: 'Checked onboarding state',
  getTopicContext: 'Read topic context',
  listOnlineDevices: 'Listed devices',
  activateDevice: 'Activated device',
};

const toTitleCase = (apiName: string): string => {
  return apiName
    .replaceAll(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
};

export const getToolDisplayName = (apiName: string): string => {
  return toolDisplayNames[apiName] || toTitleCase(apiName);
};

export const getToolSummaryText = (tools: ChatToolPayloadWithResult[]): string => {
  const groups = new Map<string, number>();
  for (const tool of tools) {
    groups.set(tool.apiName, (groups.get(tool.apiName) || 0) + 1);
  }

  const parts: string[] = [];
  for (const [apiName, count] of groups) {
    const name = getToolDisplayName(apiName);
    if (count > 1) {
      parts.push(`${name} (${count})`);
    } else {
      parts.push(name);
    }
  }

  return parts.join(', ');
};

export const hasToolError = (tools: ChatToolPayloadWithResult[]): boolean => {
  return tools.some((t) => t.result?.error);
};

export const getToolFirstDetail = (tool: ChatToolPayloadWithResult): string => {
  try {
    const args = JSON.parse(tool.arguments || '{}');
    const values = Object.values(args);
    for (const val of values) {
      if (typeof val === 'string' && val.trim()) {
        return val.length > 80 ? val.slice(0, 80) + '...' : val;
      }
    }
  } catch {
    // arguments still streaming or invalid
  }
  return '';
};

export const formatReasoningDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

export const getWorkflowSummaryText = (blocks: AssistantContentBlock[]): string => {
  const tools = blocks.flatMap((b) => b.tools ?? []);

  const groups = new Map<string, { count: number; errorCount: number }>();
  for (const tool of tools) {
    const existing = groups.get(tool.apiName) || { count: 0, errorCount: 0 };
    existing.count++;
    if (tool.result?.error) existing.errorCount++;
    groups.set(tool.apiName, existing);
  }

  const toolParts: string[] = [];
  for (const [apiName, { count, errorCount }] of groups) {
    let part = getToolDisplayName(apiName);
    if (count > 1) part += ` (${count})`;
    if (errorCount > 0) part += ' (failed)';
    toolParts.push(part);
  }

  let result = toolParts.join(', ');

  const totalReasoningMs = blocks.reduce((sum, b) => sum + (b.reasoning?.duration ?? 0), 0);
  if (totalReasoningMs > 0) {
    result += ` · Thought for ${formatReasoningDuration(totalReasoningMs)}`;
  }

  return result;
};
