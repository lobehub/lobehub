$repo = "lobehub/lobehub"

# Issue 1
$title1 = "[Tech Debt] Migrate createStyles to createStaticStyles for zero-runtime CSS-in-JS"
$body1 = @"
### Description
According to the LobeHub development guidelines (`AGENTS.md` and `.cursor/docs/createStaticStyles_migration_guide.md`), `createStaticStyles` with `cssVar.*` should be preferred for zero-runtime overhead. Currently, there are several instances in the codebase using the older `createStyles` method that can be migrated to avoid runtime CSS generation overhead.

### Locations to update
- [src/features/Conversation/Messages/Verify/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/Conversation/Messages/Verify/index.tsx#L14)
- [src/features/EditorCanvas/LinearFilePlugin.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/EditorCanvas/LinearFilePlugin.tsx#L14)
- [src/features/PageEditor/PageEditor.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/PageEditor/PageEditor.tsx#L84)

### Expected Behavior
Refactor these styling blocks to use `createStaticStyles` where runtime computation is not genuinely required, improving rendering performance.
"@
$body1 | Out-File "issue1.md" -Encoding utf8
gh issue create --repo $repo --title $title1 --body-file "issue1.md"

# Issue 2
$title2 = "[Tech Debt] Replace antd and @lobehub/ui primitive components with @lobehub/ui/base-ui"
$body2 = @"
### Description
The contribution guidelines state that component priority should be `@lobehub/ui/base-ui` (headless primitives) first. However, the codebase still imports components like `Modal` and `Select` directly from `antd` or the root `@lobehub/ui` package. This breaks encapsulation and inflates the bundle size unnecessarily.

### Locations to update
**antd imports:**
- [src/features/Electron/updater/UpdateNotification.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/Electron/updater/UpdateNotification.tsx#L4)
- [src/features/ResourceManager/components/Editor/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/ResourceManager/components/Editor/index.tsx#L4)
- [src/routes/(main)/community/(detail)/workspace/features/WorkspaceStatusFilter.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/routes/(main)/community/(detail)/workspace/features/WorkspaceStatusFilter.tsx#L3)

**@lobehub/ui root imports (should be base-ui):**
- [src/features/DocumentModal/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/DocumentModal/index.tsx#L3)
- [src/routes/(main)/agent/profile/features/AgentSettings/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/routes/(main)/agent/profile/features/AgentSettings/index.tsx#L3)

### Expected Behavior
Update the import paths for primitives like `Modal`, `Select`, `DropdownMenu`, etc., to `@lobehub/ui/base-ui` across these components.
"@
$body2 | Out-File "issue2.md" -Encoding utf8
gh issue create --repo $repo --title $title2 --body-file "issue2.md"

# Issue 3
$title3 = "[Refactor] Remove unnecessary return await from async functions"
$body3 = @"
### Description
The codebase contains numerous `return await` statements within async functions (especially inside the TRPC routers). As per the code review checklist (`AGENTS.md`), `return await` is considered an anti-pattern (unless inside a `try/catch` block) because it adds an unnecessary microtask to the execution stack. 

### Locations to update
Hundreds of instances exist, particularly in:
- `apps/server/src/routers/lambda/agentDocument.ts` (e.g., [line 467](https://github.com/lobehub/lobe-chat/blob/main/apps/server/src/routers/lambda/agentDocument.ts#L467))
- `apps/server/src/routers/lambda/agentSkills.ts`

### Expected Behavior
Run a linting rule or a codemod to identify and safely remove `return await` across the codebase where it isn't wrapped in a `try/catch`.
"@
$body3 | Out-File "issue3.md" -Encoding utf8
gh issue create --repo $repo --title $title3 --body-file "issue3.md"

# Issue 4
$title4 = "[Tech Debt] Clean up console.log leftovers in production frontend code"
$body4 = @"
### Description
The code review checklist prohibits leaving `console.log` statements in the codebase. While some are valid inside scripts, there are several `console.log` leftovers in the frontend source code that should be replaced with the `@lobehub/debug` utility (or removed entirely) to avoid polluting the production console.

### Locations to update
- [src/business/client/BusinessSettingPages/SubscriptionIframeWrapper.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/business/client/BusinessSettingPages/SubscriptionIframeWrapper.tsx#L79)

### Expected Behavior
Remove these leftover `console.log` statements or migrate them to use the appropriate `lobe-*` debug namespace.
"@
$body4 | Out-File "issue4.md" -Encoding utf8
gh issue create --repo $repo --title $title4 --body-file "issue4.md"

# Issue 5
$title5 = "[Types] Resolve @ts-expect-error suppressions in production code"
$body5 = @"
### Description
While `@ts-expect-error` and `any` types are sometimes necessary in test files to mock edge cases, they are currently bleeding into production files. This suppresses potential runtime errors and degrades overall type safety.

### Locations to update
- [src/components/server/ServerLayout.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/components/server/ServerLayout.tsx#L17)
- [src/features/NavPanel/components/BackButton.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/NavPanel/components/BackButton.tsx#L18)
- [src/libs/better-auth/sso/index.ts](https://github.com/lobehub/lobe-chat/blob/main/src/libs/better-auth/sso/index.ts#L94)

### Expected Behavior
Review these instances and replace them with proper TypeScript typings and interfaces.
"@
$body5 | Out-File "issue5.md" -Encoding utf8
gh issue create --repo $repo --title $title5 --body-file "issue5.md"

# Issue 6
$title6 = "[Architecture] Split RuntimeExecutors.ts into smaller modules"
$body6 = @"
### Description
According to the LobeHub Code Style guidelines: *"When a single file grows beyond ~800 lines, consider splitting it into multiple files"*. 

Currently, `RuntimeExecutors.ts` has grown to over 4,200 lines of code, making it difficult to navigate, review, and maintain for both developers and AI agents.

### Location to update
- [apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts](https://github.com/lobehub/lobe-chat/blob/main/apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts)

### Expected Behavior
Refactor this monolithic file by extracting sub-components, helper functions, types, and logic blocks into smaller, focused modules within the `AgentRuntime` directory.
"@
$body6 | Out-File "issue6.md" -Encoding utf8
gh issue create --repo $repo --title $title6 --body-file "issue6.md"
