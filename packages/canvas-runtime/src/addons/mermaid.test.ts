import { describe, expect, it } from 'vitest';

import { mountMermaid } from './mermaid';

describe('mermaid add-on', () => {
  it('mounts a valid flowchart without an error', () => {
    const element = document.createElement('div');
    document.body.append(element);

    const mounted = mountMermaid(element, 'flowchart TD\n  A[Login] --> B{Valid?}', 'scope-');

    expect(mounted.error).toBeUndefined();
    mounted.destroy();
  });

  it('returns the parser error instead of throwing', () => {
    const element = document.createElement('div');
    document.body.append(element);

    expect(mountMermaid(element, 'flowchart TD\n  A[Login --> B', 'scope-').error).toContain(
      'Parse error',
    );
  });
});
