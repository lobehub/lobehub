import type { IEditor } from '@lobehub/editor';
import { $getNearestNodeFromDOMNode } from 'lexical';

/**
 * Open a FileNode's URL in a new tab on click. The vendor `ReactFile`
 * decorator's default click only selects the node — no preview or download.
 *
 * Two subtleties:
 *
 * 1. Native DOM listener on the editor root with `capture: true`. Lexical's
 *    own bubble-phase listener may stop propagation when a decorator is
 *    clicked, so capturing earlier is the only reliable way to intercept.
 *
 * 2. Resolve DOM → Lexical node via `lexicalEditor.read(...)`, not
 *    `editorState.read(...)`. The former installs the active-editor context
 *    that `$getNearestNodeFromDOMNode` needs when multiple editors coexist.
 */
export const registerAttachmentClickOpen = (editor: IEditor): (() => void) | undefined => {
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Fast path: skip the editor read transaction for clicks on plain text,
    // which is the overwhelming majority while typing. Decorator nodes carry
    // `data-lexical-decorator="true"` on their wrapper.
    if (!target.closest('[data-lexical-decorator="true"]')) return;
    // Explicit download button has its own handler; don't also open in a new tab.
    if (target.closest('[data-lobehub-file-download]')) return;

    let url: string | undefined;
    lexicalEditor.read(() => {
      const node = $getNearestNodeFromDOMNode(target);
      if (node?.getType?.() === 'file') {
        url = (node as unknown as { __fileUrl?: string }).__fileUrl;
      }
    });

    if (url) {
      // Synchronous click → window.open keeps the gesture trusted so
      // browser popup blockers don't intervene.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  let attached: HTMLElement | null = null;
  const unregister = lexicalEditor.registerRootListener((rootElement, prevRootElement) => {
    if (prevRootElement && attached === prevRootElement) {
      attached.removeEventListener('click', onClick, true);
      attached = null;
    }
    if (rootElement) {
      rootElement.addEventListener('click', onClick, true);
      attached = rootElement;
    }
  });

  return () => {
    if (attached) {
      attached.removeEventListener('click', onClick, true);
      attached = null;
    }
    unregister();
  };
};
