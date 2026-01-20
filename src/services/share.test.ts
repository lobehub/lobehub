import { describe, expect, it } from 'vitest';

import { LOBE_URL_IMPORT_NAME } from '@/const/url';

import { shareService } from './share';

describe('ShareService', () => {
  describe('createShareSettingsUrl', () => {
    it('should create a valid share URL with settings', () => {
      const settings = {
        general: {
          language: 'en-US',
          themeMode: 'dark',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encodeURI(JSON.stringify(settings))}`);
    });

    it('should handle complex nested settings', () => {
      const settings = {
        defaultAgent: {
          config: {
            model: 'gpt-4',
            temperature: 0.7,
          },
        },
        general: {
          language: 'zh-CN',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle empty settings object', () => {
      const settings = {} as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encodeURI(JSON.stringify(settings))}`);
      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=%7B%7D`);
    });

    it('should handle settings with special characters', () => {
      const settings = {
        defaultAgent: {
          meta: {
            description: 'Hello! How are you? I\'m "fine" & ready.',
          },
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with unicode characters', () => {
      const settings = {
        defaultAgent: {
          systemRole: '你好世界 🌍',
        },
        general: {
          language: 'zh-CN',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with arrays', () => {
      const settings = {
        tool: {
          builtins: ['calculator', 'search', 'image-generation'],
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with null values', () => {
      const settings = {
        keyVaults: null,
        general: {
          language: 'en-US',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with undefined values', () => {
      const settings = {
        keyVaults: undefined,
        general: {
          language: 'en-US',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      // undefined values are omitted in JSON.stringify
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with boolean values', () => {
      const settings = {
        general: {
          enableAutoUpdate: true,
          enableTelemetry: false,
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });

    it('should handle settings with numeric values', () => {
      const settings = {
        general: {
          fontSize: 14,
        },
        defaultAgent: {
          config: {
            temperature: 0.7,
            max_tokens: 4096,
          },
        },
      } as any;

      const url = shareService.createShareSettingsUrl(settings);

      expect(url).toContain(LOBE_URL_IMPORT_NAME);
      expect(url).toContain(encodeURI(JSON.stringify(settings)));
    });
  });

  describe('decodeShareSettings', () => {
    it('should decode valid JSON settings string', () => {
      const settings = {
        language: 'en-US',
        themeMode: 'dark',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode complex nested settings', () => {
      const settings = {
        defaultAgent: {
          config: {
            model: 'gpt-4',
            temperature: 0.7,
          },
        },
        language: 'zh-CN',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should handle invalid JSON and return error message', () => {
      const invalidJson = 'not-valid-json{';

      const result = shareService.decodeShareSettings(invalidJson);

      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
    });

    it('should handle empty string and return error message', () => {
      const result = shareService.decodeShareSettings('');

      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
    });

    it('should handle malformed JSON with extra characters', () => {
      const malformedJson = '{"language":"en-US"}extra';

      const result = shareService.decodeShareSettings(malformedJson);

      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
    });

    it('should decode settings with special characters', () => {
      const settings = {
        customInstruction: 'Hello! How are you? I\'m "fine" & ready.',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode settings with unicode characters', () => {
      const settings = {
        systemRole: '你好世界 🌍',
        language: 'zh-CN',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode settings with arrays', () => {
      const settings = {
        tools: ['calculator', 'search', 'image-generation'],
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode settings with null values', () => {
      const settings = {
        apiKey: null,
        language: 'en-US',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode settings with boolean values', () => {
      const settings = {
        enableAutoUpdate: true,
        enableTelemetry: false,
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should decode settings with numeric values', () => {
      const settings = {
        fontSize: 14,
        temperature: 0.7,
        maxTokens: 4096,
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should handle empty object', () => {
      const settingsString = JSON.stringify({});

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: {} });
    });

    it('should handle null as input', () => {
      const result = shareService.decodeShareSettings('null');

      expect(result).toEqual({ data: null });
    });

    it('should handle array as input', () => {
      const settingsString = JSON.stringify(['item1', 'item2']);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: ['item1', 'item2'] });
    });

    it('should handle JSON with escaped quotes', () => {
      const settings = {
        prompt: 'Say "hello" to the world',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });

    it('should handle JSON with newlines', () => {
      const settings = {
        multiline: 'Line 1\nLine 2\nLine 3',
      };
      const settingsString = JSON.stringify(settings);

      const result = shareService.decodeShareSettings(settingsString);

      expect(result).toEqual({ data: settings });
    });
  });

  describe('round-trip encoding and decoding', () => {
    it('should successfully encode and decode simple settings', () => {
      const originalSettings = {
        general: {
          language: 'en-US',
          themeMode: 'dark',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(originalSettings);
      const encodedSettings = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decodedString = decodeURI(encodedSettings);
      const result = shareService.decodeShareSettings(decodedString);

      expect(result).toEqual({ data: originalSettings });
    });

    it('should successfully encode and decode complex settings', () => {
      const originalSettings = {
        defaultAgent: {
          config: {
            model: 'gpt-4',
            temperature: 0.7,
          },
          systemRole: 'You are a helpful assistant',
        },
        general: {
          language: 'zh-CN',
          themeMode: 'auto',
          fontSize: 14,
        },
        tool: {
          builtins: ['search', 'calculator'],
        },
      } as any;

      const url = shareService.createShareSettingsUrl(originalSettings);
      const encodedSettings = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decodedString = decodeURI(encodedSettings);
      const result = shareService.decodeShareSettings(decodedString);

      expect(result).toEqual({ data: originalSettings });
    });

    it('should successfully encode and decode settings with unicode', () => {
      const originalSettings = {
        defaultAgent: {
          systemRole: '你好，我是一个AI助手 🤖',
        },
        general: {
          language: 'zh-CN',
        },
      } as any;

      const url = shareService.createShareSettingsUrl(originalSettings);
      const encodedSettings = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decodedString = decodeURI(encodedSettings);
      const result = shareService.decodeShareSettings(decodedString);

      expect(result).toEqual({ data: originalSettings });
    });
  });
});
