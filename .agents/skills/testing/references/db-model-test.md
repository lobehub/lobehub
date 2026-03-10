# Database Model Testing Guide

Test `packages/database` Model layer.

## Dual Environment Verification (Required)

```bash
# 1. Client environment (fast)
cd packages/database && TEST_SERVER_DB=0 bunx vitest run --silent='passed-only' '[file]'

# 2. Server environment (compatibility)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

## User Permission Check - Security First 🔒

**Critical security requirement**: All user data operations must include permission checks.

```typescript
// ❌ DANGEROUS: Missing permission check
update = async (id: string, data: Partial<MyModel>) => {
  return this.db
    .update(myTable)
    .set(data)
    .where(eq(myTable.id, id)) // Only checks ID
    .returning();
};

// ✅ SECURE: Permission check included
update = async (id: string, data: Partial<MyModel>) => {
  return this.db
    .update(myTable)
    .set(data)
    .where(
      and(
        eq(myTable.id, id),
        eq(myTable.userId, this.userId), // ✅ Permission check
      ),
    )
    .returning();
};
```

## Test File Structure

```typescript
// @vitest-environment node
describe('MyModel', () => {
  describe('create', () => {
    /* ... */
  });
  describe('queryAll', () => {
    /* ... */
  });
  describe('update', () => {
    it('should update own records');
    it('should NOT update other users records'); // 🔒 Security
  });
  describe('delete', () => {
    it('should delete own records');
    it('should NOT delete other users records'); // 🔒 Security
  });
  describe('user isolation', () => {
    it('should enforce user data isolation'); // 🔒 Core security
  });
});
```

## Security Test Example

```typescript
it('should not update records of other users', async () => {
  const [otherUserRecord] = await serverDB
    .insert(myTable)
    .values({ userId: 'other-user', data: 'original' })
    .returning();

  const result = await myModel.update(otherUserRecord.id, { data: 'hacked' });

  expect(result).toBeUndefined();
  const unchanged = await serverDB.query.myTable.findFirst({
    where: eq(myTable.id, otherUserRecord.id),
  });
  expect(unchanged?.data).toBe('original');
});
```

## Data Management

```typescript
const userId = 'test-user';
const otherUserId = 'other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});
```

## Foreign Key Handling

```typescript
// ❌ Wrong: Invalid foreign key
const testData = { asyncTaskId: 'invalid-uuid', fileId: 'non-existent' };

// ✅ Correct: Use null
const testData = { asyncTaskId: null, fileId: null };

// ✅ Or: Create referenced record first
beforeEach(async () => {
  const [asyncTask] = await serverDB
    .insert(asyncTasks)
    .values({ id: 'valid-id', status: 'pending' })
    .returning();
  testData.asyncTaskId = asyncTask.id;
});
```

## Predictable Sorting

```typescript
// ✅ Use explicit timestamps
const oldDate = new Date('2024-01-01T10:00:00Z');
const newDate = new Date('2024-01-02T10:00:00Z');
await serverDB.insert(table).values([
  { ...data1, createdAt: oldDate },
  { ...data2, createdAt: newDate },
]);

// ❌ Don't rely on insert order
await serverDB.insert(table).values([data1, data2]); // Unpredictable
```
