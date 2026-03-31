import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import type { IEditorPlugin } from '@lobehub/editor/es/types/kernel';
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

/**
 * Editor plugin for ActionTagNode. Implements {@link IEditorPlugin}.
 * - Constructor: registers node, decorator, theme
 * - onInit: called by kernel after Lexical editor creation; registers command, selection observer, markdown/litexml
 * - destroy: cleanup
 */
export class ActionTagPlugin implements IEditorPlugin<ActionTagPluginOptions> {
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
    mdService?.registerMarkdownWriter(ActionTagNode.getType(), (ctx: any, node: any) => {
      if ($isActionTagNode(node)) {
        ctx.appendLine(`<action type="${node.actionType}" category="${node.actionCategory}" />`);
      }
    });
  }

  private registerLiteXml(): void {
    const xmlService = this.kernel.requireService(ILitexmlService);

    xmlService?.registerXMLWriter(ActionTagNode.getType(), (node: any, ctx: any) => {
      if ($isActionTagNode(node)) {
        return ctx.createXmlNode('action', {
          category: node.actionCategory,
          label: node.actionLabel,
          type: node.actionType,
        });
      }
      return false;
    });

    xmlService?.registerXMLReader('action', (xmlElement: any) => {
      try {
        const { INodeHelper } = require('@lobehub/editor/es/editor-kernel/inode/helper');
        return INodeHelper.createElementNode(ActionTagNode.getType(), {
          actionCategory: (xmlElement.getAttribute('category') || 'skill') as ActionTagCategory,
          actionLabel: xmlElement.getAttribute('label') || '',
          actionType: (xmlElement.getAttribute('type') || 'translate') as ActionTagType,
        } satisfies Partial<SerializedActionTagNode>);
      } catch {
        return false;
      }
    });
  }

  destroy(): void {
    for (const clear of this.clears) {
      clear();
    }
    this.clears = [];
    this.kernel.unregisterDecorator?.(ActionTagNode.getType());
  }
}
