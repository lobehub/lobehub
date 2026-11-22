/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Avatar from './index';

describe('Avatar', () => {
  // A character picked for an Agent (`agent-avatar:<shape>:<color>`) is no emoji or image: the
  // library Avatar treated it as a broken one and drew its gradient fallback instead.
  it('draws a picked Agent character, not the fallback gradient', () => {
    const { container } = render(<Avatar avatar={'agent-avatar:rocket:cyan'} name={'Bot'} />);

    expect(container.textContent).not.toContain('agent-avatar');
    expect(container.querySelector('.lobe-avatar__fallback')).toBeNull();
    expect(container.querySelector('svg[aria-label="Bot"]')).not.toBeNull();
  });

  it('keeps an emoji as an emoji', () => {
    const { container } = render(<Avatar avatar={'🤖'} name={'Bot'} />);

    expect(container.querySelector('svg[aria-label="Bot"]')).toBeNull();
  });
});
