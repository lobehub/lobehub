### Description
While @ts-expect-error and ny types are sometimes necessary in test files to mock edge cases, they are currently bleeding into production files. This suppresses potential runtime errors and degrades overall type safety.

### Locations to update
- [src/components/server/ServerLayout.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/components/server/ServerLayout.tsx#L17)
- [src/features/NavPanel/components/BackButton.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/NavPanel/components/BackButton.tsx#L18)
- [src/libs/better-auth/sso/index.ts](https://github.com/lobehub/lobe-chat/blob/main/src/libs/better-auth/sso/index.ts#L94)

### Expected Behavior
Review these instances and replace them with proper TypeScript typings and interfaces.
