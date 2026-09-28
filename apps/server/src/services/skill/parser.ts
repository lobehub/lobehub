import { readFile } from 'node:fs/promises';

import {
  type ParsedSkill,
  type ParsedZipSkill,
  type SkillManifest,
  skillManifestSchema,
} from '@lobechat/types';
import { decodeHTML } from 'entities';
import { unzip as fflateUnzip, zip as fflateZip } from 'fflate';
import matter from 'gray-matter';
import { sha256 } from 'js-sha256';
import { marked, type Token, type Tokens } from 'marked';

import { SkillManifestError, SkillParseError } from './errors';

export interface ParseSkillMdOptions {
  /**
   * Fallback skill name used when SKILL.md has no YAML front-matter AND no
   * `# H1` heading to derive a name from (e.g. the market identifier or the
   * skill directory name).
   */
  fallbackName?: string;
}

/** Max length of a description derived from SKILL.md body text */
const DERIVED_DESCRIPTION_MAX_LENGTH = 300;

export interface ParseZipOptions extends ParseSkillMdOptions {
  /**
   * Base path within the ZIP to look for SKILL.md
   * Used when importing from GitHub subdirectory URLs like:
   * https://github.com/owner/repo/tree/main/skills/skill-name
   */
  basePath?: string;
  /**
   * Whether to repack only the skill directory into a new ZIP
   * Used for GitHub imports to avoid storing the entire repo ZIP
   * When true:
   * - skillZipBuffer will contain the repacked skill directory
   * - zipHash will be the hash of the repacked ZIP (not the original)
   */
  repackSkillZip?: boolean;
}

/**
 * Visible plain text of inline Markdown tokens: link labels, emphasis and code
 * span contents are kept; images and inline HTML (comments, tags) are dropped,
 * and `<br>` becomes a space.
 */
const inlineToPlainText = (tokens: Token[] = []): string =>
  flattenInline(tokens).replaceAll(/\s+/g, ' ').trim();

const flattenInline = (tokens: Token[]): string =>
  tokens
    .map((token): string => {
      switch (token.type) {
        case 'image': {
          return '';
        }
        // Inline HTML is dropped, except a `<br>` which renders as a line break
        case 'html': {
          return /^<br\s*\/?>$/i.test((token as Tokens.HTML).text.trim()) ? ' ' : '';
        }
        case 'br': {
          return ' ';
        }
        // Rendered literally: a code span or a backslash escape keeps `&copy;` as typed
        case 'codespan':
        case 'escape': {
          return (token as Tokens.Codespan).text;
        }
        default: {
          const nested = (token as { tokens?: Token[] }).tokens;
          if (nested) return flattenInline(nested);
          // Plain text is where Markdown interprets entities (`&copy;` → ©), so
          // decode only here — the metadata is stored and shown as plain text.
          const text = (token as { text?: string }).text ?? '';
          return token.type === 'text' ? decodeHTML(text) : text;
        }
      }
    })
    .join('');

export class SkillParser {
  /**
   * Parse SKILL.md file content
   * @param fileContent - Raw content of SKILL.md file
   * @returns Parsed manifest, content and raw content
   */
  parseSkillMd(fileContent: string, options?: ParseSkillMdOptions): ParsedSkill {
    try {
      const source = this.stripLeadingCommentsBeforeFrontMatter(fileContent);
      const { data, content } = matter(source);
      // gray-matter yields the same empty `data` for an absent block and for an
      // empty / comment-only one (`---\n---`), so presence is detected on the
      // source: a present-but-incomplete block must stay authoritative.
      const hasFrontMatter = /^\uFEFF?---\s*\n/.test(source);
      const manifest = this.validateManifest(
        hasFrontMatter ? data : this.deriveManifestWithoutFrontMatter(content, options),
      );

      return {
        content: content.trim(),
        manifest,
        raw: fileContent,
      };
    } catch (error) {
      if (error instanceof SkillManifestError) throw error;
      throw new SkillParseError('Failed to parse SKILL.md', error as Error);
    }
  }

