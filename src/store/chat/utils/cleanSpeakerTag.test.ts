import { describe, expect, it } from 'vitest';

import { cleanSpeakerTag } from './cleanSpeakerTag';

describe('cleanSpeakerTag', () => {
  describe('should remove speaker tag from beginning', () => {
    it('should remove speaker tag with newline', () => {
      const input = '<speaker name="Weather Expert" />\nHello, the weather is sunny!';
      const expected = 'Hello, the weather is sunny!';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should remove speaker tag without newline', () => {
      const input = '<speaker name="Weather Expert" />Hello!';
      const expected = 'Hello!';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should handle speaker tag with special characters in name', () => {
      const input = '<speaker name="AI Assistant 2.0" />\nResponse content';
      const expected = 'Response content';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should handle speaker tag with Chinese characters in name', () => {
      const input = '<speaker name="天气专家" />\n今天天气晴朗';
      const expected = '今天天气晴朗';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should handle speaker tag with extra spaces', () => {
      const input = '<speaker  name="Agent"  />\nContent';
      const expected = 'Content';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });
  });

  describe('should not modify content without speaker tag', () => {
    it('should return content unchanged if no speaker tag', () => {
      const input = 'Hello, how are you?';
      expect(cleanSpeakerTag(input)).toBe(input);
    });

    it('should not remove speaker tag in the middle of content', () => {
      const input = 'Hello <speaker name="Agent" /> world';
      expect(cleanSpeakerTag(input)).toBe(input);
    });

    it('should not remove speaker tag at the end', () => {
      const input = 'Hello world <speaker name="Agent" />';
      expect(cleanSpeakerTag(input)).toBe(input);
    });

    it('should handle empty string', () => {
      expect(cleanSpeakerTag('')).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should only remove the first speaker tag if model outputs multiple', () => {
      const input = '<speaker name="Agent1" />\n<speaker name="Agent2" />\nContent';
      const expected = '<speaker name="Agent2" />\nContent';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should handle speaker tag with empty name', () => {
      const input = '<speaker name="" />\nContent';
      const expected = 'Content';
      expect(cleanSpeakerTag(input)).toBe(expected);
    });

    it('should not match malformed speaker tags', () => {
      // Missing closing />
      const input1 = '<speaker name="Agent">\nContent';
      expect(cleanSpeakerTag(input1)).toBe(input1);

      // Missing name attribute
      const input2 = '<speaker />\nContent';
      expect(cleanSpeakerTag(input2)).toBe(input2);

      // Wrong attribute name
      const input3 = '<speaker title="Agent" />\nContent';
      expect(cleanSpeakerTag(input3)).toBe(input3);
    });

    it('should handle content that is only the speaker tag', () => {
      const input = '<speaker name="Agent" />';
      expect(cleanSpeakerTag(input)).toBe('');
    });

    it('should handle content that is only the speaker tag with newline', () => {
      const input = '<speaker name="Agent" />\n';
      expect(cleanSpeakerTag(input)).toBe('');
    });
  });
});
