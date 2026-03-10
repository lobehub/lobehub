# Store Testing Coverage

## Current Status

**Overall Coverage**: \~80% (94 test files, 1263 tests) 🎯

**Breakdown:**

- Statements: \~80%
- Branches: \~87%
- Functions: \~55%
- Lines: \~80%
- Test Files: 94 passed (94)
- Tests: 1263 passed (1263 total)

**Action Files Coverage**: 40/40 tested (100%) 🎉

## Coverage Status by Priority

### 🔴 High Priority - Missing Tests (>200 LOC)

**All high priority files now have tests! ✅**

### 🟡 Medium Priority - Missing Tests (50-150 LOC)

**All medium priority files now have tests! ✅**

### 🎉 Achievement Unlocked: 100% Action File Coverage

All 40 action files in the store now have comprehensive test coverage!

## Testing Strategy

### 1. Zustand Store Action Testing Pattern

All store action tests should follow the patterns documented in:

- **Main Guide**: `.agents/skills/testing/references/zustand-store-action-test.md`

Key principles:

- **Test Layering**: Only spy on direct dependencies, never cross layers
- **Per-Test Mocking**: Spy on-demand in each test, avoid global mocks
- **Act Wrapping**: Always wrap state updates with `act()`
- **Type Safety**: Ensure mock return types match actual service responses
- **SWR Hooks**: For SWR-based actions, mock `useSWR` globally and return data synchronously

### 1.1. Using Subagents for Efficient Testing

**When to use subagents**:

- Testing multiple action files in the same store/domain
- Large refactoring requiring tests for multiple files
- Parallel development of multiple features

**Subagent workflow**:

1. **One subagent per action file** - Each subagent focuses on testing ONE action file completely
2. **Independent verification** - Each subagent runs its own typecheck, lint, and test verification
3. **No commits from subagents** - Only the parent agent creates the final commit after all subagents complete
4. **Parallel execution** - Launch all subagents in a single message using multiple Task tool calls
5. **Consolidate results** - Parent agent reviews all results, runs final verification, updates docs, and commits

**Example usage**:

Testing 3 files in discover store:

- Launch 3 subagents in parallel (one message with 3 Task calls)
- Each subagent writes tests for its assigned file
- Each subagent verifies its tests pass
- After all complete, run final checks and create one commit

**DO NOT**:

- Have subagents commit changes
- Have subagents update test-coverage.md
- Have subagents work on multiple files
- Create separate commits for each file

### 2. Testing Checklist

For each action file, ensure:

- [ ] Basic action tests (validation, main flow, error handling)
- [ ] Service integration tests (mocked)
- [ ] State update tests
- [ ] Selector tests (if complex selectors exist)
- [ ] Edge cases and boundary conditions
- [ ] Loading/abort state management
- [ ] Type safety (no @ts-expect-error unless necessary)

### 3. Store Organization Patterns

**Pattern 1: Simple Action File**

```
store/domain/slices/feature/
  ├── action.ts
  ├── action.test.ts
  ├── selectors.ts
  └── selectors.test.ts
```

**Pattern 2: Complex Actions (Subdirectory)**

```
store/domain/slices/feature/
  ├── actions/
  │   ├── __tests__/
  │   │   ├── action1.test.ts
  │   │   └── action2.test.ts
  │   ├── action1.ts
  │   ├── action2.ts
  │   └── index.ts
  └── selectors/
```

## Complete Testing Workflow

**IMPORTANT**: Follow this complete workflow for every testing task. ALL steps are REQUIRED.

### Recommended: Use Subagents for Parallel Testing

For files with multiple action files to test, use the Task tool to create subagents that work in parallel:

**Workflow**:

1. **Identify all action files** that need testing in the target store/slice
2. **Launch one subagent per action file** using the Task tool
3. **Each subagent independently**:
   - Writes tests for ONE action file only
   - Runs typecheck and lint
   - Verifies tests pass
   - Reports results back
   - **DOES NOT commit** (parent agent handles commits)
