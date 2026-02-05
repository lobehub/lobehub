import type {
  AsyncTaskError,
  AsyncTaskStatus,
  Generation,
  ImageGenerationAsset,
} from '@lobechat/types';
import { FileSource } from '@lobechat/types';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import type { NewFile } from '../schemas';
import type { GenerationItem, GenerationWithAsyncTask, NewGeneration } from '../schemas/generation';
import { generations } from '../schemas/generation';
import type { LobeChatDatabase, Transaction } from '../type';
import { FileModel } from './file';

// Create debug logger
const log = debug('lobe-image:generation-model');

export class GenerationModel {
  private db: LobeChatDatabase;
  private userId: string;
  private fileModel: FileModel;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.fileModel = new FileModel(db, userId);
    this.fileService = new FileService(db, userId);
  }

  async create(value: Omit<NewGeneration, 'userId'>): Promise<GenerationItem> {
    log('Creating generation: %O', {
      generationBatchId: value.generationBatchId,
      userId: this.userId,
    });

    const [result] = await this.db
      .insert(generations)
      .values({ ...value, userId: this.userId })
      .returning();

    log('Generation created successfully: %s', result.id);
    return result;
  }

  async findById(id: string): Promise<GenerationItem | undefined> {
    log('Finding generation by ID: %s for user: %s', id, this.userId);

    const result = await this.db.query.generations.findFirst({
      where: and(eq(generations.id, id), eq(generations.userId, this.userId)),
    });

    log('Generation %s: %s', id, result ? 'found' : 'not found');
    return result;
  }

  async findByIdWithAsyncTask(id: string): Promise<GenerationWithAsyncTask | undefined> {
    log('Finding generation by ID: %s for user: %s', id, this.userId);

    const result = await this.db.query.generations.findFirst({
      where: and(eq(generations.id, id), eq(generations.userId, this.userId)),
      with: {
        asyncTask: true,
      },
    });

    log('Generation %s: %s', id, result ? 'found' : 'not found');
    return result as GenerationWithAsyncTask | undefined;
  }

  async update(id: string, value: Partial<NewGeneration>, trx?: Transaction) {
    log('Updating generation: %s with values: %O', id, {
      asyncTaskId: value.asyncTaskId,
      hasAsset: !!value.asset,
    });

    const executeUpdate = async (tx: Transaction) => {
      return await tx
        .update(generations)
        .set({ ...value, updatedAt: new Date() })
        .where(and(eq(generations.id, id), eq(generations.userId, this.userId)));
    };

    const result = await (trx ? executeUpdate(trx) : this.db.transaction(executeUpdate));

    log('Generation %s updated successfully', id);
    return result;
  }

  async createAssetAndFile(
    id: string,
    asset: ImageGenerationAsset,
    file: Omit<NewFile, 'id' | 'userId'>,
  ) {
    log('Creating generation asset and file with transaction: %s', id);

    return await this.db.transaction(async (tx: Transaction) => {
      // Create file first using transaction
      // Since duplicates are very rare, we always create globalFile - checking existence first would be wasteful
      const newFile = await this.fileModel.create(
        {
          ...file,
          parentId: file.parentId ?? undefined,
          source: FileSource.ImageGeneration,
        },
        true,
        tx,
      );

      // Update generation with asset and fileId using the transaction-aware update method
      await this.update(
        id,
        {
          asset,
          fileId: newFile.id,
        },
        tx,
      );

      log('Generation %s updated with asset and file %s successfully', id, newFile.id);

      return {
        file: newFile,
      };
    });
  }

  async delete(id: string, trx?: Transaction) {
    log('Deleting generation: %s for user: %s', id, this.userId);

    const executeDelete = async (tx: Transaction) => {
      return await tx
        .delete(generations)
        .where(and(eq(generations.id, id), eq(generations.userId, this.userId)))
        .returning();
    };

    const result = await (trx ? executeDelete(trx) : this.db.transaction(executeDelete));
    const deletedGeneration = result[0];

    log('Generation %s deleted successfully', id);
    return deletedGeneration;
  }

  /**
   * Find generation by ID and transform it to frontend type
   * This method uses findByIdWithAsyncTask and applies transformation
   */
  async findByIdAndTransform(id: string): Promise<Generation | null> {
    log('Finding and transforming generation: %s', id);

    const generation = await this.findByIdWithAsyncTask(id);
    if (!generation) {
      log('Generation %s not found', id);
      return null;
    }

    return await this.transformGeneration(generation);
  }

  /**
   * Transform a GenerationItem (database type) to Generation (frontend type)
   * This method processes asset URLs and async task information
   */
  async transformGeneration(generation: GenerationWithAsyncTask): Promise<Generation> {
    // Process asset URLs if they exist, following the same logic as in generationBatch.ts
    const asset = generation.asset as ImageGenerationAsset | null;
    if (asset && asset.url && asset.thumbnailUrl) {
      const [url, thumbnailUrl] = await Promise.all([
        this.fileService.getFullFileUrl(asset.url),
        this.fileService.getFullFileUrl(asset.thumbnailUrl),
      ]);
      asset.url = url;
      asset.thumbnailUrl = thumbnailUrl;
    }

    // Build the Generation object following the same structure as in generationBatch.ts
    const result: Generation = {
      asset,
      asyncTaskId: generation.asyncTaskId || null,
      createdAt: generation.createdAt,
      id: generation.id,
      seed: generation.seed,
      task: {
        error: generation.asyncTask?.error
          ? (generation.asyncTask.error as AsyncTaskError)
          : undefined,
        id: generation.asyncTaskId || '',
        status: (generation.asyncTask?.status as AsyncTaskStatus) || 'pending',
      },
    };
    return result;
  }
}
