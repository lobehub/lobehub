import { type CanvasIssue, isCanvasTextPath, normalizeCanvasPath } from '@lobechat/canvas';
import {
  formatTextWindowAttributes,
  formatTextWindowNotice,
  sliceTextWindow,
  type TextWindow,
} from '@lobechat/prompts/textWindow';
import { DEFAULT_TOOL_RESULT_MAX_LENGTH } from '@lobechat/prompts/toolResult';
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

/**
 * Characters of a readCanvas result held back for separators and the "not read" / "not found"
 * notes. File contents share the rest of the default tool-result limit, so the runtime never cuts
 * a readCanvas result and sends the model to a tool-result archive it may not be able to open.
 */
const READ_RESERVED_CHARS = 2000;

/**
 * A file that does not fit whole is windowed only when at least this many characters are left.
 * Otherwise it is left for a call of its own, where it gets the whole budget.
 */
const MIN_READ_WINDOW_CHARS = 2000;

/** Upper bound on a file block's tags, window attributes and paging notice, minus the path. */
const fileBlockOverhead = (path: string) => 400 + path.length * 2;

/** A positive whole line number, or undefined. Some providers send numbers as strings. */
const toLineNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 1) return;
  return Math.floor(parsed);
};

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
    const header = `Canvas ${canvas.canvasId}: ${canvas.title ?? 'Untitled'}\n\nFiles:\n${listing}`;
    const budget = DEFAULT_TOOL_RESULT_MAX_LENGTH - READ_RESERVED_CHARS - header.length;

    return {
      content: [header, ...this.formatCanvasTexts(canvas, params, budget)].join('\n\n').trim(),
      state: { canvasId: canvas.canvasId, files: canvas.files },
      success: true,
    };
  }

  /**
   * Fits the requested text files into one tool result with the shared text-window contract (the
   * one readDocument and readKnowledge use). Files that fit whole come back whole, in project
   * order. A file that does not fit gets one window of whole lines that ends with the exact
   * readCanvas call for the next window, and a file left over once the result is full is named
   * with the call that reads it on its own. A single file always gets a window, so following
   * those instructions always makes progress.
   */
  private formatCanvasTexts(
    canvas: CanvasReadOutcome,
    params: ReadCanvasParams,
    budget: number,
  ): string[] {
    const offset = toLineNumber(params.offset);
    const limit = toLineNumber(params.limit);

    const readCall = (path: string, line?: number) =>
      `call ${CanvasApiName.readCanvas} again with ${JSON.stringify({
        canvasId: canvas.canvasId,
        paths: [path],
        ...(limit !== undefined && { limit }),
        ...(line !== undefined && line > 1 && { offset: line }),
      })}`;

    const fileBlock = (path: string, window: TextWindow) => {
      const whole = window.startLine === 1 && !window.truncated;
      const attributes = whole ? '' : formatTextWindowAttributes(window);
      const block = `<file path="${path}"${attributes}>\n${window.content}\n</file>`;
      const notice = formatTextWindowNotice(window, {
        continueFrom: (line) => readCall(path, line),
        // A line cut here can still be read whole by a call that reads only this file.
        continueMaxChars: budget - fileBlockOverhead(path),
      });
      return notice ? `${block}\n${notice}` : block;
    };

    const blocks: (string | undefined)[] = [];
    const pending: number[] = [];
    let remaining = budget;

    // Pass 1: every file (or its offset/limit window) that fits whole, in project order.
    for (const [index, { content, path }] of canvas.texts.entries()) {
      const block = fileBlock(path, sliceTextWindow(content, { maxLines: limit, offset }));
      if (block.length + 2 > remaining) {
        pending.push(index);
        continue;
      }
      blocks[index] = block;
      remaining -= block.length + 2;
    }

    // Pass 2: the larger files share what is left, one window each while it lasts.
    const deferred: { chars: number; path: string }[] = [];
    for (const index of pending) {
      const { content, path } = canvas.texts[index];
      const maxChars = remaining - fileBlockOverhead(path);
      if (maxChars < MIN_READ_WINDOW_CHARS) {
        deferred.push({ chars: content.length, path });
        continue;
      }
      const block = fileBlock(
        path,
        sliceTextWindow(content, { maxChars, maxLines: limit, offset }),
      );
      blocks[index] = block;
      remaining -= block.length + 2;
    }

    const notes: string[] = [];
    if (deferred.length > 0) {
      const sizes = deferred.map(({ chars, path }) => `${path} (${chars} characters)`).join(', ');
      notes.push(
        `[This response is full, so these files were not read: ${sizes}. Read each one on its own, e.g. ${readCall(deferred[0].path, offset)}.]`,
      );
    }

    if (params.paths) {
      const read = new Set(canvas.texts.map((file) => file.path));
      const listed = new Set(canvas.files.map((file) => file.path));
      const problems = [...new Set(params.paths.map((path) => normalizeCanvasPath(path) ?? path))]
        .filter((path) => !read.has(path))
        .map((path) => {
          if (!listed.has(path)) return `${path} does not exist in this canvas`;
          if (!isCanvasTextPath(path))
            return `${path} is a binary file, so only its size is listed`;
          return `${path} could not be loaded`;
        });
      if (problems.length > 0) notes.push(`[${problems.join('; ')}.]`);
    }

    return [...blocks.filter((block): block is string => block !== undefined), ...notes];
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
