import { describe, expect, it } from 'vitest';

import { activityPrompt } from './activity';
import { contextPrompt } from './context';
import { experiencePrompt } from './experience';
import { identityPrompt } from './identity';
import { preferencePrompt } from './preference';

/**
 * @example
 * All memory-list prompts instruct the model to return `{ "memories": [...] }`.
 */
describe('memory layer prompt output contracts', () => {
  /**
   * @example
   * An empty extraction is returned as `{ "memories": [] }`, never `[]`.
   */
  it.each([
    ['activity', activityPrompt],
    ['context', contextPrompt],
    ['experience', experiencePrompt],
    ['preference', preferencePrompt],
  ])('%s prompt matches the memory-list schema', (_layer, prompt) => {
    /**
     * @example
     * `{ "memories": [] }` is present while contradictory bare-array instructions are absent.
     */
    expect({
      hasEmptyObjectExample: prompt.includes('{ "memories": [] }'),
      hasMemoryLayerField: prompt.includes('memoryLayer'),
      requestsBareArray: /Return (?:an|a JSON) \*{0,2}array/i.test(prompt),
    }).toEqual({
      hasEmptyObjectExample: true,
      hasMemoryLayerField: false,
      requestsBareArray: false,
    });
  });

  /**
   * @example
   * Identity actions are nested directly below `actions`.
   */
  it('matches the identity actions schema', () => {
    /**
     * @example
     * The prompt contains `{ "actions": ... }` and never references `withIdentities`.
     */
    expect({
      hasActionsExample: identityPrompt.includes('{ "actions":'),
      hasLegacyWrapper: identityPrompt.includes('withIdentities'),
    }).toEqual({ hasActionsExample: true, hasLegacyWrapper: false });
  });
});
