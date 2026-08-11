import { ImageIcon, ImageOffIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { readPlaceholderIcon } from './placeholderIcon';

describe('readPlaceholderIcon', () => {
  it('should mark a failed thumbnail with the struck-through frame', () => {
    expect(readPlaceholderIcon('error')).toBe(ImageOffIcon);
  });

  it('should keep the plain frame while the thumbnail is still coming', () => {
    expect(readPlaceholderIcon('loading')).toBe(ImageIcon);
    expect(readPlaceholderIcon('loaded')).toBe(ImageIcon);
  });

  it('should not reuse one icon for both waiting and failed', () => {
    // The whole point of the distinction: a permanently missing bitmap must not
    // read as a slow one.
    expect(readPlaceholderIcon('error')).not.toBe(readPlaceholderIcon('loading'));
  });
});
