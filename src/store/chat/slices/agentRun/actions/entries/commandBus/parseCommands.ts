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

export interface SingleAgentMentionDirectRoute {
  agent: RuntimeMentionedAgent;
}

export interface ParsedLocalFileReference {
  isDirectory?: boolean;
  name: string;
  path: string;
}

const appendLocalFileReference = (
  references: ParsedLocalFileReference[],
  seen: Set<string>,
  reference: ParsedLocalFileReference,
) => {
  if (!reference.path || seen.has(reference.path)) return;

  seen.add(reference.path);
  references.push(reference);
};

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

export const parseLocalFileReferencesFromEditorData = (
  editorData: Record<string, any> | undefined,
): ParsedLocalFileReference[] => {
  if (!editorData) return [];

  const references: ParsedLocalFileReference[] = [];
  const seen = new Set<string>();

  walkMentionNode(editorData.root, (label, metadata) => {
    if (metadata?.type !== 'localFile') return;

    const path = metadata.path as string | undefined;
    if (!path) return;

    appendLocalFileReference(references, seen, {
      isDirectory: metadata.isDirectory === true,
      name: (metadata.name as string | undefined) || label || path.split('/').pop() || path,
      path,
    });
  });

  return references;
};

export const mergeLocalFileReferences = (
  references: ParsedLocalFileReference[],
): ParsedLocalFileReference[] => {
  const merged: ParsedLocalFileReference[] = [];
  const seen = new Set<string>();

  for (const reference of references) {
    appendLocalFileReference(merged, seen, reference);
  }

  return merged;
};

/**
 * Detect the direct-route shorthand:
 * exactly one mention node in the whole document, and that mention is the
 * first meaningful node and points to an agent.
 */
export const parseSingleAgentMentionDirectRoute = (
  editorData: Record<string, any> | undefined,
): SingleAgentMentionDirectRoute | undefined => {
  if (!editorData) return;

  const mentions: Array<{
    label: string;
    metadata: Record<string, unknown>;
    node: any;
  }> = [];
  let firstMeaningfulNode: any;

  walkMeaningfulNode(editorData.root, (node) => {
    firstMeaningfulNode ??= node;

    if (node.type === 'mention' && node.metadata) {
      mentions.push({
        label: node.label ?? '',
        metadata: node.metadata,
        node,
      });
    }
  });

  if (mentions.length !== 1) return;

  const [mention] = mentions;
  if (firstMeaningfulNode !== mention.node) return;
  if (mention.metadata.type !== 'agent') return;

  const id = typeof mention.metadata.id === 'string' ? mention.metadata.id : undefined;
  if (!id) return;

  return {
    agent: {
      id,
      name: mention.label || id,
    },
  };
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

function walkMeaningfulNode(node: any, cb: (node: any) => void): void {
  if (!node) return;

  if (isMeaningfulNode(node)) {
    cb(node);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkMeaningfulNode(child, cb);
    }
  }
}

function isMeaningfulNode(node: any): boolean {
  if (!node?.type || Array.isArray(node.children)) return false;

  if (node.type === 'text') {
    return typeof node.text === 'string' && node.text.trim().length > 0;
  }

  if (node.type === 'linebreak') return false;

  return true;
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
