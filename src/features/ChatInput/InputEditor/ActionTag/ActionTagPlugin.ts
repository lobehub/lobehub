import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import type { LexicalEditor, LexicalNode } from 'lexical';

import { $isActionTagNode, ActionTagNode, type SerializedActionTagNode } from './ActionTagNode';
import { registerActionTagCommand } from './command';
import { registerActionTagSelectionObserver } from './selectionObserver';
import type { ActionTagCategory, ActionTagType } from './types';

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

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
    this.registerMarkdown();
    this.registerLiteXml();
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    // Writer: ActionTagNode → markdown
    // Skills       → <skill name="..." label="..." />
    // AgentSkill   → <skill name="agent-skills:<filename>" label="..." />
    //                Wire format collapses to <skill>; the `agent-skills:`
    //                prefix in the identifier is what the runtime keys off to
    //                route the activation through agentDocumentsService.
    // Tools        → <tool name="..." label="..." />
    // ProjectSkill → bare label text (e.g. `/local-testing`) so the downstream
    //                CLI agent recognizes its own slash-style skill invocation
    // Commands     → <action type="..." category="command" label="..." />
    mdService?.registerMarkdownWriter(ActionTagNode.getType(), (ctx: any, node: any) => {
      if ($isActionTagNode(node)) {
        const cat = node.actionCategory;
        if (cat === 'skill' || cat === 'agentSkill') {
          ctx.appendLine(`<skill name="${node.actionType}" label="${node.actionLabel}" />`);
        } else if (cat === 'tool') {
          ctx.appendLine(`<tool name="${node.actionType}" label="${node.actionLabel}" />`);
        } else if (cat === 'projectSkill') {
          // Chip / menu render the bare skill name; the slash is added here so
          // the downstream CLI sees `/skill-name` as a slash invocation.
          ctx.appendLine(`/${node.actionType}`);
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

    // Read <skill>, <tool>, <projectSkill>, and legacy <action> tags.
    // Agent-document skills share the <skill> wire format; we recover the
    // 'agentSkill' UI category from the identifier prefix so reload preserves
    // the chip's color / icon / tooltip.
    const readSkill = (xmlElement: any): SerializedActionTagNode => {
      const name = xmlElement.getAttribute('name') || '';
      return {
        actionCategory: name.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX) ? 'agentSkill' : 'skill',
        actionLabel: xmlElement.getAttribute('label') || '',
        actionType: name as ActionTagType,
        type: ActionTagNode.getType(),
        version: 1,
      };
    };
    const readTool = (xmlElement: any): SerializedActionTagNode => ({
      actionCategory: 'tool',
      actionLabel: xmlElement.getAttribute('label') || '',
      actionType: (xmlElement.getAttribute('name') || '') as ActionTagType,
      type: ActionTagNode.getType(),
      version: 1,
    });
    const readProjectSkill = (xmlElement: any): SerializedActionTagNode => ({
      actionCategory: 'projectSkill',
      actionLabel: xmlElement.getAttribute('label') || '',
      actionType: (xmlElement.getAttribute('name') || '') as ActionTagType,
      type: ActionTagNode.getType(),
      version: 1,
    });
    const readLegacyAction = (xmlElement: any): SerializedActionTagNode => ({
      actionCategory: (xmlElement.getAttribute('category') || 'skill') as ActionTagCategory,
      actionLabel: xmlElement.getAttribute('label') || '',
      actionType: (xmlElement.getAttribute('type') || 'translate') as ActionTagType,
      type: ActionTagNode.getType(),
      version: 1,
    });

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
