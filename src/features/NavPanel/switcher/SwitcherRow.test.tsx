/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SwitcherRow from './SwitcherRow';

describe('SwitcherRow', () => {
  it('renders the given avatar image', () => {
    const { container } = render(
      <SwitcherRow
        item={{ avatar: 'https://example.com/a.png', id: 'foundry', title: 'Foundry' }}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  });

  // The title is what the Avatar labels and seeds its fallback from; without it a
  // failed image used to leave an empty tile.
  it('keeps a titled fallback when the avatar image fails to load', () => {
    const { container } = render(
      <SwitcherRow
        item={{ avatar: 'https://example.com/missing.png', id: 'foundry', title: 'Foundry' }}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[aria-label="Foundry"]')).not.toBeNull();
  });

  it('selects the item on click', () => {
    const onSelect = vi.fn();
    render(<SwitcherRow item={{ id: 'cloud', title: 'LobeHub Cloud' }} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('LobeHub Cloud'));

    expect(onSelect).toHaveBeenCalledWith('cloud');
  });
});
