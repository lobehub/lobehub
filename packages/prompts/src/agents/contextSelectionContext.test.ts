import type { ContextSelection } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { formatContextSelections } from './contextSelectionContext';

describe('formatContextSelections', () => {
  it('injects a mini game snapshot with its scene id', () => {
    const selections: ContextSelection[] = [
      {
        content: '<game_state scene="pixel-yard"><self x="6" y="4"/></game_state>',
        format: 'xml',
        id: 'game:pixel-yard',
        sceneId: 'pixel-yard',
        source: 'game',
        title: 'Pixel "Yard"',
      },
    ];

    expect(formatContextSelections(selections)).toBe(`<user_context_selections count="1">
<context_selection source="game" title="Pixel &quot;Yard&quot;" sceneId="pixel-yard">
<game_state scene="pixel-yard"><self x="6" y="4"/></game_state>
</context_selection>
</user_context_selections>`);
  });

  it('returns nothing without selections', () => {
    expect(formatContextSelections([])).toBe('');
  });
});
