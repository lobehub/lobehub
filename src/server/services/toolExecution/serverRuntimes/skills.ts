import { builtinSkills } from '@lobechat/builtin-skills';
import { type CommandResult, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type ExportFileResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import type { CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import { fileEnv } from '@/envs/file';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { SkillResourceService } from '@/server/services/skill/resource';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

class SkillServerRuntimeService implements SkillRuntimeService {
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private marketService: MarketService;
  private fileService: FileService;
  private fileModel: FileModel;
  private topicId?: string;
  private userId: string;

  constructor(options: {
    fileModel: FileModel;
    fileService: FileService;
    marketService: MarketService;
    resourceService: SkillResourceService;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.marketService = options.marketService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  findAll = (): Promise<{ data: SkillListItem[]; total: number }> => {
    return this.skillModel.findAll();
  };

  findById = (id: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findById(id);
  };

  findByName = (name: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findByName(name);
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
  };

  runCommand = async (options: { command: string }): Promise<CommandResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for runCommand');
    }

    // Preprocess lh commands: rewrite to npx @lobehub/cli + inject auth env vars
    const lhResult = await preprocessLhCommand(options.command, this.userId);
    if (lhResult.error) {
      return { exitCode: 1, output: '', stderr: lhResult.error, success: false };
    }

    try {
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'runCommand' as any,
        { command: lhResult.command },
        { topicId: this.topicId, userId: this.userId },
      );

      log('runCommand response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error running command: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  execScript = async (
    command: string,
    options: {
      config?: { description?: string; id?: string; name?: string };
      description: string;
      runInClient?: boolean;
    },
  ): Promise<CommandResult> => {
    const { config, description } = options;

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      // Look up skill zipUrl if config is provided (same logic as market.ts)
      const enhancedParams: any = {
        command,
        config,
        description,
      };

      if (config?.name) {
        const skill = await this.skillModel.findByName(config.name);

        // If skill not found, return error with available skills
        if (!skill) {
          const allSkills = await this.skillModel.findAll();
          const availableSkills = allSkills.data.map((s) => s.name).join(', ');

          const errorMessage = availableSkills
            ? `Skill "${config.name}" not found. Available skills: ${availableSkills}`
            : `Skill "${config.name}" not found. No skills available. Please import a skill first.`;

          log('Skill not found: %s. Available skills: %s', config.name, availableSkills);

          return {
            exitCode: 1,
            output: '',
            stderr: errorMessage,
            success: false,
          };
        }

        if (skill.zipFileHash) {
          // Get S3 key from globalFiles
          const fileInfo = await this.fileModel.checkHash(skill.zipFileHash);

          if (fileInfo.isExist && fileInfo.url) {
            // Convert S3 key to full URL
            const fullUrl = await this.fileService.getFullFileUrl(fileInfo.url);
            if (fullUrl) {
              enhancedParams.zipUrl = fullUrl;
              log('Added zipUrl to execScript params for skill %s: %s', skill.name, fullUrl);
            }
          }
        }
      }

      // Call market-sdk's runBuildInTool
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'execScript' as CodeInterpreterToolName,
        enhancedParams,
        { topicId: this.topicId, userId: this.userId },
      );

      log('execScript response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error executing script: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  exportFile = async (path: string, filename: string): Promise<ExportFileResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for exportFile');
    }

    try {
      const s3 = new FileS3();

      // Use date-based sharding (same as market.ts)
      const today = new Date().toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      // Infer Content-Type from filename
      const contentType = mime.getType(filename) || 'application/octet-stream';

      // Check if curl mode is enabled
      if (fileEnv.S3_EXPORT_CURL_MODE) {
        return await this.exportViaCurl(s3, key, path, filename, contentType);
      }

      // Default: use sandbox's exportFile tool
      return await this.exportViaTool(s3, key, path, filename, contentType);
    } catch (error) {
      log('Error exporting file: %O', error);
      return {
        filename,
        success: false,
      };
    }
  };

  /**
   * Export file using sandbox's built-in exportFile tool
   */
  private async exportViaTool(
    s3: FileS3,
    key: string,
    path: string,
    filename: string,
    contentType: string,
  ): Promise<ExportFileResult> {
    // Step 1: Generate pre-signed upload URL
    const uploadUrl = await s3.createPreSignedUrl(key);
    log('Generated upload URL for key: %s', key);

    // Step 2: Call sandbox's exportFile tool with the upload URL
    const market = this.marketService.market;
    const response = await market.plugins.runBuildInTool(
      'exportFile' as CodeInterpreterToolName,
      { path, uploadUrl: uploadUrl! },
      { topicId: this.topicId!, userId: this.userId },
    );

    log('Sandbox exportFile response: %O', response);

    if (!response.success) {
      return {
        filename,
        success: false,
      };
    }

    const result = response.data?.result;
    const uploadSuccess = result?.success !== false;

    if (!uploadSuccess) {
      return {
        filename,
        success: false,
      };
    }

    return await this.createFileRecord(s3, key, filename, contentType, result?.mimeType);
  }

  /**
   * Export file using curl command (compatibility mode for S3 providers with signature issues)
   */
  private async exportViaCurl(
    s3: FileS3,
    key: string,
    path: string,
    filename: string,
    contentType: string,
  ): Promise<ExportFileResult> {
    const market = this.marketService.market;

    // Step 1: Verify file exists
    const statResponse = await market.plugins.runBuildInTool(
      'runCommand' as CodeInterpreterToolName,
      {
        command: `stat -c%s "${path}" 2>&1`,
        timeout: 5000,
      } as any,
      { topicId: this.topicId!, userId: this.userId },
    );

    const statOutput = statResponse.data?.result?.stdout?.trim();

    if (!statResponse.success || !statOutput) {
      return {
        error: { message: `File not found: ${path}` },
        filename,
        success: false,
      };
    }

    const fileSize = parseInt(statOutput, 10);

    if (fileSize === 0) {
      return {
        error: { message: 'File is empty (0 bytes)' },
        filename,
        success: false,
      };
    }

    // Step 2: Generate pre-signed upload URL
    const uploadUrl = await s3.createPreSignedUrl(key, contentType);

    // Step 3: Use curl to upload file to S3
    const curlCommand = `curl -X PUT "${uploadUrl}" -H "Content-Type: ${contentType}" --data-binary @${path}`;

    const response = await market.plugins.runBuildInTool(
      'runCommand' as CodeInterpreterToolName,
      {
        command: curlCommand,
        timeout: 60000,
      } as any,
      { topicId: this.topicId!, userId: this.userId },
    );

    if (!response.success) {
      return {
        error: { message: response.error?.message || 'Failed to upload file via curl' },
        filename,
        success: false,
      };
    }

    // Check if curl actually succeeded (exit code 0)
    const curlExitCode = response.data?.result?.exitCode;
    if (curlExitCode !== 0 && curlExitCode !== undefined) {
      return {
        error: {
          message: `curl failed with exit code ${curlExitCode}: ${response.data?.result?.stdout || 'unknown error'}`,
        },
        filename,
        success: false,
      };
    }

    // Step 4: Create file record
    return await this.createFileRecord(s3, key, filename, contentType);
  }

  /**
   * Create file record after successful upload
   */
  private async createFileRecord(
    s3: FileS3,
    key: string,
    filename: string,
    contentType: string,
    resultMimeType?: string,
  ): Promise<ExportFileResult> {
    const metadata = await s3.getFileMetadata(key);
    const fileSize = metadata.contentLength;
    const mimeType = metadata.contentType || resultMimeType || contentType;

    const fileHash = sha256(key + Date.now().toString());

    const { fileId, url } = await this.fileService.createFileRecord({
      fileHash,
      fileType: mimeType,
      name: filename,
      size: fileSize,
      url: key,
    });

    return {
      fileId,
      filename,
      mimeType,
      size: fileSize,
      success: true,
      url,
    };
  }
}

/**
 * Skills Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const skillsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skills execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skills execution');
    }

    // Fetch market access token from user settings
    let marketAccessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const userSettings = await userModel.getUserSettings();
      marketAccessToken = (userSettings?.market as any)?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const resourceService = new SkillResourceService(context.serverDB, context.userId);
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId);
    const fileModel = new FileModel(context.serverDB, context.userId);

    const service = new SkillServerRuntimeService({
      fileModel,
      fileService,
      marketService,
      resourceService,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new SkillsExecutionRuntime({
      builtinSkills: filterBuiltinSkills(builtinSkills),
      service,
    });
  },
  identifier: SkillsIdentifier,
};