4. **After all subagents complete**, review all results
5. **Run final verification** (typecheck, lint, tests)
6. **Update test-coverage.md** with combined results
7. **Create single commit** with all new tests

**Example subagent prompt**:

```
Write comprehensive tests for src/store/discover/slices/plugin/action.ts following .agents/skills/testing/references/zustand-store-action-test.md.

Requirements:
1. Write tests covering all actions in the file
2. Follow SWR hooks testing pattern (if applicable)
3. run type-check and lint to verify
4. Run tests to ensure they pass
5. Report back with:
   - Number of tests written
   - Test coverage areas
   - Any issues encountered

DO NOT:
- Commit changes
- Update test-coverage.md
- Work on other action files
```

**Benefits of subagents**:

- ✅ Parallel execution - multiple action files tested simultaneously
- ✅ Focused scope - each subagent handles one file completely
- ✅ Independent verification - each file gets typecheck/lint/test verification
- ✅ Clean commits - single commit after all work is done
- ✅ Better organization - clear separation of concerns

### Step 0: Identify Missing Tests

```bash
# List all action files without tests
for file in $(find src/store -name "action.ts" | grep -v test | sort); do
  testfile="${file%.ts}.test.ts"
  if [ ! -f "$testfile" ]; then
    echo "❌ $file"
  fi
done
```

### Step 1: Development and Testing

```bash
# 1. Write tests following the testing guide
# 2. Run tests to verify they pass
bunx vitest run --silent='passed-only' 'src/store/[domain]/slices/[slice]/action.test.ts'

# For actions in subdirectories:
bunx vitest run --silent='passed-only' 'src/store/[domain]/slices/[slice]/actions/__tests__/[action].test.ts'
```

### Step 2: Type and Lint Checks

**CRITICAL**: Run type check and lint before proceeding. Failing these checks means the task is incomplete.

```bash
# Check TypeScript types (from project root)
bun run type-check

# Fix any linting issues
bunx eslint src/store/[domain]/ --fix
```

**Common Type Errors to Watch For:**

- Missing or incorrect type annotations
- Unused variables or imports
- Incorrect generic type parameters
- Mock type mismatches

**Do NOT proceed to Step 3 if type/lint checks fail!**

### Step 3: Run Coverage Report

```bash
# Run coverage to get updated metrics
bunx vitest run --coverage 'src/store'
```

### Step 4: Summarize Development Work

Before updating documentation, create a summary of what was accomplished:

**Summary Checklist:**

- [ ] What store/slice was worked on?
- [ ] What was the coverage improvement? (before% → after%)
- [ ] How many new tests were added?
- [ ] What specific features/logic were tested?
- [ ] Were any bugs discovered and fixed?
- [ ] Any new patterns or best practices identified?

**Example Summary:**

```
Store: chat/slices/aiChat
Coverage: 65% → 82% (+17%)
Tests Added: 52 new tests
Features Tested:
  - Message streaming with tool calls
  - RAG integration and chunk retrieval
  - Error handling for API failures
  - Abort controller management
Bugs Fixed: None
Guide Updates: Added streaming response mocking pattern
```

### Step 5: Update This Document

Based on your development summary, update the following sections:

1. **Current Status** section:
   - Update overall coverage percentage
   - Update test file count and total test count

2. **Coverage Status by Priority** section:
   - Move completed actions from missing tests to "Has Tests" section
   - Update the count of files with/without tests

3. **Completed Work** section:
   - Add newly tested actions to the list
   - Document coverage improvements
   - Document any bugs fixed

### Step 6: Final Verification

```bash
# Verify all tests still pass
bunx vitest run 'src/store'

# Verify type check still passes
bun run type-check
```

### Complete Workflow Example (Single File)

