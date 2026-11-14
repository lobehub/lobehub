import { $dfs } from '@lexical/utils';
import { type getKernelFromEditor, IMarkdownShortCutService } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

import type { ImageUploadRef } from '../../utils/imageUploads';
import {
  $createImageRefTagNode,
  $isImageRefTagNode,
  formatImageRef,
  ImageRefTagNode,
} from './ImageRefTagNode';

export interface SyncImageRefTagsPayload {
  /** Preview URLs of newly attached images to reference at the caret, in attachment order. */
  insert?: string[];
  /** The draft's current image uploads, keyed by preview URL. */
  refs: Map<string, ImageUploadRef>;
  /** Preview URLs of images the user just removed from the attachment list. */
  removed?: string[];
}

/**
 * Brings the inline references in line with the attachment list: references to `removed`
 * images are deleted, references to attached images take the image's current number, and
 * `insert` adds references for newly attached images at the caret.
 *
 * A reference to an image that is neither attached nor removed — a draft restored before
 * its uploads, or after a reload — is left in place, since its image may still be listed
 * once the conversation's uploads arrive; until then it is shown as unavailable and left
 * out of the markdown.
 */
export const SYNC_IMAGE_REF_TAGS_COMMAND = createCommand<SyncImageRefTagsPayload>(
  'SYNC_IMAGE_REF_TAGS_COMMAND',
);

type IEditorKernel = ReturnType<typeof getKernelFromEditor>;

export interface ImageRefTagPluginOptions {
  decorator: (node: ImageRefTagNode, editor: LexicalEditor) => any;
  theme?: { imageRefTag?: string };
}

/** Removes a reference together with the space inserted after it. */
const $removeImageRefTag = (node: ImageRefTagNode) => {
  const next = node.getNextSibling();
  if ($isTextNode(next) && next.getTextContent().startsWith(' ')) {
    const rest = next.getTextContent().slice(1);
    if (rest) next.setTextContent(rest);
    else next.remove();
  }
  node.remove();
};

const $syncImageRefTags = (refs: Map<string, ImageUploadRef>, removed: ReadonlySet<string>) => {
  for (const { node } of $dfs()) {
    if (!$isImageRefTagNode(node)) continue;
    if (removed.has(node.src)) {
      $removeImageRefTag(node);
      continue;
    }
    const number = refs.get(node.src)?.number;
    if (number !== undefined && number !== node.number) node.setNumber(number);
  }
};

const $insertImageRefTags = (refs: ImageUploadRef[]) => {
  const nodes: LexicalNode[] = refs.flatMap((ref) => [
    $createImageRefTagNode(ref.src, ref.number),
    // Trailing space so the user can keep typing without adding one manually.
    $createTextNode(' '),
  ]);

  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertNodes(nodes);
    return;
  }

  const root = $getRoot();
  const last = root.getLastChild();
  const paragraph = $isElementNode(last) && last.canBeEmpty() ? last : $createParagraphNode();
  if (paragraph !== last) root.append(paragraph);
  paragraph.append(...nodes);
  nodes.at(-1)?.selectEnd();
};

/**
 * Owns the `image-ref-tag` node: its decorator, its `[Image #N]` markdown writer, and
 * keeping references in sync with the draft's image uploads.
 */
export class ImageRefTagPlugin {
  static pluginName = 'ImageRefTagPlugin';

  config?: ImageRefTagPluginOptions;
  private kernel: IEditorKernel;
  /**
   * The composer's latest attachment snapshot; `undefined` in editors without one (e.g.
   * editing a sent message), where references keep their stored number.
   */
  private refs?: Map<string, ImageUploadRef>;

  constructor(kernel: IEditorKernel, config?: ImageRefTagPluginOptions) {
    this.kernel = kernel;
    this.config = config;

    kernel.registerNodes([ImageRefTagNode]);

    if (config?.theme) {
      kernel.registerThemes(config.theme);
    }

    kernel.registerDecorator(ImageRefTagNode.getType(), (node, editor) => {
      return config?.decorator ? config.decorator(node as ImageRefTagNode, editor) : null;
    });
  }

  onInit(editor: LexicalEditor): void {
    this.registerMarkdown();
    this.registerSync(editor);
  }

  private registerMarkdown(): void {
    const mdService = this.kernel.requireService(IMarkdownShortCutService);

    mdService?.registerMarkdownWriter(ImageRefTagNode.getType(), (ctx: any, node: any) => {
      if (!$isImageRefTagNode(node)) return;
      // Written from the snapshot rather than the node, so a reference brought back by undo
      // or a restored draft never claims an image the message does not carry.
      const number = this.refs ? this.refs.get(node.src)?.number : node.number;
      if (number !== undefined) ctx.appendLine(formatImageRef(number));
    });
  }

  private registerSync(editor: LexicalEditor): void {
    editor.registerCommand(
      SYNC_IMAGE_REF_TAGS_COMMAND,
      ({ insert, refs, removed }) => {
        this.refs = refs;
        const inserted = (insert ?? []).flatMap((src) => refs.get(src) ?? []);

        editor.update(
          () => {
            $syncImageRefTags(refs, new Set(removed));
            if (inserted.length > 0) $insertImageRefTags(inserted);
          },
          // Renumbering after a removal belongs to that removal, not to its own undo step.
          inserted.length > 0 ? undefined : { tag: HISTORY_MERGE_TAG },
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ImageRefTagNode.getType());
  }
}
