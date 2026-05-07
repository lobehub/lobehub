import matter from 'gray-matter';

/**
 * Parsed metadata from a managed skill `SKILL.md` frontmatter block.
 */
export interface SkillFrontmatter {
  /** Human-readable description used for listings and document metadata. */
  description: string;
  /** Stable lowercase skill package name. */
  name: string;
}

/**
 * Input required to normalize a managed skill index document.
 */
export interface NormalizeSkillIndexContentInput {
  /** Stable bundle filename that must become the frontmatter `name`. */
  bundleName: string;
  /** Raw `SKILL.md` content with frontmatter and body. */
  content: string;
  /** Optional replacement description. Keeps the current frontmatter description when omitted. */
  description?: string;
}

/**
 * Input required to render a managed skill index from structured fields.
 */
export interface RenderSkillIndexContentInput {
  /** Markdown body authored by the skill-management agent. */
  bodyMarkdown: string;
  /** Frontmatter description rendered by the service. */
  description: string;
  /** Stable bundle filename rendered as frontmatter `name`. */
  name: string;
}

interface ParsedMatterResult {
  body: string;
  data: Record<string, unknown>;
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 80;
const UNSAFE_FRONTMATTER_SCALAR_PATTERN = /[\r\n]/;
const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/**
 * Validates a stable skill package name.
 *
 * Use when:
 * - Creating or renaming managed skill bundles.
 * - Projecting a managed skill into VFS paths.
 *
 * Expects:
 * - The input is a single lowercase path segment.
 *
 * Returns:
 * - The trimmed stable skill name.
 */
export const validateSkillName = (value: string): string => {
  const name = value.trim();

  if (
    !name ||
    name.length > MAX_SKILL_NAME_LENGTH ||
    !SKILL_NAME_PATTERN.test(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('Invalid skill name: expected lowercase letters, digits, and hyphens');
  }

  return name;
};

const parseMatter = (content: string): ParsedMatterResult => {
  const normalizedContent = content.trimStart();

  if (!normalizedContent.startsWith('---')) {
    throw new Error('Skill index content must start with frontmatter');
  }

  if (!FRONTMATTER_BLOCK_PATTERN.test(normalizedContent)) {
    throw new Error('Skill index content must close frontmatter');
  }

  const parsed = matter(normalizedContent);

  return { body: parsed.content, data: parsed.data };
};

/**
 * Renders skill index content from structured metadata and body Markdown.
 *
 * Before:
 * - bodyMarkdown: "# Review\n\n## Workflow\n- Check tests."
 *
 * After:
 * - "---\nname: review\ndescription: Review PRs\n---\n# Review\n\n## Workflow\n- Check tests."
 */
export const renderSkillIndexContent = (input: RenderSkillIndexContentInput): string => {
  const name = validateSkillName(input.name);
  const description = normalizeFrontmatterScalar(input.description, 'description');
  const body = input.bodyMarkdown.trimStart();

  if (!body) {
    throw new Error('Skill bodyMarkdown is required');
  }

  if (body.startsWith('---')) {
    throw new Error('Skill bodyMarkdown must not include YAML frontmatter');
  }

  return matter
    .stringify(body, {
      description,
      name,
    })
    .replace(/\n$/, body.endsWith('\n') ? '\n' : '');
};

/**
 * Parses skill index frontmatter.
 *
 * Use when:
 * - Validating incoming skill content before persistence.
 * - Updating `metadata.skill.frontmatter` from normalized content.
 *
 * Expects:
 * - YAML-like `name` and `description` scalar lines.
 *
 * Returns:
 * - Parsed frontmatter fields.
 */
export const parseSkillFrontmatter = (content: string): SkillFrontmatter => {
  const { data } = parseMatter(content);
  const { description, name } = readSkillFrontmatterFields(data);

  if (!name) throw new Error('Skill frontmatter name is required');
  if (!description) throw new Error('Skill frontmatter description is required');

  return {
    description: normalizeFrontmatterScalar(description, 'description'),
    name: validateSkillName(name),
  };
};

/**
 * Normalizes skill index content.
 *
 * Before:
 * - "---\nname: old-name\ndescription: Old\n---\nBody"
 *
 * After:
 * - "---\nname: new-name\ndescription: Old\n---\nBody"
 */
export const normalizeSkillIndexContent = (input: NormalizeSkillIndexContentInput): string => {
  const bundleName = validateSkillName(input.bundleName);
  const { body, data } = parseMatter(input.content);
  const { description: parsedDescription } = readSkillFrontmatterFields(data);
  const description =
    input.description === undefined
      ? parsedDescription
      : normalizeFrontmatterScalar(input.description, 'description');

  if (!description) {
    throw new Error('Skill frontmatter description is required');
  }

  const serialized = matter.stringify(body, {
    ...data,
    description: normalizeFrontmatterScalar(description, 'description'),
    name: bundleName,
  });

  return body.endsWith('\n') ? serialized : serialized.replace(/\n$/, '');
};

const readSkillFrontmatterFields = (data: Record<string, unknown>): Partial<SkillFrontmatter> => {
  const name = typeof data.name === 'string' ? data.name.trim() : undefined;
  const description = typeof data.description === 'string' ? data.description.trim() : undefined;

  return { description, name };
};

/**
 * Normalizes frontmatter scalar values before writing them through YAML serialization.
 *
 * Before:
 * - "Review PRs\nname: injected"
 *
 * After:
 * - throws "Skill frontmatter description must be a single-line scalar"
 */
export const normalizeFrontmatterScalar = (value: string, field: string): string => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Skill frontmatter ${field} is required`);
  }

  if (UNSAFE_FRONTMATTER_SCALAR_PATTERN.test(normalized)) {
    throw new Error(`Skill frontmatter ${field} must be a single-line scalar`);
  }

  return normalized;
};