```bash
# 1. Development Phase
# ... write code and tests ...
bunx vitest run --silent='passed-only' 'src/store/tool/slices/mcpStore/action.test.ts'

# 2. Type/Lint Phase (REQUIRED)
bun run type-check # Must pass!
bunx eslint src/store/tool/ --fix

# 3. Coverage Phase
bunx vitest run --coverage 'src/store'

# 4. Summarization Phase
# Create summary following the checklist above

# 5. Documentation Phase
# Update this file with summary and metrics

# 6. Final Verification
bunx vitest run 'src/store'
bun run type-check

# 7. Commit
git add .
git commit -m "✅ test: add comprehensive tests for mcpStore actions"
```

### Complete Workflow Example (Using Subagents)

**Scenario**: Testing all discover store slices (plugin, mcp, assistant, model, provider)

**Step 1: Launch Subagents in Parallel**

Create 5 subagents, one for each action file:

```typescript
// Launch all subagents in a single message with multiple Task tool calls
Task({
  subagent_type: 'general-purpose',
  description: 'Test plugin action',
  prompt: `Write comprehensive tests for src/store/discover/slices/plugin/action.ts following .agents/skills/testing/references/zustand-store-action-test.md.

Requirements:
1. Write tests covering all actions (usePluginCategories, usePluginDetail, usePluginList, usePluginIdentifiers)
2. Follow SWR hooks testing pattern
3. run type-check and lint to verify
4. Run tests to ensure they pass
5. Report back with number of tests written and coverage areas

DO NOT commit changes or update test-coverage.md.`,
});

Task({
  subagent_type: 'general-purpose',
  description: 'Test mcp action',
  prompt: `Write comprehensive tests for src/store/discover/slices/mcp/action.ts following .agents/skills/testing/references/zustand-store-action-test.md.

Requirements:
1. Write tests covering all actions (useFetchMcpDetail, useFetchMcpList, useMcpCategories)
2. Follow SWR hooks testing pattern
3. run type-check and lint to verify
4. Run tests to ensure they pass
5. Report back with number of tests written and coverage areas

DO NOT commit changes or update test-coverage.md.`,
});

// ... similar for assistant, model, provider ...
```

**Step 2: Wait for All Subagents to Complete**

Each subagent will:

- Write tests
- run type-check and lint
- Verify tests pass
- Report results

**Step 3: Review Results**

After all subagents complete:

- Review each subagent's report
- Check for any issues or failures
- Verify all tests are written

**Step 4: Final Verification**

```bash
# run type-check on entire project
bun run type-check

# Run lint on all new test files
bunx eslint src/store/discover/ --fix

# Run all new tests together
bunx vitest run 'src/store/discover/**/*.test.ts'

# Run coverage
bunx vitest run --coverage 'src/store'
```

**Step 5: Update Documentation**

```bash
# Update test-coverage.md with:
# - New overall coverage percentage
# - Number of new tests
# - List of newly tested action files
# - Session summary
```

**Step 6: Create Single Commit**

```bash
git add .
git commit -m "✅ test(store): add comprehensive tests for discover store

- Add tests for plugin, mcp, assistant, model, provider slices
- Coverage: X% → Y% (+Z tests, 5 new test files)
- All tests pass typecheck and lint

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Benefits**:

- All 5 action files tested in parallel (faster)
- Each file independently verified
- Single atomic commit with all changes
- Clean git history

**Remember**: A testing task is only complete when:

1. ✅ Tests pass
2. ✅ Type check passes
3. ✅ Lint passes
4. ✅ Development work is summarized
5. ✅ Documentation is updated
6. ✅ Final verification passes

## Commands

### Testing Commands

```bash
# Run all store tests
bunx vitest run 'src/store'

# Run all store tests with coverage
bunx vitest run --coverage 'src/store'

# Run specific store tests
bunx vitest run --silent='passed-only' 'src/store/[domain]/**/*.test.ts'

# Run specific action tests
bunx vitest run --silent='passed-only' 'src/store/[domain]/slices/[slice]/action.test.ts'

