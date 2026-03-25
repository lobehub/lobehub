# Shared Agent Support in Messages

## Problem

When creating messages with a shared agent ID (IDs starting with `shared_`), the database insert operation fails with a foreign key constraint violation:

```
Failed query: insert into "messages" (..., "agent_id", ...) values (..., 'shared_8de5545d-f04e-4804-8bc2-4759ee1f945b', ...)
```

This happens because:

- `messages.agentId` has a foreign key constraint referencing the `agents` table
- Shared agents are stored in the `shared_agents` table, not the `agents` table
- The FK constraint prevents inserting a shared agent ID into the `agentId` field

## Solution

Following the same pattern used in `TopicModel`, the `MessageModel` now handles shared agent IDs by:

1. Detecting if `agentId` starts with `shared_`
2. Setting `agentId` to `null` to avoid FK constraint violation
3. Storing the original shared agent ID in `metadata.sharedAgentId`

This approach:

- Maintains data integrity (no FK violations)
- Preserves the shared agent association (in metadata)
- Allows querying messages by shared agent ID (via metadata)

## Implementation

### MessageModel.create()

```typescript
// Handle shared agents: if agentId starts with 'shared_', set it to null
const isSharedAgent = normalizedMessage.agentId?.startsWith('shared_');
if (isSharedAgent && normalizedMessage.agentId) {
  // Store the original shared agent ID in metadata
  const metadata = normalizedMessage.metadata || {};
  metadata.sharedAgentId = normalizedMessage.agentId;
  normalizedMessage = {
    ...normalizedMessage,
    agentId: null,
    metadata,
  };
}
```

### MessageModel.batchCreate()

Same logic applied to batch message creation.

## Testing

See `packages/database/src/models/__tests__/messages/message.shared-agent.test.ts` for test cases covering:

- Creating messages with shared agent IDs
- Creating messages with regular agent IDs
- Batch creating messages with shared agent IDs
- Verifying metadata storage

## Related Files

- `packages/database/src/models/message.ts` - Message model implementation
- `packages/database/src/models/topic.ts` - Topic model (same pattern)
- `packages/database/src/models/__tests__/topics/topic.shared-agent.test.ts` - Topic tests
- `packages/database/src/schemas/sharedAgent.ts` - Shared agent schema
