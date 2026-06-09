import { describe, expect, it } from 'vitest';

import { parseFeatureFlag } from './parser';

describe('parseFeatureFlag', () => {
  it('should parse an empty string into an empty object', () => {
    expect(parseFeatureFlag('')).toEqual({});
  });

  it('should enable a feature when prefixed with +', () => {
    expect(parseFeatureFlag('+api_key_manage')).toEqual({ api_key_manage: true });
  });

  it('should disable a feature when prefixed with -', () => {
    expect(parseFeatureFlag('-openai_api_key')).toEqual({ openai_api_key: false });
  });

  it('should handle multiple flags separated by commas', () => {
    const input = '+api_key_manage,-openai_api_key,+another_feature';

    expect(parseFeatureFlag(input)).toEqual({
      api_key_manage: true,
      openai_api_key: false,
    });
  });

  it('should hide content with commercial flags', () => {
    const input = '+commercial_hide_github,+commercial_hide_docs';
    expect(parseFeatureFlag(input)).toEqual({
      commercial_hide_docs: true,
      commercial_hide_github: true,
    });
  });

  it('invalid flag format return nothing', () => {
    const input = 'invalid_format';
    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('invalid format return empty object', () => {
    const input = '+webrtc_sync:unexpected';
    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('invalid flag format return nothing', () => {
    const input = 'invalid_format';
    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('invalid format return empty object', () => {
    const input = '+webrtc_sync:unexpected';
    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('should handle flags separated by Chinese commas', () => {
    const input = '+api_key_manage，-openai_api_key';

    expect(parseFeatureFlag(input)).toEqual({
      api_key_manage: true,
      openai_api_key: false,
    });
  });

  it('should ignore whitespace around flags', () => {
    const input = '  +api_key_manage  ,  -openai_api_key  ';

    expect(parseFeatureFlag(input)).toEqual({
      api_key_manage: true,
      openai_api_key: false,
    });
  });

  it('should handle flags with underscores and numbers', () => {
    const input = '+feature_1,-feature_2';

    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('should handle flags in camelCase', () => {
    const input = '+webrtcSync,-openaiApiKey';

    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('should handle flags in PascalCase', () => {
    const input = '+WebrtcSync,-OpenaiApiKey';

    expect(parseFeatureFlag(input)).toEqual({});
  });

  it('should handle flags with special characters', () => {
    const input = '+webrtc-sync,-openai.api.key';

    expect(parseFeatureFlag(input)).toEqual({});
  });
});
