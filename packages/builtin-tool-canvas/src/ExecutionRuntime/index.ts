import type { CanvasIssue } from '@lobechat/canvas';
import type { BuiltinServerRuntimeOutput, WorkRegistrationIntent } from '@lobechat/types';

import { buildCanvasGuide } from '../guide';
import {
  CanvasApiName,
  type CanvasReadOutcome,
  type CanvasSaveOutcome,
  type CanvasSummary,
  type CreateCanvasParams,
  type ReadCanvasParams,
  type UpdateCanvasParams,
} from '../types';

export interface CanvasToolService {
  create: (params: CreateCanvasParams) => Promise<CanvasSaveOutcome>;
  hasReadGuide: () => Promise<boolean>;
  list: () => Promise<CanvasSummary[]>;
  read: (params: ReadCanvasParams) => Promise<CanvasReadOutcome | undefined>;
  update: (params: UpdateCanvasParams) => Promise<CanvasSaveOutcome>;
}

interface CanvasRuntimeContext {
  onWorkRegistration?: (intent: WorkRegistrationIntent) => void;
}

const GUIDE_REQUIRED = `Call ${CanvasApiName.readCanvasGuide} first: it lists the components and rules a Canvas must follow. Then call this again.`;

const formatIssues = (issues: CanvasIssue[]) =>
  issues
    .map((issue) => {
      const location = issue.file
        ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
        : 'project';
      return `- ${location} [${issue.rule}] ${issue.message}`;
    })
    .join('\n');

export class CanvasExecutionRuntime {
  private service: CanvasToolService;

  constructor(service: CanvasToolService) {
    this.service = service;
  }

  async readCanvasGuide(): Promise<BuiltinServerRuntimeOutput> {
    return { content: buildCanvasGuide(), state: { guideRead: true }, success: true };
  }

  async createCanvas(
    params: CreateCanvasParams,
    context?: CanvasRuntimeContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!(await this.service.hasReadGuide())) return { content: GUIDE_REQUIRED, success: false };
    return this.finishSave(CanvasApiName.createCanvas, await this.service.create(params), context);
  }

  async updateCanvas(
    params: UpdateCanvasParams,
    context?: CanvasRuntimeContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!(await this.service.hasReadGuide())) return { content: GUIDE_REQUIRED, success: false };
    return this.finishSave(CanvasApiName.updateCanvas, await this.service.update(params), context);
  }

  async readCanvas(params: ReadCanvasParams): Promise<BuiltinServerRuntimeOutput> {
    const canvas = await this.service.read(params);
    if (!canvas) {
      return {
        content: `Canvas "${params.canvasId}" was not found. Call ${CanvasApiName.listCanvases} to see the available ones.`,
        success: false,
      };
    }

    const listing = canvas.files.map((file) => `- ${file.path} (${file.size} bytes)`).join('\n');
    const texts = canvas.texts
      .map((file) => `<file path="${file.path}">\n${file.content}\n</file>`)
      .join('\n\n');

    return {
      content:
        `Canvas ${canvas.canvasId}: ${canvas.title ?? 'Untitled'}\n\nFiles:\n${listing}\n\n${texts}`.trim(),
      state: { canvasId: canvas.canvasId, files: canvas.files },
      success: true,
    };
  }

  async listCanvases(): Promise<BuiltinServerRuntimeOutput> {
    const canvases = await this.service.list();
    if (canvases.length === 0)
      return { content: 'No canvases yet.', state: { canvases }, success: true };

    return {
      content: canvases
        .map(
          (canvas) =>
            `- ${canvas.canvasId}: ${canvas.title ?? 'Untitled'}${canvas.description ? ` — ${canvas.description}` : ''} (updated ${canvas.updatedAt})`,
        )
        .join('\n'),
      state: { canvases },
      success: true,
    };
  }

  private finishSave(
    toolName: string,
    outcome: CanvasSaveOutcome,
    context?: CanvasRuntimeContext,
  ): BuiltinServerRuntimeOutput {
    if (!outcome.ok) {
      const details = outcome.issues.length > 0 ? `\n${formatIssues(outcome.issues)}` : '';
      return {
        content: `The canvas was not saved.${outcome.error ? ` ${outcome.error}` : ''}${details}\nFix these and save again; the previous version is unchanged.`,
        state: { issues: outcome.issues },
        success: false,
      };
    }

    context?.onWorkRegistration?.({
      action: 'register',
      canvas: {
        canvasId: outcome.canvasId,
        description: outcome.description,
        metadata: outcome.metadata,
        title: outcome.title,
        toolName,
      },
      type: 'canvas',
    });

    return {
      content: `Saved canvas ${outcome.canvasId} "${outcome.title}" (${outcome.metadata.fileCount} files). The user sees it as a card under your reply. Use updateCanvas with canvasId "${outcome.canvasId}" for changes.`,
      state: { canvasId: outcome.canvasId, metadata: outcome.metadata, title: outcome.title },
      success: true,
    };
  }
}
