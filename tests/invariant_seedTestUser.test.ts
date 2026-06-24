import { seedTestUser } from './seedTestUser';
import { getTestDbClient } from '../database/testDbClient';

describe('User input never appears in SQL queries without parameterization', () => {
  const payloads = [
    { id: "' OR 1=1 --", email: 'test@example.com', username: 'test' },
    { id: "'; DROP TABLE users; --", email: 'test@example.com', username: 'test' },
    { id: '1', email: "' OR '1'='1", username: 'test' },
    { id: '1', email: 'test@example.com', username: "test'; SELECT * FROM users --" },
    { id: 'valid-id', email: 'valid@example.com', username: 'valid-user' }
  ];

  test.each(payloads)('rejects adversarial input in seedTestUser', async (payload) => {
    const client = getTestDbClient();
    const originalQuery = client.query;
    
    // Spy on the query method to inspect SQL and parameters
    const queryCalls: any[] = [];
    client.query = jest.fn((sql: string, params?: any[]) => {
      queryCalls.push({ sql, params });
      return originalQuery.call(client, sql, params);
    });

    try {
      await seedTestUser(payload);
      
      // Verify at least one query was executed
      expect(queryCalls.length).toBeGreaterThan(0);
      
      // Security assertion: No user input appears directly in SQL string
      queryCalls.forEach(({ sql, params }) => {
        // Check that SQL contains parameter placeholders, not concatenated values
        expect(sql).toMatch(/\$\d+/);
        
        // Verify all user-provided values are in params array, not in SQL string
        const userValues = [payload.id, payload.email, payload.username];
        userValues.forEach(value => {
          if (value !== undefined) {
            expect(sql).not.toContain(value);
            expect(params).toContain(value);
          }
        });
      });
    } finally {
      client.query = originalQuery;
      await client.end();
    }
  });
});