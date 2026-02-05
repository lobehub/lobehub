import type { GenerationAsset, ImageGenerationTopic } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import type { GenerationTopicItem } from '../schemas/generation';
import { generationTopics } from '../schemas/generation';
import type { LobeChatDatabase } from '../type';

export class GenerationTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.fileService = new FileService(db, userId);
  }

  queryAll = async () => {
    const topics = await this.db
      .select()
      .from(generationTopics)
      .orderBy(desc(generationTopics.updatedAt))
      .where(eq(generationTopics.userId, this.userId));

    return Promise.all(
      topics.map(async (topic) => {
        if (topic.coverUrl) {
          return {
            ...topic,
            coverUrl: await this.fileService.getFullFileUrl(topic.coverUrl),
          };
        }
        return topic;
      }),
    );
  };

  create = async (title: string) => {
    const [newGenerationTopic] = await this.db
      .insert(generationTopics)
      .values({
        title,
        userId: this.userId,
      })
      .returning();

    return newGenerationTopic;
  };

  update = async (
    id: string,
    data: Partial<ImageGenerationTopic>,
  ): Promise<GenerationTopicItem | undefined> => {
    const [updatedTopic] = await this.db
      .update(generationTopics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
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
      where: and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)),
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

    // Add thumbnail URLs from all generations
    if (topicWithBatches.batches) {
      for (const batch of topicWithBatches.batches) {
        for (const gen of batch.generations) {
          const asset = gen.asset as GenerationAsset;
          if (asset?.thumbnailUrl) {
            filesToDelete.push(asset.thumbnailUrl);
          }
        }
      }
    }

    // 3. Delete the topic record (this will cascade delete all batches and generations)
    const [deletedTopic] = await this.db
      .delete(generationTopics)
      .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
      .returning();

    return {
      deletedTopic,
      filesToDelete,
    };
  };
}
