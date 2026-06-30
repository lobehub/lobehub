### Description
The codebase contains numerous eturn await statements within async functions (especially inside the TRPC routers). As per the code review checklist (AGENTS.md), eturn await is considered an anti-pattern (unless inside a 	ry/catch block) because it adds an unnecessary microtask to the execution stack. 

### Locations to update
Hundreds of instances exist, particularly in:
- pps/server/src/routers/lambda/agentDocument.ts (e.g., [line 467](https://github.com/lobehub/lobe-chat/blob/main/apps/server/src/routers/lambda/agentDocument.ts#L467))
- pps/server/src/routers/lambda/agentSkills.ts

### Expected Behavior
Run a linting rule or a codemod to identify and safely remove eturn await across the codebase where it isn't wrapped in a 	ry/catch.
