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
  $createReferDocumentNode,
  $isReferDocumentNode,
  ReferDocumentNode,
  type SerializedReferDocumentNode,
} from './ReferDocumentNode';
import { formatReferDocumentTag } from './referDocumentTag';

export const INSERT_REFER_DOCUMENT_COMMAND = createCommand<{ documentId: string; title: string }>(
  'INSERT_REFER_DOCUMENT_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface ReferDocumentPluginOptions {
  decorator: (node: ReferDocumentNode, editor: LexicalEditor) => any;
  theme?: { referDocument?: string };
}

export class ReferDocumentPlugin {
  static pluginName = 'ReferDocumentPlugin';

  config?: ReferDocumentPluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: ReferDocumentPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([ReferDocumentNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(ReferDocumentNode.getType(), (node, editor) => {
      return config?.decorator ? config.decorator(node as ReferDocumentNode, editor) : null;
    });
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerLiteXml();
    this.registerCommand(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(ReferDocumentNode.getType(), (ctx: any, node: any) => {
      if ($isReferDocumentNode(node)) {
        ctx.appendLine(formatReferDocumentTag(node.documentId, node.title));
      }
    });
  }

  private registerCommand(editor: LexicalEditor): void {
    editor.registerCommand(
      INSERT_REFER_DOCUMENT_COMMAND,
      (payload) => {
        editor.update(() => {
          const node = $createReferDocumentNode(payload.documentId, payload.title);
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

    xmlService?.registerXMLWriter(ReferDocumentNode.getType(), (node: any, ctx: any) => {
      if ($isReferDocumentNode(node)) {
        return ctx.createXmlNode('referDocument', { id: node.documentId, name: node.title });
      }
      return false;
    });

    xmlService?.registerXMLReader('referDocument', (xmlElement: any) => {
      return {
        documentId: xmlElement.getAttribute('id') || '',
        title: xmlElement.getAttribute('name') || '',
        type: ReferDocumentNode.getType(),
        version: 1,
      } satisfies SerializedReferDocumentNode;
    });
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ReferDocumentNode.getType());
  }
}
