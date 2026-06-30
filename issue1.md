### Description
According to the LobeHub development guidelines (AGENTS.md and .cursor/docs/createStaticStyles_migration_guide.md), createStaticStyles with cssVar.* should be preferred for zero-runtime overhead. Currently, there are several instances in the codebase using the older createStyles method that can be migrated to avoid runtime CSS generation overhead.

### Locations to update
- [src/features/Conversation/Messages/Verify/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/Conversation/Messages/Verify/index.tsx#L14)
- [src/features/EditorCanvas/LinearFilePlugin.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/EditorCanvas/LinearFilePlugin.tsx#L14)
- [src/features/PageEditor/PageEditor.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/PageEditor/PageEditor.tsx#L84)

### Expected Behavior
Refactor these styling blocks to use createStaticStyles where runtime computation is not genuinely required, improving rendering performance.
