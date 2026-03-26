// @vitest-environment node
import {
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  DocumentTemplateManager,
} from '@lobechat/agent-templates';
import { describe, expect, it } from 'vitest';

describe('DocumentTemplateManager', () => {
  describe('validate', () => {
    it('should return false when required fields are missing', () => {
      expect(
        DocumentTemplateManager.validate({
          content: 'content',
          description: 'desc',
          filename: '',
          title: 'Valid Title',
        }),
      ).toBe(false);

      expect(
        DocumentTemplateManager.validate({
          content: '',
          description: 'desc',
          filename: 'valid.txt',
          title: 'Valid Title',
        }),
      ).toBe(false);

      expect(
        DocumentTemplateManager.validate({
          content: 'content',
          description: 'desc',
          filename: 'valid.txt',
          title: '',
        }),
      ).toBe(false);
    });

    it('should return true for a complete template', () => {
      expect(
        DocumentTemplateManager.validate({
          content: 'content',
          description: 'desc',
          filename: 'valid.txt',
          title: 'Valid Title',
        }),
      ).toBe(true);
    });
  });

  describe('generateFilename', () => {
    it('should normalize titles into txt filenames', () => {
      expect(DocumentTemplateManager.generateFilename('Hello, World!')).toBe('hello-world.txt');
      expect(DocumentTemplateManager.generateFilename('  Multi   Space --- Title  ')).toBe(
        'multi-space-title.txt',
      );
      expect(DocumentTemplateManager.generateFilename('***')).toBe('.txt');
    });
  });

  describe('createBasic', () => {
    it('should create a template with defaults when options are omitted', () => {
      expect(DocumentTemplateManager.createBasic('Agent Notes', 'body')).toEqual({
        content: 'body',
        description: 'Template for Agent Notes',
        filename: 'agent-notes.txt',
        loadPosition: undefined,
        loadRules: undefined,
        metadata: undefined,
        policyLoadFormat: undefined,
        title: 'Agent Notes',
      });
    });

    it('should preserve explicit options', () => {
      const loadRules = {
        keywordMatchMode: 'all' as const,
        keywords: ['alpha'],
        maxTokens: 200,
        priority: 1,
        rule: DocumentLoadRule.BY_KEYWORDS,
      };

      expect(
        DocumentTemplateManager.createBasic('Profile', 'content', {
          description: 'custom',
          filename: 'custom.md',
          loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
          loadRules,
          metadata: { scope: 'team' },
          policyLoadFormat: DocumentLoadFormat.FILE,
        }),
      ).toEqual({
        content: 'content',
        description: 'custom',
        filename: 'custom.md',
        loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
        loadRules,
        metadata: { scope: 'team' },
        policyLoadFormat: DocumentLoadFormat.FILE,
        title: 'Profile',
      });
    });
  });

  describe('merge', () => {
    it('should merge templates into titled markdown sections', () => {
      expect(
        DocumentTemplateManager.merge([
          { content: 'first body', description: 'a', filename: 'a.txt', title: 'First' },
          { content: 'second body', description: 'b', filename: 'b.txt', title: 'Second' },
        ]),
      ).toBe('<!-- First -->\nfirst body\n\n<!-- Second -->\nsecond body');
    });
  });

  describe('extractVariables', () => {
    it('should extract unique variable names in encounter order', () => {
      expect(
        DocumentTemplateManager.extractVariables(
          'Hello {{name}}, role {{role}}, repeat {{name}}, skip {{not-valid.value}}',
        ),
      ).toEqual(['name', 'role']);
    });
  });

  describe('replaceVariables', () => {
    it('should replace all matching placeholders and leave missing values unchanged', () => {
      expect(
        DocumentTemplateManager.replaceVariables('Hi {{name}} and {{name}} from {{team}}', {
          name: 'Lobe',
        }),
      ).toBe('Hi Lobe and Lobe from {{team}}');
    });
  });

  describe('createWithVariables', () => {
    it('should mark variable metadata while preserving existing metadata', () => {
      expect(
        DocumentTemplateManager.createWithVariables('Prompt', 'Hello {{name}}', ['name'], {
          metadata: { scope: 'private' },
        }),
      ).toEqual({
        content: 'Hello {{name}}',
        description: 'Template for Prompt',
        filename: 'prompt.txt',
        loadPosition: undefined,
        loadRules: undefined,
        metadata: {
          hasVariables: true,
          scope: 'private',
          variables: ['name'],
        },
        policyLoadFormat: undefined,
        title: 'Prompt',
      });
    });
  });

  describe('clone', () => {
    it('should merge metadata while applying other modifications', () => {
      const template = DocumentTemplateManager.createWithVariables('Original', 'Hi {{name}}', [
        'name',
      ]);

      expect(
        DocumentTemplateManager.clone(template, {
          description: 'updated',
          metadata: { scope: 'team', variables: ['name', 'team'] },
          title: 'Cloned',
        }),
      ).toEqual({
        content: 'Hi {{name}}',
        description: 'updated',
        filename: 'original.txt',
        loadPosition: undefined,
        loadRules: undefined,
        metadata: {
          hasVariables: true,
          scope: 'team',
          variables: ['name', 'team'],
        },
        policyLoadFormat: undefined,
        title: 'Cloned',
      });
    });

    it('should keep original metadata when no modifications are provided', () => {
      const template = DocumentTemplateManager.createBasic('Base', 'content', {
        metadata: { scope: 'self' },
      });

      expect(DocumentTemplateManager.clone(template)).toEqual(template);
    });
  });
});
