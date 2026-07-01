import { $wrapNodeInElement } from '@lexical/utils';
import { escapeXmlAttr } from '@lobechat/prompts';
import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
} from 'lexical';

import {
  $createLocalFileMentionNode,
  $isLocalFileMentionNode,
  LocalFileMentionNode,
  type SerializedLocalFileMentionNode,
} from './LocalFileMentionNode';

export interface InsertLocalFileMentionPayload {
  isDirectory?: boolean;
  name: string;
  path: string;
}

export const INSERT_LOCAL_FILE_MENTION_COMMAND = createCommand<InsertLocalFileMentionPayload>(
  'INSERT_LOCAL_FILE_MENTION_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface LocalFileMentionPluginOptions {
  decorator: (node: LocalFileMentionNode, editor: LexicalEditor) => any;
  theme?: { localFileMention?: string };
}

/**
 * Owns the `local-file-mention` node: its decorator, its `<localFile … />`
 * markdown writer, and its insert command. Because this plugin is registered
 * unconditionally (via `CHAT_INPUT_EMBED_PLUGINS`), the markdown serialization
 * is always available — unlike the generic mention writer, which is only wired
 * up when `mentionOption` has items. This is what keeps workspace-file drops
 * serializing to the tag the gateway/device run needs, even on the web client
 * with no other mention categories.
 */
export class LocalFileMentionPlugin {
  static pluginName = 'LocalFileMentionPlugin';

  config?: LocalFileMentionPluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: LocalFileMentionPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([LocalFileMentionNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(LocalFileMentionNode.getType(), (node, editor) => {
      return config?.decorator ? config.decorator(node as LocalFileMentionNode, editor) : null;
    });
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerLiteXml();
    this.registerCommand(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(LocalFileMentionNode.getType(), (ctx: any, node: any) => {
      if ($isLocalFileMentionNode(node)) {
        const name = escapeXmlAttr(node.name);
        const path = escapeXmlAttr(node.path);
        const isDirectory = node.isDirectory ? ' isDirectory' : '';
        ctx.appendLine(`<localFile name="${name}" path="${path}"${isDirectory} />`);
      }
    });
  }

  private registerCommand(editor: LexicalEditor): void {
    editor.registerCommand(
      INSERT_LOCAL_FILE_MENTION_COMMAND,
      (payload) => {
        editor.update(() => {
          const node = $createLocalFileMentionNode(
            payload.name,
            payload.path,
            !!payload.isDirectory,
          );
          // Trailing space so the user can keep typing without adding one manually.
          $insertNodes([node, $createTextNode(' ')]);
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

    xmlService?.registerXMLWriter(LocalFileMentionNode.getType(), (node: any, ctx: any) => {
      if ($isLocalFileMentionNode(node)) {
        return ctx.createXmlNode('localFileMention', {
          isDirectory: node.isDirectory ? 'true' : '',
          name: node.name,
          path: node.path,
        });
      }
      return false;
    });

    xmlService?.registerXMLReader('localFileMention', (xmlElement: any) => {
      return {
        isDirectory: xmlElement.getAttribute('isDirectory') === 'true',
        name: xmlElement.getAttribute('name') || '',
        path: xmlElement.getAttribute('path') || '',
        type: LocalFileMentionNode.getType(),
        version: 1,
      } satisfies SerializedLocalFileMentionNode;
    });
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(LocalFileMentionNode.getType());
  }
}
