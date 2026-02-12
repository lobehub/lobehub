import { builtinSkills } from '@lobechat/builtin-skills';
import { type CommandResult, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type ExportFileResult,
  type SkillImportServiceResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import type { CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { SkillImporter } from '@/server/services/skill/importer';
import { SkillResourceService } from '@/server/services/skill/resource';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

class SkillServerRuntimeService implements SkillRuntimeService {
  private importer: SkillImporter;
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
    importer: SkillImporter;
    marketService: MarketService;
    resourceService: SkillResourceService;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.importer = options.importer;
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

  importFromGitHub = async (gitUrl: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromGitHub({ gitUrl });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromZipUrl = async (url: string): Promise<SkillImportServiceResult> => {
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
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
      let enhancedParams: any = {
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

      // Step 1: Generate pre-signed upload URL
      const uploadUrl = await s3.createPreSignedUrl(key);
      log('Generated upload URL for key: %s', key);

      // Step 2: Call sandbox's exportFile tool with the upload URL
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'exportFile' as CodeInterpreterToolName,
        { path, uploadUrl },
        { topicId: this.topicId, userId: this.userId },
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

      // Step 3: Get file metadata from S3
      const metadata = await s3.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

      // Step 4: Create persistent file record
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
        url, // This is the permanent /f:id URL
      };
    } catch (error) {
      log('Error exporting file: %O', error);
      return {
        filename,
        success: false,
      };
    }
  };
}

/**
 * Skills Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const skillsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skills execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skills execution');
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const resourceService = new SkillResourceService(context.serverDB, context.userId);
    const importer = new SkillImporter(context.serverDB, context.userId);
    const marketService = new MarketService({ userInfo: { userId: context.userId } });
    const fileService = new FileService(context.serverDB, context.userId);
    const fileModel = new FileModel(context.serverDB, context.userId);

    const service = new SkillServerRuntimeService({
      fileModel,
      fileService,
      importer,
      marketService,
      resourceService,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new SkillsExecutionRuntime({ builtinSkills, service });
  },
  identifier: SkillsIdentifier,
};
