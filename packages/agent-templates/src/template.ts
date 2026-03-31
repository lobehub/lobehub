import type { DocumentLoadFormat, DocumentLoadPosition, DocumentLoadRules } from './types';

/**
 * Document Template Definition
 * Defines a template for creating agent documents with specific load rules
 */
export interface DocumentTemplate {
  /** Document content in Markdown format */
  content: string;
  /** Human-readable description of the template's purpose */
  description: string;
  /** Filename for the generated document */
  filename: string;
  /** Where in the context pipeline this document should be loaded */
  loadPosition?: DocumentLoadPosition;
  /** Rules for when and how this document should be loaded */
  loadRules?: DocumentLoadRules;
  /** Additional metadata for the template */
  metadata?: Record<string, any>;
  /** Default render format when the document is injected into context */
  policyLoadFormat?: DocumentLoadFormat;
  /** Human-readable title for the template */
  title: string;
}

/**
 * Agent Document Template Manager
 * Utilities for working with document templates
 */
export class DocumentTemplateManager {
  /**
   * Validate a document template structure
   */
  static validate(template: DocumentTemplate): boolean {
    if (!template.title || !template.filename || !template.content) {
      return false;
    }

    return true;
  }

  /**
   * Generate a filename from a title
   */
  static generateFilename(title: string): string {
    return (
      title
        .toLowerCase()
        .replaceAll(/[^a-z0-9\s-]/g, '')
        .replaceAll(/\s+/g, '-')
        .replaceAll(/-+/g, '-')
        .replaceAll(/^-|-$/g, '') + '.txt'
    );
  }

  /**
   * Create a basic template with default settings
   */
  static createBasic(
    title: string,
    content: string,
    options?: {
      description?: string;
      filename?: string;
      policyLoadFormat?: DocumentLoadFormat;
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, any>;
    },
  ): DocumentTemplate {
    return {
      title,
      content,
      description: options?.description || `Template for ${title}`,
      filename: options?.filename || this.generateFilename(title),
      policyLoadFormat: options?.policyLoadFormat,
      loadPosition: options?.loadPosition,
      loadRules: options?.loadRules,
      metadata: options?.metadata,
    };
  }

  /**
   * Merge multiple templates into a single content
   */
  static merge(templates: DocumentTemplate[]): string {
    const sections = templates.map((template) => {
      return [`<!-- ${template.title} -->`, template.content, ''].join('\n');
    });

    return sections.join('\n').trim();
  }

  /**
   * Extract variables from template content
   */
  static extractVariables(content: string): string[] {
    const variablePattern = /\{\{(\w+)\}\}/g;
    const variables: string[] = [];
    let match;

    while ((match = variablePattern.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    return variables;
  }

  /**
   * Replace variables in template content
   */
  static replaceVariables(content: string, variables: Record<string, string>): string {
    let result = content;

    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(pattern, value);
    }

    return result;
  }

  /**
   * Create a template with variable placeholders
   */
  static createWithVariables(
    title: string,
    content: string,
    variables: string[],
    options?: {
      description?: string;
      filename?: string;
      policyLoadFormat?: DocumentLoadFormat;
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, any>;
    },
  ): DocumentTemplate {
    const template = this.createBasic(title, content, options);

    template.metadata = {
      ...template.metadata,
      variables,
      hasVariables: true,
    };

    return template;
  }

  /**
   * Clone a template with modifications
   */
  static clone(
    template: DocumentTemplate,
    modifications?: Partial<DocumentTemplate>,
  ): DocumentTemplate {
    return {
      ...template,
      ...modifications,
      metadata: {
        ...template.metadata,
        ...modifications?.metadata,
      },
    };
  }
}
