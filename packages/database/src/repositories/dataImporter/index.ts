import type { ImporterEntryData, ImportPgDataStructure, ImportResultData } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import { uuid } from '@/utils/uuid';

import * as EXPORT_TABLES from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeprecatedDataImporterRepos } from './deprecated';

interface ImportResult {
  added: number;
  errors: number;
  skips: number;
  updated?: number;
}

type ConflictStrategy = 'skip' | 'override' | 'merge';

interface TableImportConfig {
  // Conflict resolution strategy
  conflictStrategy?: ConflictStrategy;
  // Field processing functions
  fieldProcessors?: {
    [field: string]: (value: any) => any;
  };
  // Whether to use composite key (no separate id field)
  isCompositeKey?: boolean;
  // Whether to preserve original ID
  preserveId?: boolean;
  // Relation field definitions
  relations?: {
    field: string;
    sourceField?: string;
    sourceTable: string;
  }[];
  // Self-reference fields
  selfReferences?: {
    field: string;
    sourceField?: string;
  }[];
  // Table name
  table: string;
  // Unique constraint fields
  uniqueConstraints?: string[];
}

// Import table configuration
const IMPORT_TABLE_CONFIG: TableImportConfig[] = [
  {
    conflictStrategy: 'merge',
    preserveId: true,
    // Special table, ID same as user ID
    table: 'userSettings',
    uniqueConstraints: ['id'],
  },
  {
    conflictStrategy: 'merge',
    isCompositeKey: true,
    table: 'userInstalledPlugins',
    uniqueConstraints: ['identifier'],
  },
  {
    conflictStrategy: 'skip',
    preserveId: true,
    table: 'aiProviders',
    uniqueConstraints: ['id'],
  },
  {
    conflictStrategy: 'skip',
    preserveId: true, // Need to preserve original ID
    relations: [
      {
        field: 'providerId',
        sourceTable: 'aiProviders',
      },
    ],
    table: 'aiModels',
    uniqueConstraints: ['id', 'providerId'],
  },
  {
    table: 'sessionGroups',
    uniqueConstraints: [],
  },
  {
    fieldProcessors: {
      slug: (value) => (value ? `${value}-${uuid().slice(0, 8)}` : null),
    },
    table: 'agents',
    uniqueConstraints: ['slug'],
  },
  {
    // Special processing for slug field
    fieldProcessors: {
      slug: (value) => `${value}-${uuid().slice(0, 8)}`,
    },
    relations: [
      {
        field: 'groupId',
        sourceTable: 'sessionGroups',
      },
    ],
    table: 'sessions',
    uniqueConstraints: ['slug'],
  },
  {
    relations: [
      {
        field: 'sessionId',
        sourceTable: 'sessions',
      },
    ],
    table: 'topics',
  },
  {
    conflictStrategy: 'skip',
    isCompositeKey: true, // Uses composite primary key [agentId, sessionId]
    relations: [
      {
        field: 'agentId',
        sourceTable: 'agents',
      },
      {
        field: 'sessionId',
        sourceTable: 'sessions',
      },
    ],
    table: 'agentsToSessions',
    uniqueConstraints: ['agentId', 'sessionId'],
  },
  {
    relations: [
      {
        field: 'topicId',
        sourceTable: 'topics',
      },
    ],
    selfReferences: [
      {
        field: 'parentThreadId',
      },
    ],
    table: 'threads',
  },
  {
    relations: [
      {
        field: 'sessionId',
        sourceTable: 'sessions',
      },
      {
        field: 'topicId',
        sourceTable: 'topics',
      },
      {
        field: 'agentId',
        sourceTable: 'agents',
      },
      {
        field: 'threadId',
        sourceTable: 'threads',
      },
    ],
    selfReferences: [
      {
        field: 'parentId',
      },
      {
        field: 'quotaId',
      },
    ],
    table: 'messages',
  },
  {
    conflictStrategy: 'skip',
    preserveId: true, // Uses message ID as primary key
    relations: [
      {
        field: 'id',
        sourceTable: 'messages',
      },
    ],
    table: 'messagePlugins',
  },
  {
    isCompositeKey: true, // Uses composite primary key [messageId, chunkId]
    relations: [
      {
        field: 'messageId',
        sourceTable: 'messages',
      },
      {
        field: 'chunkId',
        sourceTable: 'chunks',
      },
    ],
    table: 'messageChunks',
  },
  {
    isCompositeKey: true, // Uses composite primary key [id, queryId, chunkId]
    relations: [
      {
        field: 'id',
        sourceTable: 'messages',
      },
      {
        field: 'queryId',
        sourceTable: 'messageQueries',
      },
      {
        field: 'chunkId',
        sourceTable: 'chunks',
      },
    ],
    table: 'messageQueryChunks',
  },
  // {
  //   relations: [
  //     {
  //       field: 'messageId',
  //       sourceTable: 'messages',
  //     },
  //     {
  //       field: 'embeddingsId',
  //       sourceTable: 'embeddings',
  //     },
  //   ],
  //   table: 'messageQueries',
  // },
  {
    conflictStrategy: 'skip',
    preserveId: true, // Uses message ID as primary key
    relations: [
      {
        field: 'id',
        sourceTable: 'messages',
      },
    ],
    table: 'messageTranslates',
  },
  // {
  //   conflictStrategy: 'skip',
  //   preserveId: true, // Uses message ID as primary key
  //   relations: [
  //     {
  //       field: 'id',
  //       sourceTable: 'messages',
  //     },
  //     {
  //       field: 'fileId',
  //       sourceTable: 'files',
  //     },
  //   ],
  //   table: 'messageTTS',
  // },
];

