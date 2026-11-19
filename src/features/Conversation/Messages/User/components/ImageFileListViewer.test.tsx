import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { rememberLocalImagePreview } from '@/utils/localImagePreview';

import ImageFileListViewer from './ImageFileListViewer';

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('ImageFileListViewer', () => {
  it('shows an image this tab uploaded from its local copy', () => {
    rememberLocalImagePreview('file-local', 'blob:local');

    const { container } = render(
      <ImageFileListViewer
        items={[
          { alt: 'a', id: 'file-local', url: 'https://cdn/a.png' },
          { alt: 'b', id: 'file-remote', url: 'https://cdn/b.png' },
        ]}
      />,
    );

    expect(srcs(container)).toEqual(['blob:local', 'https://cdn/b.png']);
  });
});
