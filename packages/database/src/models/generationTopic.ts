import type {
  ImageGenerationAsset,
  ImageGenerationTopic,
  VideoGenerationAsset,
} from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import type { GenerationTopicItem } from '../schemas/generation';
import { generationTopics } from '../schemas/generation';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';
import type { GenerationTopicType } from '../types/generation';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

type GenerationTopicUpdate = Pick<Partial<ImageGenerationTopic>, 'coverUrl' | 'title'> & {
  visibility?: 'private' | 'public';
};

export class GenerationTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.fileService = new FileService(db, userId);
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, generationTopics);

  queryAll = async (type?: GenerationTopicType) => {
    const conditions = [this.ownership()];
    if (type) {
      conditions.push(eq(generationTopics.type, type));
    }

    const rows = await this.db
      .select({
        avatar: users.avatar,
        fullName: users.fullName,
        topic: generationTopics,
        username: users.username,
      })
      .from(generationTopics)
      .leftJoin(users, eq(generationTopics.userId, users.id))
      .orderBy(desc(generationTopics.updatedAt))
      .where(and(...conditions));

    return Promise.all(
      rows.map(async ({ topic, avatar, fullName, username }) => {
        const coverUrl = topic.coverUrl
          ? await this.fileService.getFullFileUrl(topic.coverUrl)
          : topic.coverUrl;
        return {
          ...topic,
          coverUrl,
          creator: {
            avatar,
            fullName,
            id: topic.userId,
            username,
          },
        };
      }),
    );
  };

  findById = async (id: string): Promise<GenerationTopicItem | undefined> => {
    const [topic] = await this.db
      .select()
      .from(generationTopics)
      .where(and(eq(generationTopics.id, id), this.ownership()))
      .limit(1);

    return topic;
  };

  create = async (title: string, type?: GenerationTopicType, visibility?: 'private' | 'public') => {
    const [newGenerationTopic] = await this.db
      .insert(generationTopics)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            title,
            type: type ?? 'image',
            ...(this.workspaceId ? { visibility: visibility ?? 'private' } : {}),
          },
        ),
      )
      .returning();

    return newGenerationTopic;
  };

  update = async (
    id: string,
    data: GenerationTopicUpdate,
  ): Promise<GenerationTopicItem | undefined> => {
    const [updatedTopic] = await this.db
      .update(generationTopics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(generationTopics.id, id), this.ownership()))
      .returning();

    return updatedTopic;
  };

  /**
   * Flip a generation topic's `visibility`. Bidirectional publish/unpublish.
   * The combined `user_id = ?` + `visibility = fromVisibility` guards keep the
   * operation creator-only and idempotent against rows already at the target
   * visibility.
   *
   * Unpublishing is safe by design — after the flip, `buildWorkspaceWhere`
   * hides the topic (and its batches/generations) from other members on the
   * next read. Files that back the assets are protected separately at their
   * own `files.visibility`.
   */
  setVisibility = async (
    id: string,
    visibility: 'private' | 'public',
  ): Promise<GenerationTopicItem | undefined> => {
    const fromVisibility = visibility === 'public' ? 'private' : 'public';

    const [updatedTopic] = await this.db
      .update(generationTopics)
      .set({ updatedAt: new Date(), visibility })
      .where(
        and(
          eq(generationTopics.id, id),
          this.ownership(),
          eq(generationTopics.userId, this.userId),
          eq(generationTopics.visibility, fromVisibility),
        ),
      )
      .returning();

    return updatedTopic;
  };

  /**
   * Delete a generation topic and return associated file URLs for cleanup
   *
   * This method follows the "database first, files second" deletion principle:
   * 1. First queries the topic with all its batches and generations to collect file URLs
   * 2. Then deletes the database record (cascade delete handles related batches and generations)
   * 3. Returns the deleted topic data and file URLs for cleanup
   *
   * @param id - The topic ID to delete
   * @returns Object containing deleted topic data and file URLs to clean, or undefined if topic not found or access denied
   */
  delete = async (
    id: string,
  ): Promise<{ deletedTopic: GenerationTopicItem; filesToDelete: string[] } | undefined> => {
    // 1. First, get the topic with all its batches and generations to collect file URLs
    const topicWithBatches = await this.db.query.generationTopics.findFirst({
      where: and(eq(generationTopics.id, id), this.ownership()),
      with: {
        batches: {
          with: {
            generations: {
              columns: {
                asset: true,
              },
            },
          },
        },
      },
    });

    // If topic doesn't exist or doesn't belong to user, return undefined
    if (!topicWithBatches) {
      return undefined;
    }

    // 2. Collect all file URLs that need to be deleted
    const filesToDelete: string[] = [];

    // Add cover image URL if exists
    if (topicWithBatches.coverUrl) {
      filesToDelete.push(topicWithBatches.coverUrl);
    }

    // Add asset file URLs from all generations (video, cover, thumbnail)
    if (topicWithBatches.batches) {
      for (const batch of topicWithBatches.batches) {
        for (const gen of batch.generations) {
          const asset = gen.asset as ImageGenerationAsset | VideoGenerationAsset | null;
          if (asset?.url) filesToDelete.push(asset.url);
          if (asset?.thumbnailUrl) filesToDelete.push(asset.thumbnailUrl);
          if (asset && 'coverUrl' in asset && asset.coverUrl) {
            filesToDelete.push(asset.coverUrl);
          }
        }
      }
    }

    // 3. Delete the topic record (this will cascade delete all batches and generations)
    const [deletedTopic] = await this.db
      .delete(generationTopics)
      .where(and(eq(generationTopics.id, id), this.ownership()))
      .returning();

    return {
      deletedTopic,
      filesToDelete,
    };
  };
}
