import { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from '@lobechat/const';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { testService } from '~test-utils';

import { AiModelService } from './index';

describe('AiModelService', () => {
  testService(AiModelService);
});

describe('Default model configuration', () => {
  it('DEFAULT_MODEL should be enabled in LOBE_DEFAULT_MODEL_LIST', () => {
    const match = LOBE_DEFAULT_MODEL_LIST.find((m) => m.id === DEFAULT_MODEL);
    expect(
      match,
      `DEFAULT_MODEL "${DEFAULT_MODEL}" not found in LOBE_DEFAULT_MODEL_LIST`,
    ).toBeDefined();
    expect(match!.enabled, `DEFAULT_MODEL "${DEFAULT_MODEL}" is not enabled`).toBe(true);
  });

  it('DEFAULT_MINI_MODEL should be enabled in LOBE_DEFAULT_MODEL_LIST', () => {
    const match = LOBE_DEFAULT_MODEL_LIST.find((m) => m.id === DEFAULT_MINI_MODEL);
    expect(
      match,
      `DEFAULT_MINI_MODEL "${DEFAULT_MINI_MODEL}" not found in LOBE_DEFAULT_MODEL_LIST`,
    ).toBeDefined();
    expect(match!.enabled, `DEFAULT_MINI_MODEL "${DEFAULT_MINI_MODEL}" is not enabled`).toBe(true);
  });
});
