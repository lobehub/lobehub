import { describe, expect, it } from 'vitest';

import { CANVAS_COMPONENTS } from './components';
import { buildCanvasComponentReference } from './reference';

describe('buildCanvasComponentReference', () => {
  const reference = buildCanvasComponentReference();

  it('documents every component with its example', () => {
    for (const spec of CANVAS_COMPONENTS) {
      expect(reference).toContain(`### <${spec.tag}>`);
      expect(reference).toContain(spec.example);
    }
  });

  it('marks required attributes and lists enum values', () => {
    expect(reference).toContain('- `value` (number, required)');
    expect(reference).toContain('- `type` (one of: info | success | warning | error)');
  });

  it('explains where option-like children may appear', () => {
    expect(reference).toContain('Only inside <lobe-select>, <lobe-segmented>, <lobe-radio-group>.');
  });
});
