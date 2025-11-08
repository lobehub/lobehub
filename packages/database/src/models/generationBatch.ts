import { Generation, GenerationAsset, GenerationBatch, GenerationConfig } from '@lobechat/types';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import {
  GenerationBatchItem,
  GenerationBatchWithGenerations,
  NewGenerationBatch,
  generationBatches,
} from '../schemas/generation';
import { LobeChatDatabase } from '../type';
import { GenerationModel } from './generation';

const log = debug('lobe-image:generation-batch-model');

export class GenerationBatchModel {
  private db: LobeChatDatabase;
  private userId: string;
  private fileService: FileService;
  private generationModel: GenerationModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.fileService = new FileService(db, userId);
    this.generationModel = new GenerationModel(db, userId);
  }

  async create(value: NewGenerationBatch): Promise<GenerationBatchItem> {
    log('Creating generation batch: %O', {
      topicId: value.generationTopicId,
      userId: this.userId,
    });

    const [result] = await this.db
      .insert(generationBatches)
      .values({ ...value, userId: this.userId })
      .returning();

    log('Generation batch created successfully: %s', result.id);
    return result;
  }

  async findById(id: string): Promise<GenerationBatchItem | undefined> {
    log('Finding generation batch by ID: %s for user: %s', id, this.userId);

    const result = await this.db.query.generationBatches.findFirst({
      where: and(eq(generationBatches.id, id), eq(generationBatches.userId, this.userId)),
    });

    log('Generation batch %s: %s', id, result ? 'found' : 'not found');
    return result;
  }

  async findByTopicId(topicId: string): Promise<GenerationBatchItem[]> {
    log('Finding generation batches by topic ID: %s for user: %s', topicId, this.userId);

    const results = await this.db.query.generationBatches.findMany({
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      where: and(
        eq(generationBatches.generationTopicId, topicId),
        eq(generationBatches.userId, this.userId),
      ),
    });

    log('Found %d generation batches for topic %s', results.length, topicId);
    return results;
  }

  /**
   * Find batches with their associated generations using relations
   */
  async findByTopicIdWithGenerations(topicId: string): Promise<GenerationBatchWithGenerations[]> {
    log(
      'Finding generation batches with generations for topic ID: %s for user: %s',
      topicId,
      this.userId,
    );

    const results = await this.db.query.generationBatches.findMany({
      orderBy: (table, { asc }) => [asc(table.createdAt)],
      where: and(
        eq(generationBatches.generationTopicId, topicId),
        eq(generationBatches.userId, this.userId),
      ),
      with: {
        generations: {
          orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
          with: {
            asyncTask: true,
          },
        },
      },
    });

    log('Found %d generation batches with generations for topic %s', results.length, topicId);
    return results as GenerationBatchWithGenerations[];
  }

  async queryGenerationBatchesByTopicIdWithGenerations(
    topicId: string,
  ): Promise<(GenerationBatch & { generations: Generation[] })[]> {
    log('Fetching generation batches for topic ID: %s for user: %s', topicId, this.userId);

    const batchesWithGenerations = await this.findByTopicIdWithGenerations(topicId);
    if (batchesWithGenerations.length === 0) {
      log('No batches found for topic: %s', topicId);
      return [];
    }

    // Transform the database result to match our frontend types
    const result: GenerationBatch[] = await Promise.all(
      batchesWithGenerations.map(async (batch) => {
        const [generations, config] = await Promise.all([
          // Transform generations
          Promise.all(
            batch.generations.map((gen) => this.generationModel.transformGeneration(gen)),
          ),
          // Transform config
          (async () => {
            const config = batch.config as GenerationConfig;

            // Handle single imageUrl
            if (config.imageUrl) {
              config.imageUrl = await this.fileService.getFullFileUrl(config.imageUrl);
            }

            // Handle imageUrls array
            if (Array.isArray(config.imageUrls)) {
              config.imageUrls = await Promise.all(
                config.imageUrls.map((url) => this.fileService.getFullFileUrl(url)),
              );
            }
            return config;
          })(),
        ]);

        return {
          config,
          createdAt: batch.createdAt,
          generations,
          height: batch.height,
          id: batch.id,
          model: batch.model,
          prompt: batch.prompt,
          provider: batch.provider,
          width: batch.width,
        };
      }),
    );

    log('Feed construction complete for topic: %s, returning %d batches', topicId, result.length);
    return result;
  }

  /**
   * Delete a generation batch and return associated file URLs for cleanup
   *
   * This method follows the "database first, files second" deletion principle:
   * 1. First queries the batch with its generations to collect thumbnail URLs
   * 2. Then deletes the database record (cascade delete handles related generations)
   * 3. Returns the deleted batch data and thumbnail URLs for file cleanup
   *
   * @param id - The batch ID to delete
   * @returns Object containing deleted batch data and thumbnail URLs to clean, or undefined if batch not found or access denied
   */
  async delete(
    id: string,
  ): Promise<{ deletedBatch: GenerationBatchItem; thumbnailUrls: string[] } | undefined> {
    log('Deleting generation batch: %s for user: %s', id, this.userId);

    // 1. First, get generations with their assets to collect thumbnail URLs
    const batchWithGenerations = await this.db.query.generationBatches.findFirst({
      where: and(eq(generationBatches.id, id), eq(generationBatches.userId, this.userId)),
      with: {
        generations: {
          columns: {
            asset: true,
          },
        },
      },
    });

    // If batch doesn't exist or doesn't belong to user, return undefined
    if (!batchWithGenerations) {
      return undefined;
    }

    // 2. Collect thumbnail URLs that need to be deleted
    const thumbnailUrls: string[] = [];
    if (batchWithGenerations.generations) {
      for (const gen of batchWithGenerations.generations) {
        const asset = gen.asset as GenerationAsset;
        if (asset?.thumbnailUrl) {
          thumbnailUrls.push(asset.thumbnailUrl);
        }
      }
    }

    // 3. Delete the batch record (this will cascade delete all associated generations)
    const [deletedBatch] = await this.db
      .delete(generationBatches)
      .where(and(eq(generationBatches.id, id), eq(generationBatches.userId, this.userId)))
      .returning();

    log(
      'Generation batch %s deleted successfully with %d thumbnails to clean',
      id,
      thumbnailUrls.length,
    );

    return {
      deletedBatch,
      thumbnailUrls,
    };
  }
}
