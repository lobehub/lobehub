# Desktop Local Tools Implementation

## Workflow Overview

1. Define tool interface (Manifest)
2. Define related types
3. Implement Store Action
4. Implement Service Layer
5. Implement Controller (IPC Handler)
6. Update Agent documentation

## Step 1: Define Tool Interface (Manifest)

Location: `src/tools/[tool_category]/index.ts`

```typescript
// src/tools/local-files/index.ts
export const LocalFilesApiName = {
  RenameFile: 'renameFile',
  MoveFile: 'moveFile',
} as const;

export const LocalFilesManifest = {
  api: [
    {
      name: LocalFilesApiName.RenameFile,
      description: 'Rename a local file',
      parameters: {
        type: 'object',
        properties: {
          oldPath: { type: 'string', description: 'Current file path' },
          newName: { type: 'string', description: 'New file name' },
        },
        required: ['oldPath', 'newName'],
      },
    },
  ],
};
```

## Step 2: Define Types

```typescript
// packages/electron-client-ipc/src/types.ts
export interface RenameLocalFileParams {
  oldPath: string;
  newName: string;
}

// src/tools/local-files/type.ts
export interface LocalRenameFileState {
  success: boolean;
  error?: string;
  oldPath: string;
  newPath: string;
}
```

## Step 3: Implement Store Action

```typescript
// src/store/chat/slices/builtinTool/actions/localFile.ts
renameLocalFile: async (id: string, params: RenameLocalFileParams) => {
  const { toggleLocalFileLoading, updatePluginState, internal_updateMessageContent } = get();

  toggleLocalFileLoading(id, true);

  try {
    const result = await localFileService.renameFile(params);

    if (result.success) {
      updatePluginState(id, { success: true, ...result });
      internal_updateMessageContent(id, JSON.stringify({ success: true }));
    } else {
      updatePluginState(id, { success: false, error: result.error });
      internal_updateMessageContent(id, JSON.stringify({ error: result.error }));
    }

    return result.success;
  } catch (e) {
    console.error(e);
    updatePluginState(id, { success: false, error: e.message });
    return false;
  } finally {
    toggleLocalFileLoading(id, false);
  }
},
```

## Step 4: Implement Service Layer

```typescript
// src/services/electron/localFileService.ts
import { ensureElectronIpc } from '@/utils/electron/ipc';

const ipc = ensureElectronIpc();

export const localFileService = {
  renameFile: (params: RenameLocalFileParams) => ipc.localFiles.renameFile(params),
};
```

## Step 5: Implement Controller

```typescript
// apps/desktop/src/main/controllers/LocalFileCtr.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { ControllerModule, IpcMethod } from '@/controllers';

export default class LocalFileCtr extends ControllerModule {
  static override readonly groupName = 'localFiles';

  @IpcMethod()
  async renameFile(params: RenameLocalFileParams) {
    const { oldPath, newName } = params;
    const newPath = path.join(path.dirname(oldPath), newName);

    try {
      await fs.rename(oldPath, newPath);
      return { success: true, newPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
```

## Step 6: Update Agent Documentation

Location: `src/tools/[tool_category]/systemRole.ts`

Add tool description to `<core_capabilities>` and usage guidelines to `<tool_usage_guidelines>`.
