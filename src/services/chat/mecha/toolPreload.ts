import type { RuntimeSelectedTool } from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';

// Match <tool name="..." label="..." /> and legacy <action type="..." category="tool" ... />
const TOOL_TAG_REGEX = /<tool\b([^>]*)\/>/g;
const LEGACY_ACTION_TAG_REGEX = /<action\b([^>]*)\/>/g;

const getAttr = (attrs: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
};

export const extractSelectedToolsFromText = (text: string): RuntimeSelectedTool[] => {
  const parsedTools: RuntimeSelectedTool[] = [];

  // New format: <tool name="..." label="..." />
  for (const match of text.matchAll(TOOL_TAG_REGEX)) {
    const attrs = match[1] || '';
    const identifier = getAttr(attrs, 'name');
    if (!identifier) continue;
    parsedTools.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  // Legacy format: <action type="..." category="tool" label="..." />
  for (const match of text.matchAll(LEGACY_ACTION_TAG_REGEX)) {
    const attrs = match[1] || '';
    if (getAttr(attrs, 'category') !== 'tool') continue;
    const identifier = getAttr(attrs, 'type');
    if (!identifier) continue;
    parsedTools.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  return parsedTools;
};

const resolveSelectedTools = (
  message: string,
  selectedTools?: RuntimeSelectedTool[],
): RuntimeSelectedTool[] => {
  const merged = [...(selectedTools || []), ...extractSelectedToolsFromText(message)];
  const seen = new Set<string>();

  return merged.reduce<RuntimeSelectedTool[]>((acc, tool) => {
    if (!tool.identifier || seen.has(tool.identifier)) return acc;
    seen.add(tool.identifier);
    acc.push(tool);
    return acc;
  }, []);
};

/**
 * Resolve tool manifest content for a single tool.
 * Returns the tool's systemRole + API descriptions as a formatted string.
 */
const loadToolContent = (identifier: string): string | undefined => {
  const toolState = getToolStoreState();

  const builtinTool = (toolState.builtinTools || []).find(
    (t) => t.manifest?.identifier === identifier,
  );

  if (builtinTool?.manifest) {
    const { manifest } = builtinTool;
    const parts: string[] = [];

    if (manifest.systemRole) {
      parts.push(manifest.systemRole);
    }

    if (manifest.api?.length > 0) {
      const apiDescriptions = manifest.api
        .map((api) => `- ${api.name}: ${api.description}`)
        .join('\n');
      parts.push(`Available APIs:\n${apiDescriptions}`);
    }

    const content = parts.join('\n\n');
    return content || undefined;
  }

  const installedPlugin = (toolState.installedPlugins || []).find(
    (p) => p.identifier === identifier,
  );

  if (installedPlugin?.manifest) {
    const { manifest } = installedPlugin;
    const parts: string[] = [];

    if (manifest.systemRole) {
      parts.push(manifest.systemRole);
    }

    if (manifest.api?.length > 0) {
      const apiDescriptions = manifest.api
        .map((api) => `- ${api.name}: ${api.description}`)
        .join('\n');
      parts.push(`Available APIs:\n${apiDescriptions}`);
    }

    const content = parts.join('\n\n');
    return content || undefined;
  }

  return undefined;
};

/**
 * Enrich selected tools with preloaded content from tool manifests.
 * Tools with available manifest data (systemRole, API descriptions) get their
 * content resolved and attached directly, avoiding fake tool-call preload messages.
 */
export const resolveSelectedToolsWithContent = ({
  message,
  selectedTools,
}: {
  message: string;
  selectedTools?: RuntimeSelectedTool[];
}): RuntimeSelectedTool[] => {
  const resolved = resolveSelectedTools(message, selectedTools);

  return resolved.map((tool) => {
    const content = loadToolContent(tool.identifier);
    return content ? { ...tool, content } : tool;
  });
};
