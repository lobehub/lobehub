import {
  type ParsedSkill,
  type ParsedZipSkill,
  type SkillManifest,
  skillManifestSchema,
} from '@lobechat/types';
import { unzip as fflateUnzip, zip as fflateZip } from 'fflate';
import matter from 'gray-matter';
import { sha256 } from 'js-sha256';
import { readFile } from 'node:fs/promises';

import { SkillManifestError, SkillParseError } from './errors';

export interface ParseZipOptions {
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

export class SkillParser {
  /**
   * Parse SKILL.md file content
   * @param fileContent - Raw content of SKILL.md file
   * @returns Parsed manifest, content and raw content
   */
  parseSkillMd(fileContent: string): ParsedSkill {
    try {
      const { data, content } = matter(fileContent);
      const manifest = this.validateManifest(data);

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

      // Parse SKILL.md
      const { content, manifest } = this.parseSkillMd(skillMdContent);

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

      // Fallback: try to find SKILL.md that contains the basePath
      const basePathPattern = new RegExp(
        `^[^/]+/${basePath.replaceAll(/^\/|\/$/g, '')}/SKILL\\.md$`,
      );
      const matchWithBasePath = allPaths.find((path) => basePathPattern.test(path));

      if (matchWithBasePath) {
        return {
          skillMdContent: decoder.decode(unzipped[matchWithBasePath]),
          skillMdPath: matchWithBasePath,
        };
      }
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
