import type {
  RuntimeMentionedAgent,
  RuntimeSelectedSkill,
  RuntimeSelectedTool,
} from '@lobechat/types';

import type {
  ActionTagCategory,
  ActionTagType,
} from '@/features/ChatInput/InputEditor/ActionTag/types';

export interface ParsedActionTag {
  category: ActionTagCategory;
  label: string;
  type: ActionTagType;
}

export interface ParsedCommand extends ParsedActionTag {}

/**
 * Walk the Lexical JSON tree to find all action-tag nodes.
 * Returns the extracted action tags in document order.
 */
export const parseActionTagsFromEditorData = (
  editorData: Record<string, any> | undefined,
): ParsedActionTag[] => {
  if (!editorData) return [];

  const actionTags: ParsedActionTag[] = [];
  walkNode(editorData.root, actionTags);
  return actionTags;
};

export const parseCommandsFromEditorData = (
  editorData: Record<string, any> | undefined,
): ParsedCommand[] => parseActionTagsFromEditorData(editorData);

export const parseSelectedSkillsFromEditorData = (
  editorData: Record<string, any> | undefined,
): RuntimeSelectedSkill[] => {
  const actionTags = parseActionTagsFromEditorData(editorData);
  const selectedSkills = actionTags.filter((tag) => tag.category === 'skill');

  if (selectedSkills.length === 0) return [];

  const seen = new Set<string>();

  return selectedSkills.reduce<RuntimeSelectedSkill[]>((acc, skill) => {
    const identifier = String(skill.type);
    if (!identifier || seen.has(identifier)) return acc;

    seen.add(identifier);
    acc.push({
      identifier,
      name: skill.label || identifier,
    });

    return acc;
  }, []);
};

export const parseSelectedToolsFromEditorData = (
  editorData: Record<string, any> | undefined,
): RuntimeSelectedTool[] => {
  const actionTags = parseActionTagsFromEditorData(editorData);
  const selectedTools = actionTags.filter((tag) => tag.category === 'tool');

  if (selectedTools.length === 0) return [];

  const seen = new Set<string>();

  return selectedTools.reduce<RuntimeSelectedTool[]>((acc, tool) => {
    const identifier = String(tool.type);
    if (!identifier || seen.has(identifier)) return acc;

    seen.add(identifier);
    acc.push({
      identifier,
      name: tool.label || identifier,
    });

    return acc;
  }, []);
};

/**
 * Walk the editor JSON tree to find all mention nodes (type: 'mention')
 * and extract agent info from their metadata.
 */
export const parseMentionedAgentsFromEditorData = (
  editorData: Record<string, any> | undefined,
): RuntimeMentionedAgent[] => {
  if (!editorData) return [];

  const agents: RuntimeMentionedAgent[] = [];
  const seen = new Set<string>();

  walkMentionNode(editorData.root, (label, metadata) => {
    // Only accept explicit agent mentions — skip topics, ALL_MEMBERS, and other types
    if (metadata?.type !== 'agent') return;
    const id = metadata?.id as string | undefined;
    if (!id || seen.has(id)) return;

    seen.add(id);
    agents.push({ id, name: label || id });
  });

  return agents;
};

/**
 * Check if editorData contains any meaningful text content
 * besides action-tag nodes (whitespace-only counts as empty).
 */
export const hasNonActionContent = (editorData: Record<string, any> | undefined): boolean => {
  if (!editorData) return false;
  const parts: string[] = [];
  collectText(editorData.root, parts);
  return parts.join('').trim().length > 0;
};

function collectText(node: any, out: string[]): void {
  if (!node) return;
  if (node.type === 'action-tag') return;
  if (node.type === 'text' && typeof node.text === 'string') {
    out.push(node.text);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectText(child, out);
    }
  }
}

function walkMentionNode(
  node: any,
  cb: (label: string, metadata: Record<string, unknown>) => void,
): void {
  if (!node) return;
  if (node.type === 'mention' && node.metadata) {
    cb(node.label ?? '', node.metadata);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkMentionNode(child, cb);
    }
  }
}

function walkNode(node: any, out: ParsedActionTag[]): void {
  if (!node) return;

  if (node.type === 'action-tag') {
    out.push({
      category: node.actionCategory,
      label: node.actionLabel,
      type: node.actionType,
    });
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkNode(child, out);
    }
  }
}
