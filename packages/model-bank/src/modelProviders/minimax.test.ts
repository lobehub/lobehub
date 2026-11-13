import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import MinimaxProviderCard from './minimax';
import MinimaxCodingPlanProviderCard from './minimaxCodingPlan';

// Chat models MiniMax answers with 404 / 2069 "is no longer available".
// Re-checked against api.minimaxi.com/v1/chat/completions on 2026-11-13.
const RETIRED_MINIMAX_CHAT_MODELS = [
  'MiniMax-M2',
  'MiniMax-M2-Stable',
  'MiniMax-M2-her',
  'MiniMax-M2.1',
  'MiniMax-M2.1-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
];

describe.each([
  { card: MinimaxProviderCard, providerId: 'minimax' },
  { card: MinimaxCodingPlanProviderCard, providerId: 'minimaxcodingplan' },
])('$providerId credential check model', ({ card, providerId }) => {
  const chatModels = LOBE_DEFAULT_MODEL_LIST.filter(
    (model) => model.providerId === providerId && model.type === 'chat',
  );

  it('points at an enabled chat model the provider lists', () => {
    const checkModel = chatModels.find((model) => model.id === card.checkModel);

    expect(checkModel, `${card.checkModel} is not a ${providerId} chat model`).toBeDefined();
    expect(checkModel?.enabled).toBe(true);
  });

  it('does not use a model MiniMax has retired', () => {
    expect(RETIRED_MINIMAX_CHAT_MODELS).not.toContain(card.checkModel);
  });

  it('does not enable retired models by default', () => {
    const enabledRetired = chatModels
      .filter((model) => model.enabled && RETIRED_MINIMAX_CHAT_MODELS.includes(model.id))
      .map((model) => model.id);

    expect(enabledRetired).toEqual([]);
  });
});
