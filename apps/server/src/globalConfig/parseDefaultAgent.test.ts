import { describe, expect, it } from 'vitest';

import { parseAgentConfig } from './parseDefaultAgent';

describe('parseAgentConfig', () => {
  describe('single functional feature', () => {
    it('parses single key-value pair correctly', () => {
      const envStr = 'model=gpt-4';
      const expected = { model: 'gpt-4' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses nested fields correctly', () => {
      const envStr = 'tts.sttLocale=en-US';
      const expected = { tts: { sttLocale: 'en-US' } };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses array values with commas correctly', () => {
      const envStr = 'plugins=search-engine,lobe-image-designer';
      const expected = { plugins: ['search-engine', 'lobe-image-designer'] };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses array values with Chinese commas correctly', () => {
      const envStr = 'plugins=search-engine，lobe-image-designer';
      const expected = { plugins: ['search-engine', 'lobe-image-designer'] };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses multiple key-value pairs correctly', () => {
      const envStr = 'model=gpt-4;version=1.0.0';
      const expected = { model: 'gpt-4', version: '1.0.0' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    // 测试数字值是否被正确解析为数字
    it('parses numerical values correctly', () => {
      const envStr = 'params.max_tokens=300';
      const expected = { params: { max_tokens: 300 } };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    // 测试多级嵌套属性是否被正确解析
    it('parses deeply nested fields correctly', () => {
      const envStr = 'tts.voice.openai=english-voice';
      const expected = { tts: { voice: { openai: 'english-voice' } } };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses boolean values correctly', () => {
      const envStr = 'enableHistoryCount=true;enableCompressThreshold=false';
      const expected = {
        enableHistoryCount: true,
        enableCompressThreshold: false,
      };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses fewShots array with cascading keys correctly', () => {
      const envStr =
        'fewShots.0.content=Hello;fewShots.0.role=user;fewShots.1.content=Hi;fewShots.1.role=system';
      const expected = {
        fewShots: [
          { content: 'Hello', role: 'user' },
          { content: 'Hi', role: 'system' },
        ],
      };

      // Assuming parseAgentConfig function has been implemented to understand and correctly parse the cascading keys format for fewShots
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses OpenAI TTS voice configuration correctly', () => {
      const envStr = 'tts.voice.openai=english-voice';
      const expected = {
        tts: { voice: { openai: 'english-voice' } },
      };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('parses inputTemplate with special characters correctly', () => {
      const envStr = 'inputTemplate="Hello, I am {name}"';
      const expected = { inputTemplate: 'Hello, I am {name}' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });
  });

  describe('complex environment', () => {
    it('parses environment variable string correctly', () => {
      const envStr =
        'model=gpt-4-1106-preview;params.max_tokens=300;plugins=search-engine,lobe-image-designer';
      const expected = {
        model: 'gpt-4-1106-preview',
        params: { max_tokens: 300 },
        plugins: ['search-engine', 'lobe-image-designer'],
      };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    // 测试当配置字符串包含所有可能字段时的行为
    it('parses a complex environment variable string correctly', () => {
      const envStr =
        'model=gpt-4-1106-preview;params.max_tokens=300;params.temperature=0.7;plugins=search-engine,lobe-image-designer;tts.voice.openai=english-voice';
      const expected = {
        model: 'gpt-4-1106-preview',
        params: { max_tokens: 300, temperature: 0.7 },
        plugins: ['search-engine', 'lobe-image-designer'],
        tts: { voice: { openai: 'english-voice' } },
      };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('should parsers plugins correctly', () => {
      const envStr =
        'enableHistoryCount=true;model=gemini-pro;provider=google;plugins=lobe-image-designer';

      const expected = {
        enableHistoryCount: true,
        model: 'gemini-pro',
        plugins: ['lobe-image-designer'],
        provider: 'google',
      };

      expect(parseAgentConfig(envStr)).toEqual(expected);
    });
  });

  describe('Error Boundary', () => {
    it('handles empty string input', () => {
      const envStr = '';
      const expected = {};
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('ignores entries without an equal sign', () => {
      const envStr = 'model=gpt-4;invalidentry';
      const expected = { model: 'gpt-4' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('handles entries with missing value', () => {
      const envStr = 'model=gpt-4;version=';
      const expected = { model: 'gpt-4', version: undefined };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('handles entries with missing key', () => {
      const envStr = '=gpt-4;version=1.0.0';
      const expected = { version: '1.0.0' }; // Assuming the parser ignores entries with no key
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    it('handles multiple consecutive semicolons', () => {
      const envStr = 'model=gpt-4;;version=1.0.0';
      const expected = { model: 'gpt-4', version: '1.0.0' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    // 测试键重复时的覆盖行为
    it('overrides duplicate keys with the last occurrence', () => {
      const envStr = 'model=gpt-4;model=gpt-4-1106-preview';
      const expected = { model: 'gpt-4-1106-preview' };
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });

    // 测试未提供的数组值是否返回空数组
    it('parses missing array values as undefined', () => {
      const envStr = 'plugins=';
      const expected = {};
      expect(parseAgentConfig(envStr)).toEqual(expected);
    });
  });

  // 测试值中包含分号的情况
  it('handles values with semicolons correctly', () => {
    const envStr = 'inputTemplate="Hello; I am a bot;"';
    const expected = { inputTemplate: 'Hello; I am a bot;' };
    expect(parseAgentConfig(envStr)).toEqual(expected);
  });

  // 测试值中包含等号的情况
  it('handles values with equals signs correctly', () => {
    const envStr = 'inputTemplate="Hello=world"';
    const expected = { inputTemplate: 'Hello=world' };
    expect(parseAgentConfig(envStr)).toEqual(expected);
  });

  // 测试空值是否返回undefined或空字符串
  it('parses empty values as undefined or empty string', () => {
    const envStr = 'model=';
    const expected = { model: undefined }; // 或 { model: '' }，取决于应用逻辑
    expect(parseAgentConfig(envStr)).toEqual(expected);
  });
});
