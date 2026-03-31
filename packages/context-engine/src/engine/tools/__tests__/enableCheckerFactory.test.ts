import { describe, expect, it } from 'vitest';

import { createEnableChecker } from '../enableCheckerFactory';
import type { LobeToolManifest } from '../types';

const makeParams = (pluginId: string, overrides: Record<string, any> = {}) => ({
  manifest: {
    api: [{ description: 'test', name: 'test', parameters: {} }],
    identifier: pluginId,
    meta: {},
    type: 'builtin' as const,
  } as LobeToolManifest,
  model: 'gpt-4',
  pluginId,
  provider: 'openai',
  ...overrides,
});

describe('createEnableChecker', () => {
  describe('default behavior', () => {
    it('should disable tools by default when no rule matches', () => {
      const checker = createEnableChecker({});

      expect(checker(makeParams('any-tool'))).toBe(false);
    });
  });

  describe('rules', () => {
    it('should disable tools matching a false rule', () => {
      const checker = createEnableChecker({
        rules: { 'web-search': false },
      });

      expect(checker(makeParams('web-search'))).toBe(false);
      expect(checker(makeParams('other-tool'))).toBe(false);
    });

    it('should enable tools matching a true rule', () => {
      const checker = createEnableChecker({
        rules: { 'web-search': true },
      });

      expect(checker(makeParams('web-search'))).toBe(true);
    });

    it('should handle multiple rules', () => {
      const checker = createEnableChecker({
        rules: {
          'knowledge-base': true,
          'local-system': false,
          'web-search': false,
        },
      });

      expect(checker(makeParams('local-system'))).toBe(false);
      expect(checker(makeParams('web-search'))).toBe(false);
      expect(checker(makeParams('knowledge-base'))).toBe(true);
      expect(checker(makeParams('unrelated-tool'))).toBe(false);
    });
  });

  describe('allowExplicitActivation', () => {
    it('should bypass rules when isExplicitActivation is true', () => {
      const checker = createEnableChecker({
        allowExplicitActivation: true,
        rules: { 'web-search': false },
      });

      expect(checker(makeParams('web-search', { context: { isExplicitActivation: true } }))).toBe(
        true,
      );
    });

    it('should not bypass when allowExplicitActivation is false', () => {
      const checker = createEnableChecker({
        allowExplicitActivation: false,
        rules: { 'web-search': false },
      });

      expect(checker(makeParams('web-search', { context: { isExplicitActivation: true } }))).toBe(
        false,
      );
    });

    it('should not bypass when isExplicitActivation is not set', () => {
      const checker = createEnableChecker({
        allowExplicitActivation: true,
        rules: { 'web-search': false },
      });

      expect(checker(makeParams('web-search'))).toBe(false);
    });
  });

  describe('platformFilter', () => {
    it('should use platformFilter result when it returns boolean', () => {
      const checker = createEnableChecker({
        platformFilter: ({ pluginId }) => {
          if (pluginId === 'local-system') return false;
          return undefined;
        },
        rules: { 'local-system': true },
      });

      // platformFilter takes priority over rules
      expect(checker(makeParams('local-system'))).toBe(false);
    });

    it('should fall through to rules when platformFilter returns undefined', () => {
      const checker = createEnableChecker({
        platformFilter: () => undefined,
        rules: { 'web-search': false },
      });

      expect(checker(makeParams('web-search'))).toBe(false);
    });

    it('should receive correct parameters', () => {
      let receivedParams: any;
      const checker = createEnableChecker({
        platformFilter: (params) => {
          receivedParams = params;
          return undefined;
        },
      });

      const manifest = {
        api: [{ description: 'test', name: 'test', parameters: {} }],
        identifier: 'test-tool',
        meta: {},
        type: 'builtin' as const,
      } as LobeToolManifest;

      checker({
        context: { environment: 'desktop' },
        manifest,
        model: 'gpt-4',
        pluginId: 'test-tool',
        provider: 'openai',
      });

      expect(receivedParams.pluginId).toBe('test-tool');
      expect(receivedParams.manifest).toBe(manifest);
      expect(receivedParams.context?.environment).toBe('desktop');
    });
  });

  describe('default behavior - should disable unknown tools', () => {
    it('should disable tools not listed in rules by default', () => {
      const checker = createEnableChecker({
        rules: {
          'knowledge-base': true,
          'memory': false,
          'web-browsing': true,
        },
      });

      // Tools in rules should follow their rule
      expect(checker(makeParams('knowledge-base'))).toBe(true);
      expect(checker(makeParams('memory'))).toBe(false);
      expect(checker(makeParams('web-browsing'))).toBe(true);

      // BUG: Tools NOT in rules currently default to true,
      // but should default to false to prevent unintended tool activation
      // This is the regression test for the "all 7 builtin tools enabled" bug
      expect(checker(makeParams('lobe-activator'))).toBe(false);
      expect(checker(makeParams('lobe-skills'))).toBe(false);
      expect(checker(makeParams('lobe-skill-store'))).toBe(false);
    });
  });

  describe('user-selected tools via rules', () => {
    it('should only enable user-selected tools plus explicitly enabled defaults', () => {
      // Simulates: user selected only "notebook", system enables knowledge-base and web-browsing
      const userPlugins = ['notebook'];
      const rules: Record<string, boolean> = {
        // System-level rules
        'knowledge-base': true,
        'memory': false,
        'web-browsing': true,
        // User-selected plugins
        ...Object.fromEntries(userPlugins.map((id) => [id, true])),
      };

      const checker = createEnableChecker({ rules });

      // User-selected tool: enabled
      expect(checker(makeParams('notebook'))).toBe(true);

      // System-enabled tools: follow their rules
      expect(checker(makeParams('knowledge-base'))).toBe(true);
      expect(checker(makeParams('web-browsing'))).toBe(true);
      expect(checker(makeParams('memory'))).toBe(false);

      // Default tools NOT in rules: should be disabled
      expect(checker(makeParams('lobe-activator'))).toBe(false);
      expect(checker(makeParams('lobe-skills'))).toBe(false);
      expect(checker(makeParams('lobe-skill-store'))).toBe(false);
    });
  });

  describe('priority order', () => {
    it('should apply: explicitActivation > platformFilter > rules > default', () => {
      const checker = createEnableChecker({
        allowExplicitActivation: true,
        platformFilter: ({ pluginId }) => {
          if (pluginId === 'platform-blocked') return false;
          return undefined;
        },
        rules: { 'rule-blocked': false },
      });

      // Explicit activation bypasses everything
      expect(
        checker(makeParams('platform-blocked', { context: { isExplicitActivation: true } })),
      ).toBe(true);

      // Platform filter blocks
      expect(checker(makeParams('platform-blocked'))).toBe(false);

      // Rule blocks
      expect(checker(makeParams('rule-blocked'))).toBe(false);

      // Default disables
      expect(checker(makeParams('other-tool'))).toBe(false);
    });
  });
});
