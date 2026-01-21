import type { PartialDeep } from 'type-fest';
import { describe, expect, it } from 'vitest';

import { LOBE_URL_IMPORT_NAME } from '@/const/url';
import type { UserSettings } from '@/types/user/settings';

import { shareService } from './share';

describe('ShareService', () => {
  describe('createShareSettingsUrl', () => {
    it('should create a valid share URL with simple settings', () => {
      // Arrange
      const settings: PartialDeep<UserSettings> = {
        general: {
          fontSize: 14,
        },
      };

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain(`?${LOBE_URL_IMPORT_NAME}=`);
      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encodeURI(JSON.stringify(settings))}`);
    });

    it('should handle empty settings object', () => {
      // Arrange
      const settings = {};

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encodeURI(JSON.stringify({}))}`);
      expect(url).toContain('%7B%7D'); // {} encoded
    });

    it('should properly encode special characters in settings', () => {
      // Arrange
      const settings = {
        general: {
          avatar: 'https://example.com/avatar?id=123&size=large',
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain(`?${LOBE_URL_IMPORT_NAME}=`);
      // encodeURI should preserve some special chars like : / ? & =
      expect(url).toContain('https://example.com/avatar?id=123&size=large');
    });

    it('should handle nested settings objects', () => {
      // Arrange
      const settings = {
        defaultAgent: {
          chatConfig: {
            temperature: 0.7,
          },
        },
        general: {
          fontSize: 14,
          primaryColor: 'blue',
        },
      } as PartialDeep<UserSettings>;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain(`?${LOBE_URL_IMPORT_NAME}=`);
      const encoded = encodeURI(JSON.stringify(settings));
      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encoded}`);
    });

    it('should handle settings with null values', () => {
      // Arrange
      const settings = {
        general: {
          fontSize: null,
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain('null');
    });

    it('should handle settings with undefined values', () => {
      // Arrange
      const settings = {
        general: {
          fontSize: undefined,
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      // JSON.stringify removes undefined values
      expect(url).toBe(`/?${LOBE_URL_IMPORT_NAME}=${encodeURI('{"general":{}}')}`);
    });

    it('should handle settings with array values', () => {
      // Arrange
      const settings = {
        keyVaults: {
          openai: {
            apiKey: ['key1', 'key2'],
          },
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain(`?${LOBE_URL_IMPORT_NAME}=`);
      expect(url).toContain('key1');
      expect(url).toContain('key2');
    });

    it('should handle complex partial UserSettings', () => {
      // Arrange
      const settings = {
        general: {
          fontSize: 14,
          primaryColor: 'blue',
        },
        defaultAgent: {
          meta: {
            title: 'Test Agent',
          },
        },
      } as PartialDeep<UserSettings>;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain(`?${LOBE_URL_IMPORT_NAME}=`);
      expect(url).toContain('blue');
      expect(url).toContain('Test%20Agent'); // Space encoded
    });

    it('should handle settings with boolean values', () => {
      // Arrange
      const settings = {
        general: {
          testFlag: true,
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain('true');
    });

    it('should handle settings with number values', () => {
      // Arrange
      const settings = {
        general: {
          fontSize: 16,
        },
        defaultAgent: {
          chatConfig: {
            temperature: 0.7,
          },
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(settings);

      // Assert
      expect(url).toContain('0.7');
      expect(url).toContain('16');
    });
  });

  describe('decodeShareSettings', () => {
    it('should decode valid JSON settings string', () => {
      // Arrange
      const settings = {
        general: {
          language: 'en-US',
        },
      };
      const encoded = JSON.stringify(settings);

      // Act
      const result = shareService.decodeShareSettings(encoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(settings);
      expect(result).not.toHaveProperty('message');
    });

    it('should decode empty object', () => {
      // Arrange
      const encoded = '{}';

      // Act
      const result = shareService.decodeShareSettings(encoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual({});
    });

    it('should decode complex nested settings', () => {
      // Arrange
      const settings = {
        defaultAgent: {
          chatConfig: {
            temperature: 0.7,
            historyCount: 5,
          },
          meta: {
            title: 'Test',
          },
        },
        general: {
          language: 'zh-CN',
        },
      };
      const encoded = JSON.stringify(settings);

      // Act
      const result = shareService.decodeShareSettings(encoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(settings);
    });

    it('should return error message for invalid JSON', () => {
      // Arrange
      const invalidJson = 'not a valid json';

      // Act
      const result = shareService.decodeShareSettings(invalidJson);

      // Assert
      expect(result).not.toHaveProperty('data');
      expect(result).toHaveProperty('message');
      expect(result.message).toBeTruthy();
    });

    it('should handle malformed JSON with extra characters', () => {
      // Arrange
      const malformed = '{"general":{"language":"en-US"}}}';

      // Act
      const result = shareService.decodeShareSettings(malformed);

      // Assert
      expect(result).not.toHaveProperty('data');
      expect(result).toHaveProperty('message');
    });

    it('should handle empty string', () => {
      // Arrange
      const empty = '';

      // Act
      const result = shareService.decodeShareSettings(empty);

      // Assert
      expect(result).not.toHaveProperty('data');
      expect(result).toHaveProperty('message');
    });

    it('should handle null as string', () => {
      // Arrange
      const nullString = 'null';

      // Act
      const result = shareService.decodeShareSettings(nullString);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toBe(null);
    });

    it('should handle array JSON', () => {
      // Arrange
      const array = '["item1", "item2"]';

      // Act
      const result = shareService.decodeShareSettings(array);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(['item1', 'item2']);
    });

    it('should handle settings with special characters', () => {
      // Arrange
      const settings = {
        general: {
          avatar: 'https://example.com/avatar?id=123&size=large',
        },
      };
      const encoded = JSON.stringify(settings);

      // Act
      const result = shareService.decodeShareSettings(encoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(settings);
    });

    it('should handle JSON with unicode characters', () => {
      // Arrange
      const settings = {
        general: {
          language: '中文',
          emoji: '🤯',
        },
      };
      const encoded = JSON.stringify(settings);

      // Act
      const result = shareService.decodeShareSettings(encoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(settings);
    });

    it('should return stringified error for decoding errors', () => {
      // Arrange
      const invalid = 'not valid json at all';

      // Act
      const result = shareService.decodeShareSettings(invalid);

      // Assert
      expect(result).toHaveProperty('message');
      expect(result).not.toHaveProperty('data');
      expect(typeof result.message).toBe('string');
      // Error message should be a stringified error object
      expect(result.message!.length).toBeGreaterThan(0);
    });
  });

  describe('Integration: encode and decode', () => {
    it('should successfully round-trip settings', () => {
      // Arrange
      const originalSettings = {
        general: {
          fontSize: 14,
          primaryColor: 'blue',
        },
        defaultAgent: {
          chatConfig: {
            temperature: 0.7,
          },
        },
      } as PartialDeep<UserSettings>;

      // Act
      const url = shareService.createShareSettingsUrl(originalSettings);
      // Extract the encoded settings from URL
      const encodedPart = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decoded = decodeURI(encodedPart);
      const result = shareService.decodeShareSettings(decoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(originalSettings);
    });

    it('should handle empty settings round-trip', () => {
      // Arrange
      const originalSettings = {};

      // Act
      const url = shareService.createShareSettingsUrl(originalSettings);
      const encodedPart = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decoded = decodeURI(encodedPart);
      const result = shareService.decodeShareSettings(decoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(originalSettings);
    });

    it('should handle complex settings with special characters round-trip', () => {
      // Arrange
      const originalSettings = {
        general: {
          fontSize: 14,
          customData: 'https://example.com/avatar?id=123&size=large',
        },
        keyVaults: {
          openai: {
            apiKey: 'sk-test123',
          },
        },
      } as any;

      // Act
      const url = shareService.createShareSettingsUrl(originalSettings);
      const encodedPart = url.split(`${LOBE_URL_IMPORT_NAME}=`)[1];
      const decoded = decodeURI(encodedPart);
      const result = shareService.decodeShareSettings(decoded);

      // Assert
      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(originalSettings);
    });
  });
});