  /**
   * Parse ZIP file from path
   * @param filePath - Path to ZIP file
   * @returns Parsed manifest, content, resource file mapping and ZIP hash
   */
  async parseZipFile(filePath: string): Promise<ParsedZipSkill> {
    try {
      const buffer = await readFile(filePath);
      return this.parseZipPackage(buffer);
    } catch (error) {
      if (error instanceof SkillParseError || error instanceof SkillManifestError) {
        throw error;
      }
      throw new SkillParseError(`Failed to read ZIP file: ${filePath}`, error as Error);
    }
  }

  /**
   * Parse ZIP package
   * @param buffer - ZIP file Buffer
   * @param options - Optional parsing options including basePath for subdirectory imports
   * @returns Parsed manifest, content, resource file mapping and ZIP hash
   */
  async parseZipPackage(buffer: Buffer, options?: ParseZipOptions): Promise<ParsedZipSkill> {
    try {
      const unzipped = await this.unzipBuffer(buffer);

      // Find SKILL.md (support root directory, first-level subdirectory, or specified basePath)
      const { skillMdContent, skillMdPath } = this.findSkillMd(unzipped, options?.basePath);
      if (!skillMdPath) {
        throw new SkillParseError('SKILL.md not found in zip package');
      }

      // Parse SKILL.md (a nested SKILL.md's directory name is the last-resort name fallback)
      const skillDirName = skillMdPath.includes('/') ? skillMdPath.split('/').at(-2) : undefined;
      const { content, manifest } = this.parseSkillMd(skillMdContent, {
        fallbackName: options?.fallbackName || skillDirName,
      });

      // Extract resource files
      const resources = this.extractResources(unzipped, skillMdPath);

      // If repackSkillZip is true, create a new ZIP with only the skill files
      if (options?.repackSkillZip) {
        const skillZipBuffer = await this.repackSkillZip(skillMdContent, resources);
        const zipHash = sha256(skillZipBuffer);
        return { content, manifest, resources, skillZipBuffer, zipHash };
      }

      // Calculate ZIP hash from original buffer
      const zipHash = sha256(buffer);

      return { content, manifest, resources, zipHash };
    } catch (error) {
      if (error instanceof SkillParseError || error instanceof SkillManifestError) {
        throw error;
      }
      throw new SkillParseError('Failed to parse ZIP package', error as Error);
    }
  }

  /**
   * Some exported skills prepend an HTML comment (e.g.
   * `<!-- AUTO-GENERATED ... -->`) before the `---` front-matter block, which
   * makes gray-matter miss the front-matter entirely. Strip leading BOM /
   * whitespace / HTML comments, but only when front-matter follows them.
   */
  private stripLeadingCommentsBeforeFrontMatter(fileContent: string): string {
    const stripped = fileContent.replace(/^\uFEFF?(?:\s*<!--[\s\S]*?-->)*\s*/, '');
    return stripped !== fileContent && stripped.startsWith('---') ? stripped : fileContent;
  }

  /**
   * Many published skills (Claude Code style) ship a SKILL.md with no YAML
   * front-matter at all — it starts straight with `# Title` followed by a
   * blockquote/paragraph summary. For those, derive `name` from the first H1
   * (falling back to `options.fallbackName`) and `description` from the first
   * text block after it, so the manifest can still be validated.
   *
   * Only called when no front-matter block exists — a present block stays
   * authoritative (missing fields there are still reported as validation
   * errors). Genuinely empty bodies derive nothing and keep failing validation.
   */
  private deriveManifestWithoutFrontMatter(
    content: string,
    options?: ParseSkillMdOptions,
  ): Record<string, unknown> {
    // Tokenize with a real Markdown lexer instead of scanning lines, so fenced
    // and indented code, HTML blocks/comments (terminated or not), images and
    // badges are classified exactly as they render.
    let name: string | undefined;
    let description: string | undefined;
    // Text before the H1 (a language selector, …) is only a fallback.
    let preamble: string | undefined;

    const firstText = (tokens: Token[]): string | undefined => {
      for (const token of tokens) {
        if (token.type === 'paragraph' || token.type === 'text') {
          const text = inlineToPlainText((token as Tokens.Paragraph).tokens);
          if (text) return text;
        } else if (token.type === 'blockquote') {
          const text = firstText((token as Tokens.Blockquote).tokens);
          if (text) return text;
        } else if (token.type === 'list') {
          for (const item of (token as Tokens.List).items) {
            const text = firstText(item.tokens);
            if (text) return text;
          }
        }
      }
      return undefined;
    };

    for (const token of marked.lexer(content)) {
      if (token.type === 'heading') {
        if (!name && (token as Tokens.Heading).depth === 1) {
          name = inlineToPlainText((token as Tokens.Heading).tokens) || undefined;
        }
        continue;
      }
      const text = firstText([token]);
      if (!text) continue;
      if (name) {
        description = text;
        break;
      }
      preamble ??= text;
    }
    description ??= preamble;

    // Truncate by code point so an emoji at the boundary is never split into
    // an unpaired surrogate.
    const chars = description ? [...description] : [];
    if (chars.length > DERIVED_DESCRIPTION_MAX_LENGTH) {
      description =
        chars
          .slice(0, DERIVED_DESCRIPTION_MAX_LENGTH - 1)
          .join('')
          .trimEnd() + '…';
    }

    // Only fall back to the caller-supplied name when the body has real text,
    // so an empty SKILL.md is still rejected.
    if (!name && description) name = options?.fallbackName;

    return {
      ...(description && { description }),
      ...(name && { name }),
    };
  }

