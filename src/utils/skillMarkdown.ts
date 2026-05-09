import { parse } from 'yaml';

const SKILL_INDEX_FILENAME = 'SKILL.md';
const SKILL_INDEX_FILE_TYPE = 'skills/index';
const SKILL_MARKDOWN_LEADING_WHITESPACE_REGEX = /^\uFEFF?[ \t]*(?:\r?\n[ \t]*)*/;
const SKILL_MARKDOWN_FRONTMATTER_REGEX =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 80;
const UNSAFE_FRONTMATTER_SCALAR_PATTERN = /[\r\n]/;

interface SkillMarkdownDocumentFields {
  filename?: string | null;
  fileType?: string | null;
  title?: string | null;
}

interface SkillMarkdownParts {
  body: string;
  frontmatter?: string;
}

export interface SkillMarkdownMetadataItem {
  key: string;
  value: string;
}

export interface SkillMarkdownFrontmatterFields {
  description?: string;
  name?: string;
}

interface SkillMarkdownMetadataValidationOptions {
  expectedName?: string;
}

export type SkillMarkdownMetadataError =
  | {
      type: 'required';
    }
  | {
      type: 'mapping';
    }
  | {
      type: 'nameRequired';
    }
  | {
      type: 'nameInvalid';
    }
  | {
      expectedName: string;
      type: 'nameLocked';
    }
  | {
      type: 'descriptionRequired';
    }
  | {
      type: 'descriptionInvalid';
    }
  | {
      type: 'syntax';
    };

export const isSkillMarkdownDocument = (document: SkillMarkdownDocumentFields): boolean =>
  document.fileType === SKILL_INDEX_FILE_TYPE ||
  document.filename === SKILL_INDEX_FILENAME ||
  document.title === SKILL_INDEX_FILENAME;

export const parseSkillMarkdownFrontmatter = (content?: string | null): SkillMarkdownParts => {
  if (!content) return { body: '' };

  const normalizedContent = content.replace(SKILL_MARKDOWN_LEADING_WHITESPACE_REGEX, '');
  const match = normalizedContent.match(SKILL_MARKDOWN_FRONTMATTER_REGEX);
  if (!match) return { body: content };

  return {
    body: match[2].replace(/^\r?\n/, ''),
    frontmatter: match[1],
  };
};

export const composeSkillMarkdown = (frontmatter: string | undefined, body: string): string => {
  if (!frontmatter) return body;

  const normalizedFrontmatter = frontmatter.trimEnd();
  if (!body) return `---\n${normalizedFrontmatter}\n---\n`;

  return `---\n${normalizedFrontmatter}\n---\n\n${body.replace(/^\r?\n/, '')}`;
};

const stringifyMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return JSON.stringify(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isValidSkillName = (name: string): boolean =>
  !!name &&
  name.length <= MAX_SKILL_NAME_LENGTH &&
  SKILL_NAME_PATTERN.test(name) &&
  !name.includes('/') &&
  !name.includes('\\') &&
  name !== '.' &&
  name !== '..';

const readFrontmatterStringField = (
  data: Record<string, unknown>,
  field: keyof SkillMarkdownFrontmatterFields,
): string | undefined => {
  const value = data[field];
  return typeof value === 'string' ? value.trim() : undefined;
};

export const parseSkillMarkdownFrontmatterFields = (
  frontmatter?: string,
): SkillMarkdownFrontmatterFields => {
  if (!frontmatter) return {};

  try {
    const parsed = parse(frontmatter) as unknown;
    if (!isRecord(parsed)) return {};

    return {
      description: readFrontmatterStringField(parsed, 'description'),
      name: readFrontmatterStringField(parsed, 'name'),
    };
  } catch {
    return {};
  }
};

export const getSkillMarkdownMetadataError = (
  frontmatter?: string,
  options?: SkillMarkdownMetadataValidationOptions,
): SkillMarkdownMetadataError | undefined => {
  if (!frontmatter?.trim()) return { type: 'required' };

  try {
    const parsed = parse(frontmatter) as unknown;
    if (!isRecord(parsed)) {
      return { type: 'mapping' };
    }

    // Keep this client-side guard aligned with server skillManagement/frontmatter.ts so the
    // metadata editor cannot persist SKILL.md frontmatter that later skill code rejects.
    const nameValue = parsed.name;
    if (nameValue === undefined || (typeof nameValue === 'string' && !nameValue.trim())) {
      return { type: 'nameRequired' };
    }
    if (typeof nameValue !== 'string') return { type: 'nameInvalid' };

    const name = nameValue.trim();
    if (!isValidSkillName(name)) return { type: 'nameInvalid' };

    const expectedName = options?.expectedName?.trim();
    if (expectedName && isValidSkillName(expectedName) && name !== expectedName) {
      return { expectedName, type: 'nameLocked' };
    }

    const descriptionValue = parsed.description;
    if (
      descriptionValue === undefined ||
      (typeof descriptionValue === 'string' && !descriptionValue.trim())
    ) {
      return { type: 'descriptionRequired' };
    }
    if (typeof descriptionValue !== 'string') return { type: 'descriptionInvalid' };

    const description = descriptionValue.trim();
    if (UNSAFE_FRONTMATTER_SCALAR_PATTERN.test(description)) {
      return { type: 'descriptionInvalid' };
    }

    return undefined;
  } catch {
    return { type: 'syntax' };
  }
};

export const parseSkillMarkdownMetadata = (frontmatter?: string): SkillMarkdownMetadataItem[] => {
  if (!frontmatter) return [];

  try {
    const parsed = parse(frontmatter) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: stringifyMetadataValue(value),
    }));
  } catch (error) {
    console.error('[SkillMarkdown] Failed to parse SKILL.md frontmatter:', error);
    return [];
  }
};
