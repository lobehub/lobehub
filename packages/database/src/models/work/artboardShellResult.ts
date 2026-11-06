import {
  parseArtboardResultLine,
  type RegisterArtboardWorkParams,
  type SkillToolResultWorkInput,
  type WorkItem,
} from '@lobechat/types';

import { ArtboardModel } from '../artboard';
import { registerArtboardWork } from './artboard';
import type { WorkContext } from './context';
import { parseShellCommandSegments } from './shellCommandParsing';

interface ShellRecord {
  command: string;
  exitCode?: number;
  output?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isArtboardCreate = (segment: string[]) =>
  segment.some(
    (token, index) =>
      token.split('/').at(-1) === 'lh' &&
      segment[index + 1] === 'artboard' &&
      segment[index + 2] === 'create',
  );

const idFromJson = (output: string) => {
  try {
    const parsed: unknown = JSON.parse(output);
    const artboard = isRecord(parsed) ? parsed.artboard : undefined;
    return isRecord(artboard) && typeof artboard.id === 'string' ? artboard.id : undefined;
  } catch {
    return undefined;
  }
};

export const parseArtboardShellCreate = (record: ShellRecord): { artboardId: string } | null => {
  if (record.exitCode !== undefined && record.exitCode !== 0) return null;
  const segments = parseShellCommandSegments(record.command);
  if (!segments?.some(isArtboardCreate) || !record.output) return null;

  const artboardId =
    parseArtboardResultLine(record.output)?.artboardId ?? idFromJson(record.output.trim());
  return artboardId ? { artboardId } : null;
};

const asShellRecord = (data: unknown): ShellRecord | undefined =>
  isRecord(data) && typeof data.command === 'string'
    ? {
        command: data.command,
        exitCode: typeof data.exitCode === 'number' ? data.exitCode : undefined,
        output: typeof data.output === 'string' ? data.output : undefined,
      }
    : undefined;

export const registerShellArtboardResult = async (
  ctx: WorkContext,
  params: SkillToolResultWorkInput & { toolIdentifier: string },
): Promise<WorkItem | null> => {
  const record = asShellRecord(params.data);
  const parsed = record && parseArtboardShellCreate(record);
  if (!parsed) return null;

  const board = await new ArtboardModel(ctx.db, ctx.userId, ctx.workspaceId).findById(
    parsed.artboardId,
  );
  if (!board) return null;

  const work: RegisterArtboardWorkParams = {
    agentId: params.agentId,
    artboardId: board.id,
    changeType: 'created',
    cumulativeCost: params.cumulativeCost,
    cumulativeUsage: params.cumulativeUsage,
    description: board.description,
    messageId: params.messageId,
    projectId: board.projectId,
    rootOperationId: params.rootOperationId,
    threadId: params.threadId,
    title: board.title,
    toolCallId: params.toolCallId,
    toolIdentifier: params.toolIdentifier,
    toolName: params.toolName,
    topicId: params.topicId,
  };
  return registerArtboardWork(ctx, work);
};
