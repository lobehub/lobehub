import { describe, expect, it, vi } from 'vitest';

import { focusAnnotation } from './focusAnnotation';

describe('focusAnnotation', () => {
  it('scrolls to and activates the annotation inside the current editor root', () => {
    const annotation = document.createElement('span');
    annotation.dataset.annotationIds = 'comment-1,comment-2';
    annotation.scrollIntoView = vi.fn();
    annotation.click = vi.fn();
    const root = document.createElement('div');
    root.append(annotation);

    focusAnnotation({ getRootElement: () => root } as any, 'comment-2');

    expect(annotation.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    expect(annotation.click).toHaveBeenCalledOnce();
  });

  it('does not search outside the active editor root', () => {
    const outside = document.createElement('span');
    outside.dataset.annotationIds = 'comment-1';
    outside.scrollIntoView = vi.fn();
    outside.click = vi.fn();
    document.body.append(outside);

    focusAnnotation({ getRootElement: () => document.createElement('div') } as any, 'comment-1');

    expect(outside.scrollIntoView).not.toHaveBeenCalled();
    expect(outside.click).not.toHaveBeenCalled();
    outside.remove();
  });
});
