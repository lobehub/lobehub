import { type LobeChatDatabase } from '@lobechat/database';
import {
  type SkillResourceContent,
  type SkillResourceMeta,
  type SkillResourceTreeNode,
} from '@lobechat/types';
import { getMimeType } from '@lobechat/utils';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileService } from '@/server/services/file';

import { SkillResourceError } from './errors';

const log = debug('lobe-chat:service:skill-resource');

function isTextMimeType(mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  const textApplicationTypes = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/xhtml+xml',
    'application/x-yaml',
    'application/x-sh',
  ];
  return textApplicationTypes.includes(mimeType);
}

export class SkillResourceService {
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.fileService = new FileService(db, userId);
  }

  /**
   * Store resource files to S3/globalFiles
   * Uses zipHash as path prefix for deduplication
   * Only creates globalFiles records (no user files)
   *
   * @param zipHash - ZIP package hash for deduplication
   * @param resources - Resource file mapping Map<VirtualPath, Buffer>
   * @returns Record<VirtualPath, SkillResourceMeta> mapping
   */
  async storeResources(
    zipHash: string,
    resources: Map<string, Buffer>,
  ): Promise<Record<string, SkillResourceMeta>> {
    log('storeResources: starting with zipHash=%s, resourceCount=%d', zipHash, resources.size);
    const result: Record<string, SkillResourceMeta> = {};

    for (const [virtualPath, buffer] of resources) {
      log('storeResources: storing resource path=%s, size=%d bytes', virtualPath, buffer.length);
      const fileHash = await this.storeResource(zipHash, virtualPath, buffer);
      result[virtualPath] = { fileHash, size: buffer.length };
      log('storeResources: stored resource path=%s, fileHash=%s', virtualPath, fileHash);
    }

    log('storeResources: completed, stored %d resources', Object.keys(result).length);
    return result;
  }

  /**
   * Read resource file content by hash
   *
   * @param resources - Record<VirtualPath, SkillResourceMeta> mapping
   * @param virtualPath - Virtual path to read
   */
  async readResource(
    resources: Record<string, SkillResourceMeta>,
    virtualPath: string,
  ): Promise<SkillResourceContent> {
    log('readResource: reading path=%s, availablePaths=%o', virtualPath, Object.keys(resources));
    const meta = resources[virtualPath];
    if (!meta) {
      log('readResource: resource not found in mapping, path=%s', virtualPath);
      throw new SkillResourceError(`Resource not found: ${virtualPath}`);
    }
    log('readResource: found fileHash=%s', meta.fileHash);

    const fileType = getMimeType(virtualPath);

    if (isTextMimeType(fileType)) {
      const content = await this.fileService.getFileContentByHash(meta.fileHash);
      log('readResource: fetched text content length=%d, fileType=%s', content.length, fileType);

      return {
        content,
        encoding: 'utf-8',
        fileHash: meta.fileHash,
        fileType,
        path: virtualPath,
        size: Buffer.byteLength(content, 'utf-8'),
      };
    }

    const bytes = await this.fileService.getFileByteArrayByHash(meta.fileHash);
    const content = Buffer.from(bytes).toString('base64');
    log('readResource: fetched binary content size=%d, fileType=%s', bytes.length, fileType);

    return {
      content,
      encoding: 'base64',
      fileHash: meta.fileHash,
      fileType,
      path: virtualPath,
      size: bytes.length,
    };
  }

  /**
   * Build resource directory tree structure
   * When includeContent is true, also fetches text file contents (binary files are skipped)
   */
  async listResources(
    resources: Record<string, SkillResourceMeta>,
    includeContent?: boolean,
  ): Promise<SkillResourceTreeNode[]> {
    const paths = Object.keys(resources);
    log(
      'listResources: building tree for %d paths, includeContent=%s',
      paths.length,
      includeContent,
    );
    const tree = this.buildTree(paths);
    log('listResources: built tree with %d root nodes', tree.length);

    if (includeContent) {
      await this.populateContent(tree, resources);
    }

    return tree;
  }

  // ===== Content Population =====

  /**
   * Recursively populate text file content into tree nodes
   */
  private async populateContent(
    nodes: SkillResourceTreeNode[],
    resources: Record<string, SkillResourceMeta>,
  ): Promise<void> {
    const fileNodes: SkillResourceTreeNode[] = [];
    const collectFiles = (items: SkillResourceTreeNode[]) => {
      for (const node of items) {
        if (node.type === 'file') {
          fileNodes.push(node);
        } else if (node.children) {
          collectFiles(node.children);
        }
      }
    };
    collectFiles(nodes);

    await Promise.all(
      fileNodes.map(async (node) => {
        const meta = resources[node.path];
        if (!meta) return;

        const mimeType = getMimeType(node.path);
        if (!isTextMimeType(mimeType)) return;

        try {
          node.content = await this.fileService.getFileContentByHash(meta.fileHash);
        } catch (error) {
          log('populateContent: failed to read content for %s: %o', node.path, error);
        }
      }),
    );
  }

  // ===== Private Methods =====

  private async storeResource(
    zipHash: string,
    virtualPath: string,
    buffer: Buffer,
  ): Promise<string> {
    // Use zipHash as path prefix, same ZIP resources share same path
    const key = `skills/source_files/${zipHash}/${virtualPath}`;
    log('storeResource: uploading to key=%s', key);

    // Determine content type from file extension
    const fileType = getMimeType(virtualPath);

    // Upload to S3 with proper content type (supports any file type, not just images)
    await this.fileService.uploadBuffer(key, buffer, fileType);
    log('storeResource: uploaded to S3 with contentType=%s', fileType);

    // Create globalFiles record only (no user files)
    const fileHash = sha256(buffer);
    log('storeResource: creating global file record hash=%s, type=%s', fileHash, fileType);

    // Extract filename and dirname from key (actual storage path)
    const lastSlash = key.lastIndexOf('/');
    const filename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
    const dirname = lastSlash >= 0 ? key.slice(0, lastSlash) : '';

    await this.fileService.createGlobalFile({
      fileHash,
      fileType,
      metadata: { dirname, filename, path: key },
      size: buffer.length,
      url: key,
    });

    log('storeResource: created global file record fileHash=%s', fileHash);
    return fileHash;
  }

  private buildTree(paths: string[]): SkillResourceTreeNode[] {
    const root: SkillResourceTreeNode[] = [];
    const nodeMap = new Map<string, SkillResourceTreeNode>();

    for (const path of [...paths].sort()) {
      const parts = path.split('/');
      let currentPath = '';
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let node = nodeMap.get(currentPath);
        if (!node) {
          node = {
            children: isFile ? undefined : [],
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
          };
          nodeMap.set(currentPath, node);
          currentLevel.push(node);
        }

        if (!isFile && node.children) {
          currentLevel = node.children;
        }
      }
    }

    return root;
  }
}