export class DataImporterRepos {
  private userId: string;
  private db: LobeChatDatabase;
  private deprecatedDataImporterRepos: DeprecatedDataImporterRepos;
  private idMaps: Record<string, Record<string, string>> = {};
  private conflictRecords: Record<string, { field: string; value: any }[]> = {};

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.deprecatedDataImporterRepos = new DeprecatedDataImporterRepos(db, userId);
  }

  importData = async (data: ImporterEntryData): Promise<ImportResultData> => {
    const results = await this.deprecatedDataImporterRepos.importData(data);
    return { results, success: true };
  };

  /**
   * Import PostgreSQL data
   */
  async importPgData(
    dbData: ImportPgDataStructure,
    conflictStrategy: ConflictStrategy = 'skip',
  ): Promise<ImportResultData> {
    const results: Record<string, ImportResult> = {};
    const { data } = dbData;

    // Initialize ID mapping table and conflict records
    this.idMaps = {};
    this.conflictRecords = {};

    try {
      await this.db.transaction(async (trx) => {
        // Import tables in configuration order
        for (const config of IMPORT_TABLE_CONFIG) {
          const { table: tableName } = config;

          // @ts-ignore
          const tableData = data[tableName];

          if (!tableData || tableData.length === 0) {
            continue;
          }

          // Use unified import method
          const result = await this.importTableData(trx, config, tableData, conflictStrategy);
          console.log(`imported table: ${tableName}, records: ${tableData.length}`);

          if (Object.values(result).some((value) => value > 0)) {
            results[tableName] = result;
          }
        }
      });

      return { results, success: true };
    } catch (error) {
      console.error('Import failed:', error);

      return {
        error: {
          details: this.extractErrorDetails(error),
          message: (error as any).message,
        },
        results,
        success: false,
      };
    }
  }

  /**
   * Extract detailed information from error
   */
  private extractErrorDetails(error: any) {
    if (error.code === '23505') {
      // PostgreSQL unique constraint error code
      const match = error.detail?.match(/Key \((.+?)\)=\((.+?)\) already exists/);
      if (match) {
        return {
          constraintType: 'unique',
          field: match[1],
          value: match[2],
        };
      }
    }

    return error.detail || 'Unknown error details';
  }

  /**
   * Unified table data import function - Handles all types of tables
   */
  private async importTableData(
    trx: any,
    config: TableImportConfig,
    tableData: any[],

    _userConflictStrategy: ConflictStrategy,
  ): Promise<ImportResult> {
    const {
      table: tableName,
      preserveId,
      isCompositeKey = false,
      uniqueConstraints = [],
      conflictStrategy = 'override',
      fieldProcessors = {},
      relations = [],
      selfReferences = [],
    } = config;

    // @ts-ignore
    const table = EXPORT_TABLES[tableName];
    const result: ImportResult = { added: 0, errors: 0, skips: 0, updated: 0 };

    // Initialize ID mapping for this table
    if (!this.idMaps[tableName]) {
      this.idMaps[tableName] = {};
    }

    try {
      // 1. Find existing records (based on clientId and userId)
      let existingRecords: any[] = [];

      if ('clientId' in table && 'userId' in table) {
        const clientIds = tableData.map((item) => item.clientId || item.id).filter(Boolean);

        if (clientIds.length > 0) {
          existingRecords = await trx.query[tableName].findMany({
            where: and(eq(table.userId, this.userId), inArray(table.clientId, clientIds)),
          });
        }
      }

      // If need to preserve original ID, also check if ID already exists
      if (preserveId && !isCompositeKey) {
        const ids = tableData.map((item) => item.id).filter(Boolean);
        if (ids.length > 0) {
          const idExistingRecords = await trx.query[tableName].findMany({
            where: inArray(table.id, ids),
          });

          // Merge into existing records set
          existingRecords = [
            ...existingRecords,
            ...idExistingRecords.filter(
              (record: any) => !existingRecords.some((existing) => existing.id === record.id),
            ),
          ];
        }
      }

      result.skips = existingRecords.length;

      // 2. Establish ID mapping for existing records
      for (const record of existingRecords) {
        // Only non-composite key tables need ID mapping
        if (!isCompositeKey) {
          this.idMaps[tableName][record.id] = record.id;
          if (record.clientId) {
            this.idMaps[tableName][record.clientId] = record.id;
          }

          // Any other ID identifiers that may be used in records
          const originalRecord = tableData.find(
            (item) => item.id === record.id || item.clientId === record.clientId,
          );

          if (originalRecord) {
            // Ensure original record ID also maps to database record ID
            this.idMaps[tableName][originalRecord.id] = record.id;
          }
        }
      }

      // 3. Filter out records that need to be inserted
      const recordsToInsert = tableData.filter(
        (item) =>
          !existingRecords.some(
            (record) =>
              (record.clientId === (item.clientId || item.id) && record.clientId) ||
              (preserveId && !isCompositeKey && record.id === item.id),
          ),
      );

      if (recordsToInsert.length === 0) {
        return result;
      }

      // 4. Prepare import data
      const preparedData = recordsToInsert.map((item) => {
        const originalId = item.id;

        // Process date fields
        const dateFields: any = {};
        if (item.createdAt) dateFields.createdAt = new Date(item.createdAt);
        if (item.updatedAt) dateFields.updatedAt = new Date(item.updatedAt);
        if (item.accessedAt) dateFields.accessedAt = new Date(item.accessedAt);

        // Create new record object
        let newRecord: any = {};

        // Decide how to process based on whether it's composite key and whether to preserve ID
        if (isCompositeKey) {
          // For composite key tables, don't include id field

          const { id: _, ...rest } = item;
          newRecord = {
            ...rest,
            ...dateFields,
            clientId: item.clientId || item.id,
            userId: this.userId,
          };
        } else {
          // Non-composite key table processing
          newRecord = {
            ...(preserveId ? item : { ...item, id: undefined }),
            ...dateFields,
            clientId: item.clientId || item.id,
            userId: this.userId,
          };
        }

        // Apply field processors
        for (const field in fieldProcessors) {
          if (newRecord[field] !== undefined) {
            newRecord[field] = fieldProcessors[field](newRecord[field]);
          }
        }

        // Special table processing
        if (tableName === 'userSettings') {
          newRecord.id = this.userId;
        }

        // Process relation fields (foreign key references)
        for (const relation of relations) {
          const { field, sourceTable } = relation;

          if (newRecord[field] && this.idMaps[sourceTable]) {
            const mappedId = this.idMaps[sourceTable][newRecord[field]];

            if (mappedId) {
              newRecord[field] = mappedId;
            } else {
              // Cannot find mapping, set to null
              console.warn(
                `Could not find mapped ID for ${field}=${newRecord[field]} in table ${sourceTable}`,
              );
              newRecord[field] = null;
            }
          }
        }

        // Simplified processing of self-reference fields - directly set to null
        for (const selfRef of selfReferences) {
          const { field } = selfRef;
          if (newRecord[field] !== undefined) {
            newRecord[field] = null;
          }
        }

        return { newRecord, originalId };
      });

      // 5. Check unique constraints and apply conflict strategy
      for (const record of preparedData) {
        if (isCompositeKey && uniqueConstraints.length > 0) {
          // For composite key tables, treat all unique constraint fields as a combined condition
          const whereConditions = uniqueConstraints
            .filter((field) => record.newRecord[field] !== undefined)
            .map((field) => eq(table[field], record.newRecord[field]));

          // Add userId condition (if table has userId field)
          if ('userId' in table) {
            whereConditions.push(eq(table.userId, this.userId));
          }

          if (whereConditions.length > 0) {
            const exists = await trx.query[tableName].findFirst({
              where: and(...whereConditions),
            });

            if (exists) {
              // Record conflict
              if (!this.conflictRecords[tableName]) this.conflictRecords[tableName] = [];
              this.conflictRecords[tableName].push({
                field: uniqueConstraints.join(','),
                value: uniqueConstraints
                  .map((field) => `${field}=${record.newRecord[field]}`)
                  .join(','),
              });

              // Apply conflict strategy
              switch (conflictStrategy) {
                case 'skip': {
                  record.newRecord._skip = true;
                  result.skips++;

                  // Key improvement: establish ID mapping even if skipped
                  if (!isCompositeKey) {
                    this.idMaps[tableName][record.originalId] = exists.id;
                    if (record.newRecord.clientId) {
                      this.idMaps[tableName][record.newRecord.clientId] = exists.id;
                    }
                  }
                  break;
                }
                case 'override': {
                  // No additional operation needed, will be overridden on insert
                  break;
                }
                case 'merge': {
                  // Merge data
                  await trx
                    .update(table)
                    .set(record.newRecord)
                    .where(and(...whereConditions));
                  record.newRecord._skip = true;
                  if (result.updated) result.updated++;
                  else {
                    result.updated = 1;
                  }
                  break;
                }
              }
            }
          }
        } else {
          // Process unique constraints
          for (const field of uniqueConstraints) {
            if (!record.newRecord[field]) continue;

            // Check if field value already exists
            const exists = await trx.query[tableName].findFirst({
              where: eq(table[field], record.newRecord[field]),
            });

            if (exists) {
              // Record conflict
              if (!this.conflictRecords[tableName]) this.conflictRecords[tableName] = [];
              this.conflictRecords[tableName].push({
                field,
                value: record.newRecord[field],
              });

              // Apply conflict strategy
              switch (conflictStrategy) {
                case 'skip': {
                  record.newRecord._skip = true;
                  result.skips++;

                  // Key improvement: establish ID mapping even if skipped
                  if (!isCompositeKey) {
                    this.idMaps[tableName][record.originalId] = exists.id;
                    if (record.newRecord.clientId) {
                      this.idMaps[tableName][record.newRecord.clientId] = exists.id;
                    }
                  }
                  break;
                }
                case 'override': {
                  // Apply field processor
                  if (field in fieldProcessors) {
                    record.newRecord[field] = fieldProcessors[field](record.newRecord[field]);
                  }
                  break;
                }

                case 'merge': {
                  // Merge data
                  await trx
                    .update(table)
                    .set(record.newRecord)
                    .where(eq(table[field], record.newRecord[field]));
                  record.newRecord._skip = true;
                  if (result.updated) result.updated++;
                  else {
                    result.updated = 1;
                  }
                  break;
                }
              }
            }
          }
        }
      }

      // Filter out records marked to be skipped
      const filteredData = preparedData.filter((record) => !record.newRecord._skip);

      // Clear temporary markers
      filteredData.forEach((record) => delete record.newRecord._skip);

      // 6. Batch insert data
      const BATCH_SIZE = 100;

      for (let i = 0; i < filteredData.length; i += BATCH_SIZE) {
        const batch = filteredData.slice(i, i + BATCH_SIZE).filter(Boolean);

        const itemsToInsert = batch.map((item) => item.newRecord);
        const originalIds = batch.map((item) => item.originalId);

        try {
          // Insert and return result
          const insertQuery = trx.insert(table).values(itemsToInsert);

          let insertResult;

          // Only non-composite key tables need to return ID
          if (!isCompositeKey) {
            const res = await insertQuery.returning();
            insertResult = res.map((item: any) => ({
              clientId: 'clientId' in item ? item.clientId : undefined,
              id: item.id,
            }));
          } else {
            await insertQuery;
            insertResult = itemsToInsert.map(() => ({})); // Create empty result to maintain count
          }

          result.added += insertResult.length;

          // Establish ID mapping relationship (only for non-composite key tables)
          if (!isCompositeKey) {
            for (const [j, newRecord] of insertResult.entries()) {
              const originalId = originalIds[j];
              this.idMaps[tableName][originalId] = newRecord.id;

              // Also ensure clientId can map to the correct ID
              const originalRecord = tableData.find((item) => item.id === originalId);
              if (originalRecord && originalRecord.clientId) {
                this.idMaps[tableName][originalRecord.clientId] = newRecord.id;
              }
            }
          }
        } catch (error) {
          console.error(`Error batch inserting ${tableName}:`, error);

          // Handle error and record
          if ((error as any).code === '23505') {
            const match = (error as any).detail?.match(/Key \((.+?)\)=\((.+?)\) already exists/);
            if (match) {
              const conflictField = match[1];

              if (!this.conflictRecords[tableName]) this.conflictRecords[tableName] = [];
              this.conflictRecords[tableName].push({
                field: conflictField,
                value: match[2],
              });
            }
          }

          result.errors += batch.length;
        }
      }

      return result;
    } catch (error) {
      console.error(`Error importing table ${tableName}:`, error);
      result.errors = tableData.length;
      return result;
    }
  }
}
