import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ThreadService } from '../services/thread.service';
import { TopicBranchService } from '../services/topic-branch.service';
import type {
  TopicBatchRequest,
  TopicBranchRequest,
  TopicCloneRequest,
  TopicForkRequest,
  TopicImportRequest,
  TopicSearchQuery,
  TopicShareRequest,
  TopicThreadCreateRequest,
  TopicThreadUpdateRequest,
  TopicTranscriptQuery,
} from '../types/topic.type';

type Params = { id: string };
type ThreadParams = { threadId: string; topicId: string };

/** Topic copies, transcript, export / import, search, batch, share and threads. */
export class TopicBranchController extends BaseController {
  private async service(c: Context) {
    return new TopicBranchService(
      await this.getDatabase(),
      this.getUserId(c)!,
      this.getWorkspaceId(c),
    );
  }

  private async threads(c: Context) {
    return new ThreadService(await this.getDatabase(), this.getUserId(c)!, this.getWorkspaceId(c));
  }

  /** Answers 201 with the payload `run` resolves to, or the mapped error. */
  private async created(c: Context, run: () => Promise<unknown>, message: string) {
    try {
      return this.success(c, await run(), message, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  private async ok(c: Context, run: () => Promise<unknown>, message: string) {
    try {
      return this.success(c, await run(), message);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  handleClone = async (c: Context) =>
    this.created(
      c,
      async () =>
        (await this.service(c)).clone(
          this.getParams<Params>(c).id,
          await this.getBody<TopicCloneRequest>(c),
        ),
      'Topic cloned successfully',
    );

  handleFork = async (c: Context) =>
    this.created(
      c,
      async () =>
        (await this.service(c)).fork(
          this.getParams<Params>(c).id,
          await this.getBody<TopicForkRequest>(c),
        ),
      'Topic forked successfully',
    );

  handleBranch = async (c: Context) =>
    this.created(
      c,
      async () =>
        (await this.service(c)).branch(
          this.getParams<Params>(c).id,
          await this.getBody<TopicBranchRequest>(c),
        ),
      'Topic branched successfully',
    );

  handleTranscript = async (c: Context) =>
    this.ok(
      c,
      async () =>
        (await this.service(c)).transcript(
          this.getParams<Params>(c).id,
          this.getQuery<TopicTranscriptQuery>(c),
        ),
      'Topic transcript retrieved successfully',
    );

  handleExport = async (c: Context) =>
    this.ok(
      c,
      async () => (await this.service(c)).export(this.getParams<Params>(c).id),
      'Topic exported successfully',
    );

  handleImport = async (c: Context) =>
    this.created(
      c,
      async () => (await this.service(c)).import(await this.getBody<TopicImportRequest>(c)),
      'Topic imported successfully',
    );

  handleSearch = async (c: Context) =>
    this.ok(
      c,
      async () => (await this.service(c)).search(this.getQuery<TopicSearchQuery>(c)),
      'Topics searched successfully',
    );

  handleBatch = async (c: Context) =>
    this.ok(
      c,
      async () => (await this.service(c)).batch(await this.getBody<TopicBatchRequest>(c)),
      'Batch topic action completed',
    );

  handleShare = async (c: Context) =>
    this.ok(
      c,
      async () =>
        (await this.service(c)).share(
          this.getParams<Params>(c).id,
          await this.getBody<TopicShareRequest>(c),
        ),
      'Topic share updated successfully',
    );

  handleMarkRead = async (c: Context) =>
    this.ok(
      c,
      async () => (await this.service(c)).markRead(this.getParams<Params>(c).id),
      'Topic marked as read',
    );

  handleCreateThread = async (c: Context) =>
    this.created(
      c,
      async () =>
        (await this.threads(c)).create(
          this.getParams<{ topicId: string }>(c).topicId,
          await this.getBody<TopicThreadCreateRequest>(c),
        ),
      'Thread created successfully',
    );

  handleUpdateThread = async (c: Context) =>
    this.ok(
      c,
      async () => {
        const { threadId, topicId } = this.getParams<ThreadParams>(c);
        return (await this.threads(c)).update(
          topicId,
          threadId,
          await this.getBody<TopicThreadUpdateRequest>(c),
        );
      },
      'Thread updated successfully',
    );

  handleDeleteThread = async (c: Context) =>
    this.ok(
      c,
      async () => {
        const { threadId, topicId } = this.getParams<ThreadParams>(c);
        return (await this.threads(c)).remove(topicId, threadId);
      },
      'Thread deleted successfully',
    );
}
