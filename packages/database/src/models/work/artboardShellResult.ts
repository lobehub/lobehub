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

const CLI_NAMES = new Set(['lh', 'lobe', 'lobehub']);
const CLI_VARIABLE = /^\$\{?LOBEHUB_CLI\b/;

const isCli = (token: string) =>
  CLI_VARIABLE.test(token) || CLI_NAMES.has(token.split('/').at(-1)!);

type ArtboardShellChange = Pick<RegisterArtboardWorkParams, 'artboardId' | 'changeType'>;

const artboardCallOf = (segment: string[]) => {
  const index = segment.findIndex((token, at) => isCli(token) && segment[at + 1] === 'artboard');
  if (index < 0) return undefined;
  const [verb, target] = segment.slice(index + 2);
  if (verb === 'create') return { changeType: 'created' as const };
  if (verb === 'update' && target) return { artboardId: target, changeType: 'updated' as const };
};

const idFromJson = (output: string) => {
  try {
    const parsed: unknown = JSON.parse(output);
    const artboard = isRecord(parsed) ? parsed.artboard : undefined;
    return isRecord(artboard) && typeof artboard.id === 'string' ? artboard.id : undefined;
  } catch {
    return undefined;
  }
};

export const parseArtboardShellChange = (record: ShellRecord): ArtboardShellChange | null => {
  if (record.exitCode !== undefined && record.exitCode !== 0) return null;
  const call = parseShellCommandSegments(record.command)
    ?.map(artboardCallOf)
    .find((found) => !!found);
  if (!call || !record.output) return null;

  const artboardId =
    call.artboardId ??
    parseArtboardResultLine(record.output)?.artboardId ??
    idFromJson(record.output.trim());
  return artboardId ? { artboardId, changeType: call.changeType } : null;
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
  const parsed = record && parseArtboardShellChange(record);
  if (!parsed) return null;

  const board = await new ArtboardModel(ctx.db, ctx.userId, ctx.workspaceId).findById(
    parsed.artboardId,
  );
  if (!board) return null;

  const work: RegisterArtboardWorkParams = {
    agentId: params.agentId,
    artboardId: board.id,
    changeType: parsed.changeType,
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
