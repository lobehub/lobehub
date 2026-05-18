import type {
  ImageGenerationAsset,
  ImageGenerationTopic,
  VideoGenerationAsset,
} from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import type { GenerationTopicItem } from '../schemas/generation';
import { generationTopics } from '../schemas/generation';
import type { LobeChatDatabase } from '../type';
import type { GenerationTopicType } from '../types/generation';

const isMissingTypeColumnError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const dbError = error as { code?: string; message?: string };
  if (dbError.code !== '42703') return false;

  const message = dbError.message || '';
  return message.includes('"type"') || message.includes('type');
};

export class GenerationTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.fileService = new FileService(db, userId);
  }

  queryAll = async (type?: GenerationTopicType) => {
    let topics: GenerationTopicItem[];

    try {
      const conditions = [eq(generationTopics.userId, this.userId)];
      if (type) {
        conditions.push(eq(generationTopics.type, type));
      }

      topics = await this.db
        .select()
        .from(generationTopics)
        .orderBy(desc(generationTopics.updatedAt))
        .where(and(...conditions));
    } catch (error) {
      // Compatibility fallback for deployments where migration adding generation_topics.type
      // has not been applied yet. Old rows are image-only.
      if (!isMissingTypeColumnError(error)) throw error;

      const legacyTopics = await this.db
        .select({
          coverUrl: generationTopics.coverUrl,
          createdAt: generationTopics.createdAt,
          id: generationTopics.id,
          title: generationTopics.title,
          updatedAt: generationTopics.updatedAt,
          userId: generationTopics.userId,
        })
        .from(generationTopics)
        .orderBy(desc(generationTopics.updatedAt))
        .where(eq(generationTopics.userId, this.userId));

      topics =
        type === 'video'
          ? []
          : legacyTopics.map(
              (topic) => ({ ...topic, type: 'image' }) as unknown as GenerationTopicItem,
            );
    }

    return Promise.all(
      topics.map(async (topic) => {
        if (!topic.coverUrl) return topic;

        return {
          ...topic,
          coverUrl: await this.fileService.getFullFileUrl(topic.coverUrl),
        };
      }),
    );
  };

  create = async (title: string, type?: GenerationTopicType) => {
    try {
      const [newGenerationTopic] = await this.db
        .insert(generationTopics)
        .values({
          title,
          type: type ?? 'image',
          userId: this.userId,
        })
        .returning();

      return newGenerationTopic;
    } catch (error) {
      if (!isMissingTypeColumnError(error)) throw error;

      // Legacy schema has no `type` column and only supports image topics.
      if (type === 'video') throw error;

      const [legacyTopic] = await this.db
        .insert(generationTopics)
        .values({
          title,
          userId: this.userId,
        })
        .returning({
          coverUrl: generationTopics.coverUrl,
          createdAt: generationTopics.createdAt,
          id: generationTopics.id,
          title: generationTopics.title,
          updatedAt: generationTopics.updatedAt,
          userId: generationTopics.userId,
        });

      return { ...legacyTopic, type: 'image' } as GenerationTopicItem;
    }
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
      .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
      .returning();

    return {
      deletedTopic,
      filesToDelete,
    };
  };
}