# Watch mode for development
bunx vitest watch 'src/store/[domain]/slices/[slice]/action.test.ts'
```

### Type Check Commands

```bash
# Type check entire project (from project root)
bun run type-check

# Watch mode
bunx tsc --noEmit --watch
```

### Lint Commands

```bash
# Lint specific store
bunx eslint src/store/[domain]/ --fix

# Lint all stores
bunx eslint src/store/ --fix

# Lint without auto-fix (check only)
bunx eslint src/store/[domain]/
```

## Completed Work

### Recent Achievements ✅

**Session (2025-10-15 - Part 2)**: 🏆 100% Action File Coverage Achieved!

- **Coverage**: \~80% overall (+160 tests, 9 new test files)
- **New Test Files**:
  - `discover/slices/assistant/action.test.ts` - 10 tests covering assistant discovery (SWR hooks)
  - `discover/slices/provider/action.test.ts` - 11 tests covering provider discovery (SWR hooks)
  - `discover/slices/model/action.test.ts` - 12 tests covering model discovery (SWR hooks)
  - `knowledgeBase/slices/crud/action.test.ts` - 19 tests covering KB CRUD operations
  - `knowledgeBase/slices/content/action.test.ts` - 10 tests covering KB content management
  - `file/slices/upload/action.test.ts` - 18 tests covering file upload handling
  - `file/slices/chunk/action.test.ts` - 18 tests covering file chunk operations
  - `aiInfra/slices/aiModel/action.test.ts` - 23 tests covering AI model management
  - `chat/slices/thread/action.test.ts` - 39 tests covering thread management
- **Actions Tested**: All remaining 9 medium-priority action files (100% completion)
- **Features Tested**:
  - Discovery system (assistants, providers, models with SWR hooks)
  - Knowledge base operations (CRUD, content management, file associations)
  - File operations (upload with progress, chunk operations, semantic search)
  - AI model management (CRUD, remote sync, batch operations)
  - Thread management (CRUD, messaging, AI title generation)
- **Testing Patterns**:
  - SWR hook testing for all discover slices
  - Proper error handling and loading states
  - Complex async flows with multiple dependencies
  - Semantic search and RAG integration testing
  - File upload with progress callbacks
- **Development Method**: Used parallel subagents (9 subagents running simultaneously)
- **Type Safety**: All tests pass typecheck ✅
- **Lint**: All tests pass lint ✅
- **Action Files Coverage**: 31/40 → 40/40 tested (100%, +9 files)
- **🎉 MILESTONE**: All 40 action files now have comprehensive test coverage!

**Session (2025-10-15 - Part 1)**: ✅ High Priority Files Testing Complete 🎉

- **Coverage**: \~76% overall (+76 tests, 2 new test files)
- **New Test Files**:
  - `tool/slices/mcpStore/action.test.ts` - 41 tests (1,120 LOC) covering MCP plugin management
  - `file/slices/fileManager/action.test.ts` - 35 tests (692 LOC) covering file management operations
- **Actions Tested**:
  - **mcpStore** (7 main actions): updateMCPInstallProgress, cancelInstallMCPPlugin, cancelMcpConnectionTest, testMcpConnection, uninstallMCPPlugin, loadMoreMCPPlugins, resetMCPPluginList, useFetchMCPPluginList, installMCPPlugin
  - **fileManager** (15 actions): dispatchDockFileList, embeddingChunks, parseFilesToChunks, pushDockFileList, reEmbeddingChunks, reParseFile, refreshFileList, removeAllFiles, removeFileItem, removeFiles, toggleEmbeddingIds, toggleParsingIds, useFetchFileItem, useFetchFileManage
- **Features Tested**:
  - MCP plugin installation flow (normal, resume, with dependencies, with config)
  - MCP connection testing (HTTP and STDIO)
  - MCP plugin lifecycle (install, uninstall, list management)
  - File upload and processing workflows
  - File chunk embedding and parsing
  - File list management and refresh
  - SWR data fetching for both stores
- **Testing Patterns**:
  - Proper test layering with direct dependency spying
  - Per-test mocking without global pollution
  - Comprehensive error handling and cancellation flows
  - AbortController management testing
  - Mock return types matching actual services
- **Development Method**: Used parallel subagents (2 subagents, one per file)
- **Type Safety**: All tests pass typecheck ✅
- **Lint**: All tests pass lint ✅
- **Action Files Coverage**: 31/40 tested (77.5%, +2 files)
- **Milestone**: 🏆 All high priority files (>200 LOC) now have comprehensive tests!

**Session (2024-10-15)**: ✅ Discover Store Testing Complete

- **Coverage**: 74.24% overall (+26 tests, 2 new test files)
- **New Test Files**:
  - `discover/slices/plugin/action.test.ts` - 15 tests covering plugin discovery (SWR hooks)
  - `discover/slices/mcp/action.test.ts` - 11 tests covering MCP discovery (SWR hooks)
- **Features Tested**:
  - Plugin categories, detail, identifiers, and list fetching
  - MCP categories, detail, and list fetching
  - SWR key generation with locale and parameters
  - SWR configuration verification
  - Service integration with discoverService
- **Testing Patterns**:
  - Successfully adapted zustand testing patterns for SWR hooks
  - Mock strategy: Synchronously return data from mock useSWR
  - Type safety: Used `as any` for test mock data where needed
- **Type Safety**: All tests pass typecheck
- **Action Files Coverage**: 29/40 tested (72.5%, +2 files)

**Session (2024-10-14)**: 📋 Store Testing Documentation Created

- Created comprehensive test coverage tracking document
- Analyzed 40 action files across 13 stores
- Identified 15 files without tests (37.5%)
- Prioritized by complexity (LOC): 15 files from 624 LOC (mcpStore) to 27 LOC (content)
- Documented testing patterns and workflow
- Ready for systematic test development

**Previous Work**:

- 25 action files already have comprehensive tests (62.5% coverage)
- 742 tests written across 80 test files
- Well-tested stores: agent, chat (partial), file (partial), image, session, tool, user, global, aiInfra (partial)
- Following zustand testing best practices from `.agents/skills/testing/references/zustand-store-action-test.md`

## Notes

### General Testing Notes

- All store actions should follow the Zustand testing pattern for consistency
- Test layering principle: Only spy on direct dependencies
- Per-test mocking: Avoid global spy pollution in beforeEach
- Always use `act()` wrapper for state updates
- Mock return types must match actual service types
- **Type check and lint must pass before committing**
- **Update this document after each testing task completion**

### Store-Specific Notes

- **chat/aiChat**: Complex streaming logic, requires careful mocking of chatService
- **chat/thread**: ✅ Comprehensive tests complete (39 tests, \~80 LOC)
- **tool/mcpStore**: ✅ Comprehensive tests complete (41 tests, 624 LOC)
- **file/fileManager**: ✅ Comprehensive tests complete (35 tests, 205 LOC)
- **file/upload**: ✅ Comprehensive tests complete (18 tests, \~90 LOC)
- **file/chunk**: ✅ Comprehensive tests complete (18 tests, \~85 LOC)
- **discover/assistant**: ✅ Comprehensive tests complete (10 tests, \~120 LOC)
- **discover/provider**: ✅ Comprehensive tests complete (11 tests, \~100 LOC)
- **discover/model**: ✅ Comprehensive tests complete (12 tests, \~95 LOC)
- **knowledgeBase/crud**: ✅ Comprehensive tests complete (19 tests, \~110 LOC)
- **knowledgeBase/content**: ✅ Comprehensive tests complete (10 tests, \~75 LOC)
- **aiInfra/aiModel**: ✅ Comprehensive tests complete (23 tests, \~100 LOC)
- **aiInfra**: Some tests exist in **tests**/ subdirectories
- **global**: Has action tests in actions/ subdirectory structure
