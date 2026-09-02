import type { IEditor } from '@lobehub/editor';

export const focusAnnotation = (editor: IEditor, annotationId: string): void => {
  const root = editor.getRootElement();
  if (!root) return;

  const element = Array.from(root.querySelectorAll<HTMLElement>('[data-annotation-ids]')).find(
    (node) => node.dataset.annotationIds?.split(',').includes(annotationId),
  );
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  element.click();
};
