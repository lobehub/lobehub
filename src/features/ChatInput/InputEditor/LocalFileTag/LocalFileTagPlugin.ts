import { $wrapNodeInElement } from '@lexical/utils';
import type { LocalFileStats } from '@lobechat/electron-client-ipc';
import { escapeXmlAttr } from '@lobechat/prompts';
import {
  type getKernelFromEditor,
  ILitexmlService,
  IMarkdownShortCutService,
} from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalEditor,
} from 'lexical';

import {
  $createLocalFileTagNode,
  $isLocalFileTagNode,
  LocalFileTagNode,
  type SerializedLocalFileTagNode,
} from './LocalFileTagNode';

export interface InsertLocalFileTagPayload {
  isDirectory?: boolean;
  name: string;
  path: string;
}

export const INSERT_LOCAL_FILE_TAG_COMMAND = createCommand<InsertLocalFileTagPayload>(
  'INSERT_LOCAL_FILE_TAG_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface LocalFileTagPluginOptions {
  decorator: (node: LocalFileTagNode, editor: LexicalEditor) => any;
  /**
   * Looks up size, line count, and MIME type for an inserted file reference. The result is
   * written into the tag so the model can plan how to read the file before opening it.
   */
  resolveFileStats?: (path: string) => Promise<LocalFileStats>;
  theme?: { localFileTag?: string };
}

/**
 * Serialized `<localFile>` attributes carrying file stats. `size` is in bytes; `lines` is omitted
 * for binary files.
 */
const localFileStatsAttributes = (stats: Partial<LocalFileStats>): Record<string, string> => ({
  ...(stats.size === undefined ? {} : { size: String(stats.size) }),
  ...(stats.lineCount === undefined ? {} : { lines: String(stats.lineCount) }),
  ...(stats.mimeType ? { type: stats.mimeType } : {}),
});

const readNumberAttribute = (value: string | null | undefined) => {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/**
 * Owns the `local-file-tag` node: its decorator, its `<localFile … />`
 * markdown writer, and its insert command. Because this plugin is registered
 * unconditionally (via `CHAT_INPUT_EMBED_PLUGINS`), the markdown serialization
 * is always available — unlike the generic mention writer, which is only wired
 * up when `mentionOption` has items. This is what keeps workspace-file drops
 * serializing to the tag the gateway/device run needs, even on the web client
 * with no other mention categories.
 */
export class LocalFileTagPlugin {
  static pluginName = 'LocalFileTagPlugin';

  config?: LocalFileTagPluginOptions;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel, config?: LocalFileTagPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([LocalFileTagNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(LocalFileTagNode.getType(), (node, editor) => {
      return config?.decorator ? config.decorator(node as LocalFileTagNode, editor) : null;
    });
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerLiteXml();
    this.registerCommand(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(LocalFileTagNode.getType(), (ctx: any, node: any) => {
      if ($isLocalFileTagNode(node)) {
        const name = escapeXmlAttr(node.name);
        const path = escapeXmlAttr(node.path);
        const isDirectory = node.isDirectory ? ' isDirectory' : '';
        const stats = Object.entries(localFileStatsAttributes(node.stats))
          .map(([key, value]) => ` ${key}="${escapeXmlAttr(value)}"`)
          .join('');
        ctx.appendLine(`<localFile name="${name}" path="${path}"${stats}${isDirectory} />`);
      }
    });
  }

  private registerCommand(editor: LexicalEditor): void {
    editor.registerCommand(
      INSERT_LOCAL_FILE_TAG_COMMAND,
      (payload) => {
        editor.update(() => {
          const node = $createLocalFileTagNode(payload.name, payload.path, !!payload.isDirectory);
          // Trailing space so the user can keep typing without adding one manually.
          $insertNodes([node, $createTextNode(' ')]);
          if ($isRootOrShadowRoot(node.getParentOrThrow())) {
            $wrapNodeInElement(node, $createParagraphNode).selectEnd();
          }
          // Commands can run inside a deferred update, so start the lookup once the key exists.
          if (!payload.isDirectory) this.fillFileStats(editor, node.getKey(), payload.path);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  /**
   * Stats are filled in after insertion so the tag appears immediately; a message sent before the
   * lookup finishes (or on a path this machine cannot read) keeps the plain name/path reference.
   */
  private fillFileStats(editor: LexicalEditor, nodeKey: string, path: string): void {
    const resolveFileStats = this.config?.resolveFileStats;
    if (!resolveFileStats || !path) return;

    resolveFileStats(path)
      .then((stats) => {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isLocalFileTagNode(node)) node.setStats(stats);
        });
      })
      .catch(() => {});
  }

  private registerLiteXml(): void {
    const xmlService = this.kernel.requireService(ILitexmlService);

    xmlService?.registerXMLWriter(LocalFileTagNode.getType(), (node: any, ctx: any) => {
      if ($isLocalFileTagNode(node)) {
        return ctx.createXmlNode('localFile', {
          ...(node.isDirectory ? { isDirectory: 'true' } : {}),
          name: node.name,
          path: node.path,
          ...localFileStatsAttributes(node.stats),
        });
      }
      return false;
    });

    const readLocalFile = (xmlElement: any) => {
      return {
        isDirectory:
          xmlElement.hasAttribute?.('isDirectory') ||
          xmlElement.getAttribute('isDirectory') === 'true',
        lineCount: readNumberAttribute(xmlElement.getAttribute('lines')),
        mimeType: xmlElement.getAttribute('type') || undefined,
        name: xmlElement.getAttribute('name') || '',
        path: xmlElement.getAttribute('path') || '',
        size: readNumberAttribute(xmlElement.getAttribute('size')),
        type: LocalFileTagNode.getType(),
        version: 1,
      } satisfies SerializedLocalFileTagNode;
    };

    xmlService?.registerXMLReader('localFile', readLocalFile);
    xmlService?.registerXMLReader('localFileTag', readLocalFile);
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(LocalFileTagNode.getType());
  }
}
