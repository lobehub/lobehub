### Description
The contribution guidelines state that component priority should be @lobehub/ui/base-ui (headless primitives) first. However, the codebase still imports components like Modal and Select directly from ntd or the root @lobehub/ui package. This breaks encapsulation and inflates the bundle size unnecessarily.

### Locations to update
**antd imports:**
- [src/features/Electron/updater/UpdateNotification.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/Electron/updater/UpdateNotification.tsx#L4)
- [src/features/ResourceManager/components/Editor/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/ResourceManager/components/Editor/index.tsx#L4)
- [src/routes/(main)/community/(detail)/workspace/features/WorkspaceStatusFilter.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/routes/(main)/community/(detail)/workspace/features/WorkspaceStatusFilter.tsx#L3)

**@lobehub/ui root imports (should be base-ui):**
- [src/features/DocumentModal/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/features/DocumentModal/index.tsx#L3)
- [src/routes/(main)/agent/profile/features/AgentSettings/index.tsx](https://github.com/lobehub/lobe-chat/blob/main/src/routes/(main)/agent/profile/features/AgentSettings/index.tsx#L3)

### Expected Behavior
Update the import paths for primitives like Modal, Select, DropdownMenu, etc., to @lobehub/ui/base-ui across these components.
