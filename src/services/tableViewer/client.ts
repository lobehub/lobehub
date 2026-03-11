export class ClientService {
  getAllTables = async () => [
    { count: 0, name: 'test' },
    { count: 0, name: 'test2' },
  ];

  getTableDetails = async (tableName: string) => {
    console.info('getTableDetails:', tableName);
    return [{ name: 'test' }];
  };

  getTableData = async (tableName: string) => {
    console.info('getTableData:', tableName);
    return [{ name: 'test' }];
  };
}