  /**
   * Validate manifest data
   */
  validateManifest(data: unknown): SkillManifest {
    const result = skillManifestSchema.safeParse(data);
    if (!result.success) {
      throw new SkillManifestError(
        'Invalid skill manifest: ' + result.error.issues.map((i) => i.message).join(', '),
        result.error,
      );
    }
    return result.data;
  }

  /**
   * Unzip Buffer using fflate
   */
  private unzipBuffer(buffer: Buffer): Promise<Record<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      fflateUnzip(new Uint8Array(buffer), (error, unzipped) => {
        if (error) reject(new SkillParseError('Failed to unzip buffer', error));
        else resolve(unzipped);
      });
    });
  }

  /**
   * Repack skill directory into a new ZIP
   * Creates a ZIP containing only SKILL.md and resources with normalized paths
   * Uses fixed mtime to ensure deterministic output (same content = same hash)
   */
  private repackSkillZip(skillMdContent: string, resources: Map<string, Buffer>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Use fixed timestamp (1980-01-01) for deterministic output
      // ZIP format requires dates in 1980-2099 range
      const fixedMtime = new Date('1980-01-01T00:00:00Z');

      // Use Zippable format with fixed mtime for deterministic output
      const files: Record<string, [Uint8Array, { mtime: Date }]> = {
        'SKILL.md': [new TextEncoder().encode(skillMdContent), { mtime: fixedMtime }],
      };

      // Add all resources with their relative paths (sorted for determinism)
      const sortedPaths = [...resources.keys()].sort();
      for (const path of sortedPaths) {
        files[path] = [new Uint8Array(resources.get(path)!), { mtime: fixedMtime }];
      }

      fflateZip(files, { level: 6 }, (error, data) => {
        if (error) reject(new SkillParseError('Failed to repack skill ZIP', error));
        else resolve(Buffer.from(data));
      });
    });
  }

  /**
   * Find SKILL.md file
   * Supports:
   * - Root directory: SKILL.md
   * - First-level subdirectory: skill-name/SKILL.md
   * - GitHub subdirectory with basePath: repo-branch/basePath/SKILL.md
   */
  private findSkillMd(
    unzipped: Record<string, Uint8Array>,
    basePath?: string,
  ): {
    skillMdContent: string;
    skillMdPath: string | null;
  } {
    const decoder = new TextDecoder();

    // If basePath is provided (GitHub subdirectory import), look in that specific path
    if (basePath) {
      // GitHub ZIP structure: {repo}-{branch}/path/to/SKILL.md
      // We need to find the root directory prefix first (e.g., "openclaw-main/")
      const allPaths = Object.keys(unzipped);
      const rootPrefix = this.findGitHubRootPrefix(allPaths);

      if (rootPrefix) {
        // Construct the full path: rootPrefix + basePath + /SKILL.md
        const normalizedBasePath = basePath.replaceAll(/^\/|\/$/g, ''); // Remove leading/trailing slashes
        const targetPath = `${rootPrefix}${normalizedBasePath}/SKILL.md`;

        if (unzipped[targetPath]) {
          return {
            skillMdContent: decoder.decode(unzipped[targetPath]),
            skillMdPath: targetPath,
          };
        }
      }

      // Fallback: try to find SKILL.md at <root>/<basePath>/SKILL.md, where <root>
      // is a single top-level directory segment (the GitHub "{repo}-{branch}/" prefix).
      //
      // NOTE: basePath is fully user-controlled (derived from the GitHub URL path). It must
      // NOT be interpolated into a `new RegExp(...)`, otherwise crafted paths like `(a+)+`
      // cause catastrophic backtracking (ReDoS, blocking the event loop) and `[invalid`
      // throws a SyntaxError. Use plain string matching instead, which is equivalent to the
      // old `^[^/]+/<basePath>/SKILL\.md$` pattern.
      const normalizedBasePath = basePath.replaceAll(/^\/|\/$/g, '');
      const suffix = `/${normalizedBasePath}/SKILL.md`;
      const matchWithBasePath = allPaths.find((path) => {
        if (!path.endsWith(suffix)) return false;
        // The part before the suffix must be a single non-empty segment (no slashes),
        // matching the `^[^/]+` anchor of the original pattern.
        const prefix = path.slice(0, -suffix.length);
        return prefix.length > 0 && !prefix.includes('/');
      });

      if (matchWithBasePath) {
        return {
          skillMdContent: decoder.decode(unzipped[matchWithBasePath]),
          skillMdPath: matchWithBasePath,
        };
      }

      // basePath was explicitly requested (GitHub subdirectory import) but no SKILL.md
      // exists there. Do NOT fall through to the generic root/first-level lookup below:
      // that would silently import an unrelated root skill (e.g. "repo-main/SKILL.md")
      // when the user asked for a specific subdirectory. Report "not found" instead.
      return { skillMdContent: '', skillMdPath: null };
    }

    // Check root directory first
    if (unzipped['SKILL.md']) {
      return {
        skillMdContent: decoder.decode(unzipped['SKILL.md']),
        skillMdPath: 'SKILL.md',
      };
    }

    // Check first-level subdirectory
    const skillMdPattern = /^[^/]+\/SKILL\.md$/;
    const match = Object.keys(unzipped).find((path) => skillMdPattern.test(path));

    if (match) {
      return {
        skillMdContent: decoder.decode(unzipped[match]),
        skillMdPath: match,
      };
    }

    return { skillMdContent: '', skillMdPath: null };
  }

  /**
   * Find the GitHub ZIP root prefix (e.g., "repo-branch/")
   * GitHub ZIPs have structure: {repo}-{branch}/...
   */
  private findGitHubRootPrefix(paths: string[]): string | null {
    // Find first directory-like path
    for (const path of paths) {
      const firstSlash = path.indexOf('/');
      if (firstSlash > 0) {
        return path.slice(0, firstSlash + 1);
      }
    }
    return null;
  }

  /**
   * Extract resource files
   * Excludes SKILL.md itself, directories, hidden files and __MACOSX
   */
  private extractResources(
    unzipped: Record<string, Uint8Array>,
    skillMdPath: string,
  ): Map<string, Buffer> {
    const resources = new Map<string, Buffer>();

    // Determine base path (if SKILL.md is in subdirectory)
    const basePath = skillMdPath.includes('/')
      ? skillMdPath.slice(0, skillMdPath.lastIndexOf('/') + 1)
      : '';

    for (const [path, data] of Object.entries(unzipped)) {
      // Skip directories, hidden files, __MACOSX and SKILL.md
      if (
        path.endsWith('/') ||
        path.startsWith('.') ||
        path.includes('__MACOSX') ||
        path === skillMdPath
      ) {
        continue;
      }

      // Skip files outside base path
      if (basePath && !path.startsWith(basePath)) continue;

      // Calculate relative path
      const relativePath = basePath ? path.slice(basePath.length) : path;

      // Skip empty paths
      if (!relativePath) continue;

      resources.set(relativePath, Buffer.from(data));
    }

    return resources;
  }
}
