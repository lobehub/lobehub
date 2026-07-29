import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import { type LexicalEditor, type LexicalNode, TextNode } from 'lexical';

import {
  $createActionTagNode,
  $isActionTagNode,
  ActionTagNode,
  type SerializedActionTagNode,
} from './ActionTagNode';
import { registerActionTagCommand } from './command';
import { registerActionTagSelectionObserver } from './selectionObserver';
import type { ActionTagCategory, ActionTagType } from './types';

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

/**
 * Minimal shape shared by the LiteXML element and the ad-hoc parser below, so
 * one set of readers recovers the chip from both a round-tripped XML node and a
 * raw `<skill … />` string a user typed or pasted.
 */
interface XmlAttributeSource {
  getAttribute: (name: string) => string | null;
}

// Agent-document skills share the <skill> wire format; we recover the
// 'agentSkill' UI category from the identifier prefix so reload preserves the
// chip's color / icon / tooltip.
const readSkill = (el: XmlAttributeSource): SerializedActionTagNode => {
  const name = el.getAttribute('name') || '';
  return {
    actionCategory: name.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX) ? 'agentSkill' : 'skill',
    actionLabel: el.getAttribute('label') || '',
    actionType: name as ActionTagType,
    type: ActionTagNode.getType(),
    version: 1,
  };
};
const readTool = (el: XmlAttributeSource): SerializedActionTagNode => ({
  actionCategory: 'tool',
  actionLabel: el.getAttribute('label') || '',
  actionType: (el.getAttribute('name') || '') as ActionTagType,
  type: ActionTagNode.getType(),
  version: 1,
});
const readProjectSkill = (el: XmlAttributeSource): SerializedActionTagNode => ({
  actionCategory: 'projectSkill',
  actionLabel: el.getAttribute('label') || '',
  actionType: (el.getAttribute('name') || '') as ActionTagType,
  type: ActionTagNode.getType(),
  version: 1,
});
const readLegacyAction = (el: XmlAttributeSource): SerializedActionTagNode => ({
  actionCategory: (el.getAttribute('category') || 'skill') as ActionTagCategory,
  actionLabel: el.getAttribute('label') || '',
  actionType: (el.getAttribute('type') || 'translate') as ActionTagType,
  type: ActionTagNode.getType(),
  version: 1,
});

const TAG_READERS: Record<string, (el: XmlAttributeSource) => SerializedActionTagNode> = {
  action: readLegacyAction,
  projectskill: readProjectSkill,
  skill: readSkill,
  tool: readTool,
};

// A single self-closing action tag: <skill … />, <tool … />, <projectSkill … />
// or the legacy <action … />. Non-global so `.exec` reports the first match's
// index; the transform re-runs on the trailing text to pick up later tags.
export const INLINE_ACTION_TAG_REGEX = /<(skill|projectskill|tool|action)(\s[^>]*?)?\/>/i;
const ATTRIBUTE_REGEX = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const parseAttributeSource = (attributeString: string): XmlAttributeSource => {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTRIBUTE_REGEX.lastIndex = 0;
  while ((match = ATTRIBUTE_REGEX.exec(attributeString)) !== null) {
    attributes[match[1]] = match[2] ?? match[3] ?? '';
  }
  return { getAttribute: (name) => (name in attributes ? attributes[name] : null) };
};

/**
 * Resolve a raw action-tag name + attribute string into the serialized chip
 * node, or `null` for an unknown tag. Exported for unit testing the parsing /
 * category resolution independently of the Lexical editor.
 */
export const resolveActionTagFromMatch = (
  tagName: string,
  attributeString: string,
): SerializedActionTagNode | null => {
  const reader = TAG_READERS[tagName.toLowerCase()];
  if (!reader) return null;
  return reader(parseAttributeSource(attributeString));
};

// @lobehub/editor code node types: 'code' (CodeMirror block), 'codeInline'
// (inline-code element wrapping text), 'code-highlight' (highlighted token
// text nodes inside a fenced block).
const CODE_CONTEXT_NODE_TYPES = new Set(['code', 'codeInline', 'code-highlight', 'codemirror']);

/**
 * True when a text node is part of a code snippet — inline code (a `code`
 * format flag or a `codeInline` wrapper), a highlighted token, or inside a code
 * block. A literal `<skill … />` a user writes/pastes in code is content, not a
 * chip, so the tag transform must leave it alone.
 */
export const isInCodeContext = (node: TextNode): boolean => {
  if (node.hasFormat('code')) return true;
  let current: LexicalNode | null = node;
  while (current) {
    if (CODE_CONTEXT_NODE_TYPES.has(current.getType())) return true;
    current = current.getParent();
  }
  return false;
};

export interface ActionTagPluginOptions {
  decorator: (node: ActionTagNode, editor: LexicalEditor) => any;
  theme?: { actionTag?: string };
}

export class ActionTagPlugin {
  static pluginName = 'ActionTagPlugin';

  config?: ActionTagPluginOptions;
  private kernel: IEditorKernel;
  private clears: Array<() => void> = [];

