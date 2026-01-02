import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clientDB, initializeDB } from '@/database/client/db';

import { TableViewerRepo } from './index';

const userId = 'user-table-viewer';
const repo = new TableViewerRepo(clientDB as any, userId);

// Mock database execution
const mockExecute = vi.fn();
const mockDB = {
  execute: mockExecute,
};

beforeEach(async () => {
  await initializeDB();
  vi.clearAllMocks();
}, 30000);

describe('TableViewerRepo', () => {
  describe('getAllTables', () => {
    it('should return all tables with counts', async () => {
      const result = await repo.getAllTables();

      expect(result.length).toEqual(73);
      expect(result[0]).toEqual({ name: 'accounts', count: 0, type: 'BASE TABLE' });
    });

    it('should handle custom schema', async () => {
      const result = await repo.getAllTables('custom_schema');
      expect(result).toBeDefined();
    });
  });

  describe('getTableDetails', () => {
    it('should return table column details', async () => {
      const tableName = 'test_table';
      const mockColumns = {
        rows: [
          {
            column_name: 'id',
            data_type: 'uuid',
            is_nullable: 'NO',
            column_default: null,
            is_primary_key: true,
            foreign_key: null,
          },
        ],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockColumns);

      const result = await testRepo.getTableDetails(tableName);

      expect(result).toEqual([
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          foreignKey: null,
        },
      ]);
    });
  });

  describe('getTableData', () => {
    it('should return paginated data with filters', async () => {
      const tableName = 'test_table';
      const pagination = {
        page: 1,
        pageSize: 10,
        sortBy: 'id',
        sortOrder: 'desc' as const,
      };
      const filters = [
        {
          column: 'name',
          operator: 'contains' as const,
          value: 'test',
        },
      ];

      const mockData = {
        rows: [{ id: 1, name: 'test' }],
      };
      const mockCount = {
        rows: [{ total: 1 }],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockCount);

      const result = await testRepo.getTableData(tableName, pagination, filters);

      expect(result).toEqual({
        data: mockData.rows,
        pagination: {
          page: 1,
          pageSize: 10,
          total: 1,
        },
      });
    });
  });

  describe('updateRow', () => {
    it('should update and return row data', async () => {
      const tableName = 'test_table';
      const id = '123';
      const primaryKeyColumn = 'id';
      const data = { name: 'updated' };

      const mockResult = {
        rows: [{ id: '123', name: 'updated' }],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await testRepo.updateRow(tableName, id, primaryKeyColumn, data);

      expect(result).toEqual(mockResult.rows[0]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteRow', () => {
    it('should delete a row', async () => {
      const tableName = 'test_table';
      const id = '123';
      const primaryKeyColumn = 'id';

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await testRepo.deleteRow(tableName, id, primaryKeyColumn);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('insertRow', () => {
    it('should insert and return new row data', async () => {
      const tableName = 'test_table';
      const data = { name: 'new row' };

      const mockResult = {
        rows: [{ id: '123', name: 'new row' }],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await testRepo.insertRow(tableName, data);

      expect(result).toEqual(mockResult.rows[0]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTableCount', () => {
    it('should return table count', async () => {
      const tableName = 'test_table';
      const mockResult = {
        rows: [{ total: 42 }],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockResult);

      const result = await testRepo.getTableCount(tableName);

      expect(result).toBe(42);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('batchDelete', () => {
    it('should delete multiple rows', async () => {
      const tableName = 'test_table';
      const ids = ['1', '2', '3'];
      const primaryKeyColumn = 'id';

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce({ rows: [] });

      await testRepo.batchDelete(tableName, ids, primaryKeyColumn);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('exportTableData', () => {
    it('should export table data with default pagination', async () => {
      const tableName = 'test_table';
      const mockData = {
        rows: [{ id: 1, name: 'test' }],
      };
      const mockCount = {
        rows: [{ total: 1 }],
      };

      const testRepo = new TableViewerRepo(mockDB as any, userId);
      mockExecute.mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockCount);

      const result = await testRepo.exportTableData(tableName);

      expect(result).toEqual({
        data: mockData.rows,
        pagination: {
          page: 1,
          pageSize: 1000,
          total: 1,
        },
      });
    });

    it('should export table data with custom pagination and filters', async () => {
      const tableName = 'test_table';
      const pagination = { page: 2, pageSize: 50 };
      const filters = [
        {
          column: 'status',
          operator: 'equals' as const,
          value: 'active',
        },
      ];

      const mockData = {
        rows: [{ id: 1, status: 'active' }],
      };
      const mockCount = {
        rows: [{ total: 1 }],
      };

      mockExecute.mockResolvedValueOnce(mockData).mockResolvedValueOnce(mockCount);

      const testRepo = new TableViewerRepo(mockDB as any, userId);

      const result = await testRepo.exportTableData(tableName, pagination, filters);

      expect(result).toEqual({
        data: mockData.rows,
        pagination: {
          page: 2,
          pageSize: 50,
          total: 1,
        },
      });
    });
  });
});
