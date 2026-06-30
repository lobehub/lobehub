### Description
This PR resolves the codebase-wide issue of unnecessary `return await` statements. Returning an awaited promise inside an `async` function creates an extra microtask for the V8 engine to resolve, hurting performance without providing any structural benefit (unless inside a try-catch block).

A custom regex scanner found and fixed 66 occurrences across both frontend and backend files.

### Changes Made
- Removed `await` from `return await` where it is the final statement of an async function outside of a `try-catch` block.

### Verification
- `npm run type-check` passes.