/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WorkspaceAvatar from './index';

// boring-avatars' bauhaus draws a circle and a line over two rects; the other
// variants never combine both, so this pair identifies the workspace look.
const isBauhaus = (svg: Element) => !!svg.querySelector('circle') && !!svg.querySelector('line');

// Mask ids differ per instance, so compare what is drawn rather than the markup.
const drawing = (svg: Element | null) =>
  [...(svg?.querySelectorAll('rect, circle, line') ?? [])].map((node) =>
    ['fill', 'stroke', 'transform', 'x', 'y', 'cx', 'cy', 'x1', 'x2', 'y1', 'y2']
      .map((attr) => node.getAttribute(attr))
      .join('|'),
  );

describe('WorkspaceAvatar', () => {
  it('draws the bauhaus fallback from the name when there is no logo', () => {
    render(<WorkspaceAvatar name={'Foundry'} size={24} />);

    const fallback = screen.getByRole('img', { name: 'Foundry' });
    expect(fallback.tagName.toLowerCase()).toBe('svg');
    expect(isBauhaus(fallback)).toBe(true);
  });

  it('draws the same mark for the same name', () => {
    const { container: first } = render(<WorkspaceAvatar name={'Foundry'} />);
    const { container: second } = render(<WorkspaceAvatar avatar={''} name={'Foundry'} />);
    const { container: other } = render(<WorkspaceAvatar name={'Lighthouse'} />);

    expect(drawing(first.querySelector('svg'))).toEqual(drawing(second.querySelector('svg')));
    expect(drawing(first.querySelector('svg'))).not.toEqual(drawing(other.querySelector('svg')));
  });

  it('shows the custom logo when the workspace has one', () => {
    const { container } = render(
      <WorkspaceAvatar avatar={'https://example.com/logo.png'} name={'Foundry'} />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/logo.png',
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});
