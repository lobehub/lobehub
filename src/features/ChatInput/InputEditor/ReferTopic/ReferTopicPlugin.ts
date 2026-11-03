import { $wrapNodeInElement } from '@lexical/utils';
import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
} from 'lexical';

import {
  $createReferTopicNode,
  $isReferTopicNode,
  ReferTopicNode,
  type SerializedReferTopicNode,
} from './ReferTopicNode';

export const INSERT_REFER_TOPIC_COMMAND = createCommand<{ topicId: string; topicTitle: string }>(
  'INSERT_REFER_TOPIC_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface ReferTopicPluginOptions {
  decorator: (node: ReferTopicNode, editor: LexicalEditor) => any;
  theme?: { referTopic?: string };
}

export class ReferTopicPlugin {
  static pluginName = 'ReferTopicPlugin';

  config?: ReferTopicPluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: ReferTopicPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([ReferTopicNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(ReferTopicNode.getType(), (node, editor) => {
      return config?.decorator ? config.decorator(node as ReferTopicNode, editor) : null;
    });
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerLiteXml();
    this.registerCommand(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(ReferTopicNode.getType(), (ctx: any, node: any) => {
      if ($isReferTopicNode(node)) {
        ctx.appendLine(`<refer_topic name="${node.topicTitle}" id="${node.topicId}" />`);
      }
    });
  }

  private registerCommand(editor: LexicalEditor): void {
    editor.registerCommand(
      INSERT_REFER_TOPIC_COMMAND,
      (payload) => {
        editor.update(() => {
          const node = $createReferTopicNode(payload.topicId, payload.topicTitle);
          $insertNodes([node]);
          if ($isRootOrShadowRoot(node.getParentOrThrow())) {
            $wrapNodeInElement(node, $createParagraphNode).selectEnd();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  private registerLiteXml(): void {
    const xmlService = this.kernel.requireService(ILitexmlService);

    xmlService?.registerXMLWriter(ReferTopicNode.getType(), (node: any, ctx: any) => {
      if ($isReferTopicNode(node)) {
        return ctx.createXmlNode('referTopic', {
          id: node.topicId,
          name: node.topicTitle,
        });
      }
      return false;
    });

    xmlService?.registerXMLReader('referTopic', (xmlElement: any) => {
      return {
        topicId: xmlElement.getAttribute('id') || '',
        topicTitle: xmlElement.getAttribute('name') || '',
        type: ReferTopicNode.getType(),
        version: 1,
      } satisfies SerializedReferTopicNode;
    });
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ReferTopicNode.getType());
  }
}
