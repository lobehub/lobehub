import type {
  TfsConnectionStatus,
  TfsCredentials,
  TfsPage,
  TfsProject,
  TfsReadResult,
  TfsRepository,
} from '@lobechat/types';
import { t } from 'i18next';

import { lambdaClient } from '@/libs/trpc/client';

export interface TfsQuery {
  binding?: string;
  cursor?: string;
  id?: number;
  kind: 'status' | 'projects' | 'repositories' | 'branches' | 'browse' | 'detail' | 'file' | 'log';
  logId?: number;
  path?: string;
  project?: string;
  repository?: string;
  resource?: 'prs' | 'builds' | 'releases' | 'tfvc';
  startLine?: number;
  version?: number;
}

export interface TfsData {
  branches?: TfsPage<{ name: string }>;
  connection?: TfsConnectionStatus;
  file?: { content: string; path: string; version: number };
  log?: string;
  projects?: TfsPage<TfsProject>;
  read?: TfsReadResult;
  repositories?: TfsPage<TfsRepository>;
}

class TfsService {
  connect = (input: TfsCredentials) => lambdaClient.tfs.connect.mutate(input).catch(throwTfsError);
  disconnect = () => lambdaClient.tfs.disconnect.mutate();
  resolveRepository = (url: string) => lambdaClient.tfs.resolveRepository.query({ url });

  async query(p: TfsQuery): Promise<TfsData> {
    try {
      switch (p.kind) {
        case 'status': {
          return { connection: await lambdaClient.tfs.status.query() };
        }
        case 'projects': {
          return { projects: await lambdaClient.tfs.projects.query({ cursor: p.cursor }) };
        }
        case 'repositories': {
          return {
            repositories: await lambdaClient.tfs.repositories.query({ project: p.project! }),
          };
        }
        case 'branches': {
          return {
            branches: await lambdaClient.tfs.branches.query({
              project: p.project!,
              repository: p.repository!,
              cursor: p.cursor,
            }),
          };
        }
        case 'browse': {
          return {
            read: await lambdaClient.tfs.browse.query({
              kind: p.resource!,
              project: p.project!,
              repository: p.repository,
              cursor: p.cursor,
              path: p.path,
              version: p.version,
            }),
          };
        }
        case 'detail': {
          return {
            read: await lambdaClient.tfs.detail.query({
              kind: p.resource as 'prs' | 'builds' | 'releases',
              project: p.project!,
              repository: p.repository,
              id: p.id!,
            }),
          };
        }
        case 'log': {
          return {
            log: await lambdaClient.tfs.log.query({
              project: p.project!,
              buildId: p.id!,
              logId: p.logId!,
              startLine: p.startLine ?? 0,
            }),
          };
        }
        case 'file': {
          return {
            file: await lambdaClient.tfs.tfvcFile.query({
              project: p.project!,
              path: p.path!,
              version: p.version!,
            }),
          };
        }
      }
    } catch (error) {
      return throwTfsError(error);
    }
  }
}
export const tfsService = new TfsService();

const throwTfsError = (error: unknown): never => {
  const code = error instanceof Error ? error.message : '';
  const key = /^TFS_[A-Z_]+$/.test(code) ? code : 'TFS_REQUEST_FAILED';
  throw new Error(
    String(
      t(`tfs.error.${key}`, {
        defaultValue: t('tfs.error.TFS_REQUEST_FAILED', { ns: 'integration' }),
        ns: 'integration',
      }),
    ),
  );
};