  constructor(kernel: IEditorKernel, config?: ActionTagPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([ActionTagNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(
      ActionTagNode.getType(),
      (node: LexicalNode, editor: LexicalEditor) => {
        return config?.decorator ? config.decorator(node as ActionTagNode, editor) : null;
      },
    );
  }

  onInit(editor: LexicalEditor): void {
    this.clears.push(registerActionTagCommand(editor));
    this.clears.push(registerActionTagSelectionObserver(editor));
    this.clears.push(this.registerTextTagTransform(editor));
    this.registerMarkdown();
    this.registerLiteXml();
  }

  /**
   * Turn a raw `<skill … />` / `<tool … />` / `<action … />` tag that a user
   * typed or pasted into the editor into the matching chip node. Without this,
   * only the slash / mention menu could produce a chip; a hand-written or
   * copy-pasted tag would send as literal XML and — because sent user messages
   * render their persisted editor state, not markdown — show up raw in the
   * bubble. Reuses the same readers as the LiteXML round-trip so category
   * resolution (e.g. the `agent-skills:` prefix → agentSkill) lives in one place.
   */
  private registerTextTagTransform(editor: LexicalEditor): () => void {
    return editor.registerNodeTransform(TextNode, (node) => {
      // A literal tag written/pasted inside code is content, not a chip.
      if (isInCodeContext(node)) return;

      const text = node.getTextContent();
      const match = INLINE_ACTION_TAG_REGEX.exec(text);
      if (!match) return;

      const [fullMatch, tagName, attributeString] = match;
      const serialized = resolveActionTagFromMatch(tagName, attributeString ?? '');
      if (!serialized) return;

      const actionNode = $createActionTagNode(
        serialized.actionType,
        serialized.actionCategory,
        serialized.actionLabel,
      );

      const startIndex = match.index;
      const endIndex = startIndex + fullMatch.length;

      // Split the raw tag out of the text node and swap it for the chip; the
      // trailing text node re-enters this transform to catch any further tags.
      const targetNode =
        startIndex === 0 ? node.splitText(endIndex)[0] : node.splitText(startIndex, endIndex)[1];
      targetNode.replace(actionNode);
    });
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    // Writer: ActionTagNode → markdown
    // Skills       → <skill name="..." label="..." />
    // AgentSkill   → <skill name="agent-skills:<filename>" label="..." />
    //                Wire format collapses to <skill>; the `agent-skills:`
    //                prefix in the identifier is what the runtime keys off to
    //                route the activation through agentDocumentsService.
    // ProjectSkill → <skill name="<skill-name>" label="..." />
    //                Same wire format as a registered skill — the project
    //                skill is in the runtime's `<available_skills>` registry
    //                (added on the server when a device is active), so the
    //                model resolves it through `activateSkill` like any
    //                other. Keeps the rendered prompt uniform across skill
    //                sources, which the LiteXML round-trip preserves via the
    //                category-aware `<projectSkill>` save format.
    // Tools        → <tool name="..." label="..." />
    // Commands     → <action type="..." category="command" label="..." />
    mdService?.registerMarkdownWriter(ActionTagNode.getType(), (ctx: any, node: any) => {
      if ($isActionTagNode(node)) {
        const cat = node.actionCategory;
        if (cat === 'skill' || cat === 'agentSkill' || cat === 'projectSkill') {
          ctx.appendLine(`<skill name="${node.actionType}" label="${node.actionLabel}" />`);
        } else if (cat === 'tool') {
          ctx.appendLine(`<tool name="${node.actionType}" label="${node.actionLabel}" />`);
        } else {
          ctx.appendLine(
            `<action type="${node.actionType}" category="${cat}" label="${node.actionLabel}" />`,
          );
        }
      }
    });
  }

  private registerLiteXml(): void {
    const xmlService = this.kernel.requireService(ILitexmlService);

    xmlService?.registerXMLWriter(ActionTagNode.getType(), (node: any, ctx: any) => {
      if ($isActionTagNode(node)) {
        const cat = node.actionCategory;
        if (cat === 'skill' || cat === 'agentSkill') {
          return ctx.createXmlNode('skill', { label: node.actionLabel, name: node.actionType });
        }
        if (cat === 'tool') {
          return ctx.createXmlNode('tool', { label: node.actionLabel, name: node.actionType });
        }
        if (cat === 'projectSkill') {
          return ctx.createXmlNode('projectSkill', {
            label: node.actionLabel,
            name: node.actionType,
          });
        }
        return ctx.createXmlNode('action', {
          category: cat,
          label: node.actionLabel,
          type: node.actionType,
        });
      }
      return false;
    });

    // Read <skill>, <tool>, <projectSkill>, and legacy <action> tags. The
    // readers are shared with the typed/pasted-tag transform (see module top),
    // so `<skill>`'s `agent-skills:` prefix → agentSkill mapping stays in one
    // place. LiteXML elements already satisfy the `getAttribute` contract.
    xmlService?.registerXMLReader('skill', readSkill);
    xmlService?.registerXMLReader('tool', readTool);
    xmlService?.registerXMLReader('projectSkill', readProjectSkill);
    xmlService?.registerXMLReader('action', readLegacyAction);
  }

  destroy(): void {
    for (const clear of this.clears) {
      clear();
    }
    this.clears = [];
    this.kernel.unregisterDecorator?.(ActionTagNode.getType());
  }
}
