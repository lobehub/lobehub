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
  HISTORIC_TAG,
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

/**
 * Removes every reference whose image is not attached, so a message sent from a draft whose
 * uploads never came back (e.g. after a reload) does not show a chip for an image it lacks.
 * The update is flushed synchronously, so the editor data read right after includes it.
 */
export const PRUNE_UNATTACHED_IMAGE_REFS_COMMAND = createCommand<void>(
  'PRUNE_UNATTACHED_IMAGE_REFS_COMMAND',
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

/** Preview URLs whose references are removed when they match no attached image. */
type RemovedSrcs = Pick<ReadonlySet<string>, 'has'>;

type SyncAction = 'remove' | { ref: ImageUploadRef } | undefined;

/**
 * What a reference needs to match the attachment list. A reference whose preview URL is
 * not listed is matched by its file id, which is how a reference restored from a sent
 * message finds its image again under the image's server URL. Only a reference matching
 * no listed image is removed, since sending a message also clears its preview URLs.
 */
const planReference = (
  node: ImageRefTagNode,
  refs: Map<string, ImageUploadRef>,
  removed: RemovedSrcs,
): SyncAction => {
  const ref =
    refs.get(node.src) ??
    (node.fileId ? [...refs.values()].find((item) => item.fileId === node.fileId) : undefined);
  if (!ref) return removed.has(node.src) ? 'remove' : undefined;

  const stale =
    ref.src !== node.src ||
    ref.number !== node.number ||
    (ref.fileId !== undefined && ref.fileId !== node.fileId);
  return stale ? { ref } : undefined;
};

const NOTHING_REMOVED: RemovedSrcs = new Set();
const EVERYTHING_REMOVED: RemovedSrcs = { has: () => true };

const $syncImageRefTags = (refs: Map<string, ImageUploadRef>, removed: RemovedSrcs) => {
  for (const { node } of $dfs()) {
    if (!$isImageRefTagNode(node)) continue;
    const action = planReference(node, refs, removed);
    if (action === 'remove') {
      $removeImageRefTag(node);
    } else if (action) {
      const { ref } = action;
      const writable = node.setNumber(ref.number);
      if (ref.src !== node.src || ref.fileId !== node.fileId) {
        writable.setUpload(ref.src, ref.fileId ?? node.fileId);
      }
    }
  }
};

/** Marks the follow-up update that re-syncs references, so it does not trigger itself. */
const IMAGE_REF_RESYNC_TAG = 'image-ref-resync';

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
  /** Preview URLs of images removed from the attachment list and not attached again. */
  private removed = new Set<string>();

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
        for (const src of refs.keys()) this.removed.delete(src);
        for (const src of removed ?? []) this.removed.add(src);
        const inserted = (insert ?? []).flatMap((src) => refs.get(src) ?? []);

        editor.update(
          () => {
            $syncImageRefTags(refs, this.removed);
            if (inserted.length > 0) $insertImageRefTags(inserted);
          },
          // Renumbering after a removal belongs to that removal, not to its own undo step.
          inserted.length > 0 ? undefined : { tag: HISTORY_MERGE_TAG },
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    editor.registerCommand(
      PRUNE_UNATTACHED_IMAGE_REFS_COMMAND,
      () => {
        const refs = this.refs;
        if (!refs) return false;
        editor.update(() => $syncImageRefTags(refs, EVERYTHING_REMOVED), {
          discrete: true,
          tag: HISTORY_MERGE_TAG,
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Undo and restored editor data replace the editor state without a sync, bringing back
    // references with old numbers or to removed images. The markdown writer already reads
    // the snapshot, but the editor data sent with the message stores each node's number, so
    // the nodes themselves are brought back in line. Only undo/redo removes references: a
    // draft restored from a sent message lists its images after its text, under new URLs.
    editor.registerUpdateListener(({ editorState, tags }) => {
      const refs = this.refs;
      if (!refs || tags.has(IMAGE_REF_RESYNC_TAG)) return;
      const removed = tags.has(HISTORIC_TAG) ? this.removed : NOTHING_REMOVED;

      const stale = editorState.read(() =>
        $dfs().some(
          ({ node }) =>
            $isImageRefTagNode(node) && planReference(node, refs, removed) !== undefined,
        ),
      );
      if (!stale) return;

      editor.update(() => $syncImageRefTags(refs, removed), {
        tag: [HISTORY_MERGE_TAG, IMAGE_REF_RESYNC_TAG],
      });
    });
  }

  destroy(): void {
    this.kernel.unregisterDecorator?.(ImageRefTagNode.getType());
  }
}
