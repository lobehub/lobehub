import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import { t } from 'i18next';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

import {
  $createReferArtboardNode,
  $isReferArtboardNode,
  ReferArtboardNode,
  type SerializedReferArtboardNode,
} from './ReferArtboardNode';
import { type ArtboardReference, serializeArtboardReference } from './serialize';

export const INSERT_ARTBOARD_REFERENCE_COMMAND = createCommand<ArtboardReference>(
  'INSERT_ARTBOARD_REFERENCE_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface ReferArtboardPluginOptions {
  decorator: (node: ReferArtboardNode, editor: LexicalEditor) => any;
}

const ATTRS = ['artboardId', 'itemId', 'itemKind', 'itemTitle', 'kind', 'text'] as const;

const isReferenceParagraph = (node: LexicalNode) =>
  $isElementNode(node) && node.getChildren().some((child) => $isReferArtboardNode(child));

const translate = (key: string, options?: Record<string, unknown>) =>
  t(key as 'artboard.chat.quote', { ...options, ns: 'project' }) as string;

export class ReferArtboardPlugin {
  static pluginName = 'ReferArtboardPlugin';

  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: ReferArtboardPluginOptions) {
    this.kernel = kernel;
    kernel.registerNodes([ReferArtboardNode]);
    kernel.registerDecorator(ReferArtboardNode.getType(), (node, editor) =>
      config?.decorator ? config.decorator(node as ReferArtboardNode, editor) : null,
    );
  }

  onInit(editor: LexicalEditor): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);
    mdService?.registerMarkdownWriter(ReferArtboardNode.getType(), (ctx: any, node: any) => {
      if ($isReferArtboardNode(node))
        ctx.appendLine(`${serializeArtboardReference(node.reference, translate)}\n`);
    });

    const xmlService = this.kernel.requireService(ILitexmlService);
    xmlService?.registerXMLWriter(ReferArtboardNode.getType(), (node: any, ctx: any) =>
      $isReferArtboardNode(node)
        ? ctx.createXmlNode('referArtboard', { ...node.reference })
        : false,
    );
    xmlService?.registerXMLReader('referArtboard', (xmlElement: any) => {
      const read = Object.fromEntries(
        ATTRS.map((name) => [name, xmlElement.getAttribute(name) || '']),
      ) as unknown as ArtboardReference;
      return {
        ...read,
        type: ReferArtboardNode.getType(),
        version: 1,
      } satisfies SerializedReferArtboardNode;
    });

    editor.registerCommand(
      INSERT_ARTBOARD_REFERENCE_COMMAND,
      (reference) => {
        editor.update(() => {
          const root = $getRoot();
          const paragraph = $createParagraphNode().append($createReferArtboardNode(reference));
          const leading = root.getChildren();
          let anchor: LexicalNode | undefined;
          for (const child of leading) {
            if (!isReferenceParagraph(child)) break;
            anchor = child;
          }
          if (anchor) anchor.insertAfter(paragraph);
          else if (root.getFirstChild()) root.getFirstChild()!.insertBefore(paragraph);
          else root.append(paragraph, $createParagraphNode());
          root.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ReferArtboardNode.getType());
  }
}
