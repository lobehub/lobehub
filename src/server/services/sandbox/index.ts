import {
  type ISandboxService,
  type SandboxCallToolResult,
  type SandboxExportFileResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { type CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { FileS3 } from '@/server/modules/S3';
import { type FileService } from '@/server/services/file';
import { type MarketService } from '@/server/services/market';

const log = debug('lobe-server:sandbox-service');

export interface ServerSandboxServiceOptions {
  fileService: FileService;
  keyVaults?: Record<string, any>;
  marketService: MarketService;
  topicId: string;
  userId: string;
}

/**
 * Server-side Sandbox Service
 *
 * This service implements ISandboxService for server-side execution.
 * Context (topicId, userId) is bound at construction time.
 * It uses MarketService to call sandbox tools.
 *
 * Usage:
 * - Used by BuiltinToolsExecutor when executing CloudSandbox tools on server
 * - MarketService handles authentication via trustedClientToken
 */
export class ServerSandboxService implements ISandboxService {
  private fileService: FileService;
  private keyVaults: Record<string, any>;
  private marketService: MarketService;
  private topicId: string;
  private userId: string;

  constructor(options: ServerSandboxServiceOptions) {
    this.fileService = options.fileService;
    this.keyVaults = options.keyVaults || {};
    this.marketService = options.marketService;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  /**
   * Call a sandbox tool via MarketService
   */
  async callTool(toolName: string, params: Record<string, any>): Promise<SandboxCallToolResult> {
    const {
      injectedEnvCount,
      missingCredentialEnvNames,
      params: resolvedParams,
    } = this.resolveToolParams(toolName, params);

    log(
      'Calling sandbox tool: %s with params: %O, topicId: %s',
      toolName,
      this.sanitizeToolParamsForLog(toolName, resolvedParams, injectedEnvCount),
      this.topicId,
    );

    if (toolName === 'runCommand' && missingCredentialEnvNames.length > 0) {
      const guidance = this.buildMissingCredentialGuidance(missingCredentialEnvNames);

      return {
        error: {
          message:
            `Missing required credential environment variables: ${missingCredentialEnvNames.join(', ')}. ` +
            `Please store them in keyVaults first via Credentials tool (prefer service-based paths):\n${guidance}`,
          name: 'MissingCredentialEnv',
        },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }

    try {
      const response = await this.marketService
        .getSDK()
        .plugins.runBuildInTool(toolName as CodeInterpreterToolName, resolvedParams as any, {
          topicId: this.topicId,
          userId: this.userId,
        });

      if (toolName === 'runCommand') {
        log(
          'Sandbox runCommand response: success=%s, sessionExpiredAndRecreated=%s',
          response.success,
          response.data?.sessionExpiredAndRecreated || false,
        );
      } else {
        log('Sandbox tool %s response: %O', toolName, response);
      }

      if (!response.success) {
        return {
          error: {
            message: response.error?.message || 'Unknown error',
            name: response.error?.code,
          },
          result: null,
          sessionExpiredAndRecreated: false,
          success: false,
        };
      }

      return {
        result: response.data?.result,
        sessionExpiredAndRecreated: response.data?.sessionExpiredAndRecreated || false,
        success: true,
      };
    } catch (error) {
      log('Error calling sandbox tool %s: %O', toolName, error);

      return {
        error: {
          message: (error as Error).message,
          name: (error as Error).name,
        },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }
  }

  private resolveToolParams(toolName: string, params: Record<string, any>) {
    if (toolName !== 'runCommand') {
      return { injectedEnvCount: 0, missingCredentialEnvNames: [], params };
    }

    const command = typeof params.command === 'string' ? params.command : '';
    if (!command) {
      return { injectedEnvCount: 0, missingCredentialEnvNames: [], params };
    }

    const candidateEnvMap = this.extractCommandEnvCandidates(this.keyVaults);
    const referencedEnvNames = this.extractReferencedEnvNames(command);

    const selectedEnvMap: Record<string, string> = {};
    const missingCredentialEnvNames: string[] = [];

    for (const name of referencedEnvNames) {
      const value = candidateEnvMap[name];
      if (typeof value === 'string' && value.length > 0) {
        selectedEnvMap[name] = value;
      } else if (this.isCredentialEnvName(name)) {
        missingCredentialEnvNames.push(name);
      }
    }

    const selectedKeys = Object.keys(selectedEnvMap);
    if (selectedKeys.length === 0) {
      return { injectedEnvCount: 0, missingCredentialEnvNames, params };
    }

    return {
      injectedEnvCount: selectedKeys.length,
      missingCredentialEnvNames,
      params: {
        ...params,
        command: this.injectCommandEnv(command, selectedEnvMap),
      },
    };
  }

  private sanitizeToolParamsForLog(
    toolName: string,
    params: Record<string, any>,
    injectedEnvCount: number,
  ) {
    if (toolName !== 'runCommand') return params;

    const command = typeof params.command === 'string' ? params.command : '';

    return {
      ...params,
      command: command ? '[REDACTED_COMMAND]' : command,
      commandLength: command.length,
      injectedEnvCount,
    };
  }

  private injectCommandEnv(command: string, envMap: Record<string, string>): string {
    const exports = Object.entries(envMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `export ${name}=${this.shellQuote(value)};`)
      .join(' ');

    if (!exports) return command;

    return `${exports} ${command}`;
  }

  private shellQuote(value: string) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private extractReferencedEnvNames(command: string): Set<string> {
    const names = new Set<string>();

    for (const match of command.matchAll(/\$\{[A-Z_]\w*\}/gi)) {
      names.add(match[0].slice(2, -1));
    }

    for (const match of command.matchAll(/\$[A-Z_]\w*/gi)) {
      names.add(match[0].slice(1));
    }

    return names;
  }

  private isCredentialEnvName(name: string): boolean {
    return /KEY|TOKEN|SECRET|PASSWORD|ACCESS/i.test(name);
  }

  private buildMissingCredentialGuidance(envNames: string[]) {
    return envNames
      .map((envName) => {
        const servicePath = this.inferServiceCredentialPath(envName);

        if (!servicePath) {
          return `- ${envName}: setCredential(path="sandboxEnv.${envName}", value="...")`;
        }

        return (
          `- ${envName}: setCredential(path="${servicePath}", value="...") (recommended)\n` +
          `  compatibility: setCredential(path="sandboxEnv.${envName}", value="...")`
        );
      })
      .join('\n');
  }

  private inferServiceCredentialPath(envName: string): string | undefined {
    const segments = envName
      .split('_')
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);

    if (segments.length < 2) return undefined;

    const service = segments[0];
    const field = this.toCredentialPathField(segments.slice(1));

    if (!service || !field) return undefined;

    return `${service}.${field}`;
  }

  private toCredentialPathField(tokens: string[]): string {
    if (tokens.length === 0) return '';

    const [first, ...rest] = tokens;
    const tail = rest.map((token) =>
      token === 'url' ? 'URL' : `${token[0].toUpperCase()}${token.slice(1)}`,
    );

    const value = `${first}${tail.join('')}`;
    return value.endsWith('Url') ? `${value.slice(0, -3)}URL` : value;
  }

  private extractCommandEnvCandidates(keyVaults: Record<string, any>): Record<string, string> {
    const flattened = this.flattenStringLeavesToEnvMap(keyVaults);
    const explicit = this.extractExplicitSandboxEnvMap(keyVaults);

    return {
      ...flattened,
      ...explicit,
    };
  }

  private extractExplicitSandboxEnvMap(keyVaults: Record<string, any>): Record<string, string> {
    const candidates = [
      keyVaults?.sandboxEnv,
      keyVaults?.sandbox?.env,
      keyVaults?.cloudSandboxEnv,
      keyVaults?.cloudSandbox?.env,
    ];

    const map: Record<string, string> = {};

    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;

      for (const [key, value] of Object.entries(item)) {
        if (typeof value !== 'string' || value.length === 0) continue;

        const envName = this.toEnvToken(key);
        if (!envName) continue;

        map[envName] = value;
      }
    }

    return map;
  }

  private flattenStringLeavesToEnvMap(input: Record<string, any>): Record<string, string> {
    const map: Record<string, string> = {};

    const walk = (value: unknown, path: string[]) => {
      if (typeof value === 'string') {
        if (value.length === 0 || path.length === 0) return;

        const envName = path
          .map((p) => this.toEnvToken(p))
          .filter(Boolean)
          .join('_');
        if (!envName) return;

        map[envName] = value;
        return;
      }

      if (!value || typeof value !== 'object' || Array.isArray(value)) return;

      for (const [nextKey, nextValue] of Object.entries(value as Record<string, unknown>)) {
        walk(nextValue, [...path, nextKey]);
      }
    };

    walk(input, []);

    return map;
  }

  private toEnvToken(segment: string): string {
    if (!segment) return '';

    return segment
      .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replaceAll(/[^A-Z0-9]/gi, '_')
      .replaceAll(/_+/g, '_')
      .replaceAll(/^_|_$/g, '')
      .toUpperCase();
  }

  /**
   * Export and upload a file from sandbox to S3
   *
   * Steps:
   * 1. Generate S3 pre-signed upload URL
   * 2. Call sandbox exportFile tool to upload file
   * 3. Verify upload success and get metadata
   * 4. Create persistent file record
   */
  async exportAndUploadFile(path: string, filename: string): Promise<SandboxExportFileResult> {
    log('Exporting file: %s from path: %s, topicId: %s', filename, path, this.topicId);

    try {
      const s3 = new FileS3();

      // Use date-based sharding for privacy compliance (GDPR, CCPA)
      const today = new Date().toISOString().split('T')[0];

      // Generate a unique key for the exported file
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      // Step 1: Generate pre-signed upload URL
      const uploadUrl = await s3.createPreSignedUrl(key);
      log('Generated upload URL for key: %s', key);

      // Step 2: Call sandbox's exportFile tool with the upload URL
      const response = await this.marketService.exportFile({
        path,
        topicId: this.topicId,
        uploadUrl,
        userId: this.userId,
      });

      log('Sandbox exportFile response: %O', response);

      if (!response.success) {
        return {
          error: { message: response.error?.message || 'Failed to export file from sandbox' },
          filename,
          success: false,
        };
      }

      const result = response.data?.result;
      const uploadSuccess = result?.success !== false;

      if (!uploadSuccess) {
        return {
          error: { message: result?.error || 'Failed to upload file from sandbox' },
          filename,
          success: false,
        };
      }

      // Step 3: Get file metadata from S3 to verify upload and get actual size
      const metadata = await s3.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

      // Step 4: Create persistent file record using FileService
      // Generate a simple hash from the key (since we don't have the actual file content)
      const fileHash = sha256(key + Date.now().toString());

      const { fileId, url } = await this.fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: filename,
        size: fileSize,
        url: key, // Store S3 key
      });

      log('Created file record: fileId=%s, url=%s', fileId, url);

      return {
        fileId,
        filename,
        mimeType,
        size: fileSize,
        success: true,
        url, // This is the permanent /f/:id URL
      };
    } catch (error) {
      log('Error exporting file: %O', error);

      return {
        error: { message: (error as Error).message },
        filename,
        success: false,
      };
    }
  }
}
