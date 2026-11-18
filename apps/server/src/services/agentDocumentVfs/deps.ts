import type { DocumentWriteSource } from '@lobechat/types';

import type { AgentDocumentModel } from '@/database/models/agentDocuments';

import type { FileService } from '../file';
import type { PageBody } from '../pageCollab/bodyWriter';
import type { SkillMount } from './mounts/skills/SkillMount';

/**
 * Collaborators the `AgentDocumentVfsService` sub-domain modules read.
 *
 * Use when:
 * - A module under `agentDocumentVfs/` needs the per-user document model, the skill mount,
 *   or the file service that the service instance owns
 *
 * Expects:
 * - `getFileService` stays lazy so browsing never initializes object storage
 */
export interface AgentDocumentVfsDeps {
  agentDocumentModel: AgentDocumentModel;
  /**
   * Refuses a write that would leave a document over the plan's character limit.
   * Run it before anything is persisted or pushed to a collaboration room.
   */
  assertWithinCharLimit: (params: {
    charCount: number;
    previousCharCount?: number;
    source: DocumentWriteSource;
  }) => Promise<void>;
  getFileService: () => FileService;
  skillMount: SkillMount;
  /**
   * Writes a body into the document's live collaboration room, whose projection
   * would otherwise overwrite a row write. False when there is no live room.
   */
  writeThroughRoom: (
    documentId: string,
    body: PageBody,
    writeSource: DocumentWriteSource,
  ) => Promise<boolean>;
}
