import type {GlobalState} from '@/store/global/initialState';

const initClientDBMigrationSqls = (s: GlobalState) => {
  return s.initClientDBMigrations?.sqls || [];
};

const displayMigrationStatus = (s: GlobalState) => {
  const sql = s.initClientDBMigrations?.sqls || [];
  const tableRecords = s.initClientDBMigrations?.tableRecords || [];

  return (
    sql

      .map((item, index) => {
        const recordInTable = tableRecords.find((record) => record.hash === item.hash);
        return {
          createdAt: new Date(item.folderMillis),
          desc: item.sql[0],
          folderMillis: item.folderMillis,
          id: item.hash,
          index: index + 1,
          migratedAt: recordInTable ? new Date(recordInTable.created_at) : undefined,
          sql: item.sql,
          status: !!recordInTable ? 'success' : 'error',
        };
      })
      // Sort by time in descending order
      .sort((a, b) => b.folderMillis - a.folderMillis)
  );
};

const errorMigrations = (s: GlobalState) => {
  const sql = s.initClientDBMigrations?.sqls || [];
  const tableRecords = s.initClientDBMigrations?.tableRecords || [];

  return sql.filter((item) => !tableRecords.some((record) => record.hash === item.hash));
};

export const clientDBSelectors = {
  displayMigrationStatus,
  errorMigrations,
  initClientDBMigrationSqls,
};
