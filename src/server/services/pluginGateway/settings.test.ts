import { describe, expect, it } from 'vitest';

import { parserPluginSettings } from './settings';

describe('parserPluginSettings', () => {
  it('should return an empty object when input is undefined', () => {
    expect(parserPluginSettings()).toEqual({});
  });

  it('should return an empty object when input is an empty string', () => {
    expect(parserPluginSettings('')).toEqual({});
  });

  it('should parse plugin settings from a well-formed string', () => {
    const input = 'plugin1:key1=value1;key2=value2,plugin2:key3=value3';
    const expected = {
      plugin1: { key1: 'value1', key2: 'value2' },
      plugin2: { key3: 'value3' },
    };
    expect(parserPluginSettings(input)).toEqual(expected);
  });

  it('should handle strings with Chinese commas', () => {
    const input = 'plugin1:key1=value1;key2=value2，plugin2:key3=value3';
    const expected = {
      plugin1: { key1: 'value1', key2: 'value2' },
      plugin2: { key3: 'value3' },
    };
    expect(parserPluginSettings(input)).toEqual(expected);
  });

  it('should ignore empty segments', () => {
    const input = 'plugin1:key1=value1;key2=value2,,,plugin2:key3=value3';
    const expected = {
      plugin1: { key1: 'value1', key2: 'value2' },
      plugin2: { key3: 'value3' },
    };
    expect(parserPluginSettings(input)).toEqual(expected);
  });

  it('should merge settings for the same pluginId', () => {
    const input = 'plugin1:key1=value1;key2=value2,plugin1:key3=value3;key4=value4';
    const expected = {
      plugin1: { key1: 'value1', key2: 'value2', key3: 'value3', key4: 'value4' },
    };
    expect(parserPluginSettings(input)).toEqual(expected);
  });

  it('should override previous values if the same key appears again for the same pluginId', () => {
    const input = 'plugin1:key1=value1;key2=value2,plugin1:key2=newValue2;key3=value3';
    const expected = {
      plugin1: { key1: 'value1', key2: 'newValue2', key3: 'value3' },
    };
    expect(parserPluginSettings(input)).toEqual(expected);
  });

  describe('error senses', () => {
    it('should ignore settings with incorrect key-value format', () => {
      const input = 'plugin1:key1=value1;incorrectFormat,plugin2:key2=value2';
      const expected = {
        plugin1: { key1: 'value1' },
        plugin2: { key2: 'value2' },
      };
      expect(parserPluginSettings(input)).toEqual(expected);
    });

    it('should handle extra separators gracefully', () => {
      const input = 'plugin1:key1=value1==value1.1;key2=value2;,plugin2:key3=value3';
      const expected = {
        plugin1: { key1: 'value1', key2: 'value2' },
        plugin2: { key3: 'value3' },
      };
      expect(parserPluginSettings(input)).toEqual(expected);
    });

    it('should ignore settings with empty keys or values', () => {
      const input = 'plugin1:=value1;key2=,plugin2:key3=value3';
      const expected = {
        plugin2: { key3: 'value3' },
      };

      expect(parserPluginSettings(input)).toEqual(expected);
    });

    it('should ignore leading and trailing whitespace in keys and values', () => {
      const input = ' plugin1 : key1 = value1 ; key2 =  value2 , plugin2 : key3=value3 ';
      const expected = {
        plugin1: { key1: 'value1', key2: 'value2' },
        plugin2: { key3: 'value3' },
      };
      expect(parserPluginSettings(input)).toEqual(expected);
    });

    it('should handle special characters in keys and values', () => {
      const input = 'plugin1:key1=value1+special;key2=value2#special,plugin2:key3=value3/special';
      const expected = {
        plugin1: { key1: 'value1+special', key2: 'value2#special' },
        plugin2: { key3: 'value3/special' },
      };
      expect(parserPluginSettings(input)).toEqual(expected);
    });
  });
});
