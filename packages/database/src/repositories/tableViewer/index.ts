import type {
  FilterCondition,
  PaginationParams,
  TableBasicInfo,
  TableColumnInfo,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import pMap from 'p-map';

import { LobeChatDatabase } from '../../type';

export class TableViewerRepo {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Get all tables in the database
   */
  async getAllTables(schema = 'public'): Promise<TableBasicInfo[]> {
    const query = sql`
      SELECT
        table_name as name,
        table_type as type
      FROM information_schema.tables
      WHERE table_schema = ${schema}
      ORDER BY table_name;
    `;

    const tables = await this.db.execute(query);

    const tableNames = tables.rows.map((row) => row.name) as string[];

    const counts = await pMap(tableNames, async (name) => this.getTableCount(name), {
      concurrency: 10,
    });

    return tables.rows.map((row, index) => ({
      count: counts[index],
      name: row.name,
      type: row.type,
    })) as TableBasicInfo[];
  }

  /**
   * Get detailed structure information for a specified table
   */
  async getTableDetails(tableName: string): Promise<TableColumnInfo[]> {
    const query = sql`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        -- Primary key information
        (
          SELECT true
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_name = c.table_name
            AND kcu.column_name = c.column_name
            AND tc.constraint_type = 'PRIMARY KEY'
        ) is_primary_key,
        -- Foreign key information
        (
          SELECT json_build_object(
            'table', ccu.table_name,
            'column', ccu.column_name
          )
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.table_name = c.table_name
            AND kcu.column_name = c.column_name
            AND tc.constraint_type = 'FOREIGN KEY'
        ) foreign_key
      FROM information_schema.columns c
      WHERE c.table_name = ${tableName}
      AND c.table_schema = 'public'
      ORDER BY c.ordinal_position;
    `;

    const columns = await this.db.execute(query);

    return columns.rows.map((col: any) => ({
      defaultValue: col.column_default,
      foreignKey: col.foreign_key,
      isPrimaryKey: !!col.is_primary_key,
      name: col.column_name,
      nullable: col.is_nullable === 'YES',
      type: col.data_type,
    }));
  }

  /**
   * Get table data with support for pagination, sorting, and filtering
   */
  async getTableData(tableName: string, pagination: PaginationParams, filters?: FilterCondition[]) {
    const offset = (pagination.page - 1) * pagination.pageSize;

    // Build base query
    let baseQuery = sql`SELECT * FROM ${sql.identifier(tableName)}`;

    // Add filter conditions
    if (filters && filters.length > 0) {
      const whereConditions = filters.map((filter) => {
        const column = sql.identifier(filter.column);

        switch (filter.operator) {
          case 'equals': {
            return sql`${column} = ${filter.value}`;
          }
          case 'contains': {
            return sql`${column} ILIKE ${`%${filter.value}%`}`;
          }
          case 'startsWith': {
            return sql`${column} ILIKE ${`${filter.value}%`}`;
          }
          case 'endsWith': {
            return sql`${column} ILIKE ${`%${filter.value}`}`;
          }
          default: {
            return sql`1=1`;
          }
        }
      });

      baseQuery = sql`${baseQuery} WHERE ${sql.join(whereConditions, sql` AND `)}`;
    }

    // Add sorting
    if (pagination.sortBy) {
      const direction = pagination.sortOrder === 'desc' ? sql`DESC` : sql`ASC`;
      baseQuery = sql`${baseQuery} ORDER BY ${sql.identifier(pagination.sortBy)} ${direction}`;
    }

    // Add pagination
    const query = sql`${baseQuery} LIMIT ${pagination.pageSize} OFFSET ${offset}`;

    // Get total count
    const countQuery = sql`SELECT COUNT(*) as total FROM ${sql.identifier(tableName)}`;

    // Execute queries in parallel
    const [data, count] = await Promise.all([this.db.execute(query), this.db.execute(countQuery)]);

    return {
      data: data.rows,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: Number(count.rows[0].total),
      },
    };
  }

  /**
   * Update a row in the table
   */
  async updateRow(
    tableName: string,
    id: string,
    primaryKeyColumn: string,
    data: Record<string, any>,
  ) {
    const setColumns = Object.entries(data).map(([key, value]) => {
      return sql`${sql.identifier(key)} = ${value}`;
    });

    const query = sql`
      UPDATE ${sql.identifier(tableName)}
      SET ${sql.join(setColumns, sql`, `)}
      WHERE ${sql.identifier(primaryKeyColumn)} = ${id}
      RETURNING *
    `;

    const result = await this.db.execute(query);
    return result.rows[0];
  }

  /**
   * Delete a row from the table
   */
  async deleteRow(tableName: string, id: string, primaryKeyColumn: string) {
    const query = sql`
      DELETE FROM ${sql.identifier(tableName)}
      WHERE ${sql.identifier(primaryKeyColumn)} = ${id}
    `;

    await this.db.execute(query);
  }

  /**
   * Insert new row data
   */
  async insertRow(tableName: string, data: Record<string, any>) {
    const columns = Object.keys(data).map((key) => sql.identifier(key));
    const values = Object.values(data);

    const query = sql`
      INSERT INTO ${sql.identifier(tableName)}
      (${sql.join(columns, sql`, `)})
      VALUES (${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )})
      RETURNING *
    `;

    const result = await this.db.execute(query);
    return result.rows[0];
  }

  /**
   * Get total record count of a table
   */
  async getTableCount(tableName: string): Promise<number> {
    const query = sql`SELECT COUNT(*) as total FROM ${sql.identifier(tableName)}`;
    const result = await this.db.execute(query);
    return Number(result.rows[0].total);
  }

  /**
   * Batch delete data
   */
  async batchDelete(tableName: string, ids: string[], primaryKeyColumn: string) {
    const query = sql`
      DELETE FROM ${sql.identifier(tableName)}
      WHERE ${sql.identifier(primaryKeyColumn)} = ANY(${ids})
    `;

    await this.db.execute(query);
  }

  /**
   * Export table data (supports paginated export)
   */
  async exportTableData(
    tableName: string,
    pagination?: PaginationParams,
    filters?: FilterCondition[],
  ) {
    return this.getTableData(tableName, pagination || { page: 1, pageSize: 1000 }, filters);
  }
}
