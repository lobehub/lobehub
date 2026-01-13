# Page Agent - Architecture & Workflow

This document explains how the Page Agent works, including context tracking, injection, and document manipulation.

## Overview

The Page Agent is a specialized AI agent that helps users create, read, update, and edit documents in the PageEditor. It has access to the current page's content and structure through context injection.

## Architecture Components

### 1. **Page Agent Definition** (`index.ts`)

- **Model**: Claude Sonnet 4.5
- **Plugin**: `lobe-page-agent` (Document manipulation tools)
- **System Role**: Document editing assistant

### 2. **Document Tools** (`src/tools/document/`)

- **Identifier**: `lobe-page-agent`
- **Type**: Built-in tool
- **Capabilities**:
  - `initPage` - Initialize document from Markdown
  - `editTitle` - Edit document title
  - CRUD operations (createNode, updateNode, deleteNode, moveNode)
  - Structure operations (wrapNodes, mergeNodes, splitNode)
  - Table, image, and list operations
  - Snapshot management

### 3. **Context Injection System** (`packages/context-engine/`)

- **Provider**: `PageEditorContextInjector`
- **Purpose**: Inject current page context into conversation
- **Location in Pipeline**: Position 5 (after Agent Builder, before Tool System Role)

## Data Flow - Complete Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                      Page Editor                             │
│  - User edits document with Lexical editor                  │
│  - Document saved in database as JSON (editorData)          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Store Updater (StoreUpdater.tsx)               │
│  - Watches currentDocId changes                             │
│  - Calls: useChatStore.internal_updateActivePageId()        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│          Chat Store (store/chat/slices/message/)            │
│  - Stores activePageId globally                             │
│  - Available to all services via getChatStoreState()        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│            User sends message to Page Agent                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│         Chat Service (services/chat/index.ts)               │
│  1. Gets activePageId from chat store                       │
│  2. Fetches document from file store                        │
│  3. Builds pageEditorContext:                               │
│     - document metadata (id, title, etc.)                   │
│     - content (markdown text)                               │
│     - editorData (Lexical JSON structure)                   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│     Context Engineering (mecha/contextEngineering.ts)       │
│  - Receives pageEditorContext                               │
│  - Passes to context pipeline                               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  PageEditorContextInjector (context-engine/providers/)      │
│  1. Converts Lexical JSON → XML with node IDs               │
│  2. Formats as structured context                           │
│  3. Injects before first user message                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      Model receives:                         │
│  <current_page_context>                                     │
│    <document_metadata>                                      │
│      <id>docs_abc123</id>                                   │
│      <title>My Document</title>                             │
│    </document_metadata>                                     │
│    <document_structure>                                     │
│      <root>                                                 │
│        <h1 id="node_1">                                     │
│          <span id="node_2">Heading Text</span>             │
│        </h1>                                                │
│        <p id="node_3">                                      │
│          <span id="node_4">Paragraph content</span>        │
│        </p>                                                 │
│      </root>                                                │
│    </document_structure>                                    │
│  </current_page_context>                                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Implementation Details

### 1. Active Page Tracking

**Location**: `src/features/PageEditor/StoreUpdater.tsx:145-157`

```typescript
useEffect(() => {
  const activeId = currentDocId || pageId;
  updateActivePageId(activeId);

  return () => {
    updateActivePageId(undefined); // Cleanup on unmount
  };
}, [currentDocId, pageId, updateActivePageId]);
```

**State**: `src/store/chat/slices/message/initialState.ts:17`

```typescript
interface ChatMessageState {
  activePageId?: string; // Current page being edited
  // ... other fields
}
```

### 2. Context Building

**Location**: `src/services/chat/index.ts:217-259`

```typescript
const isPageAgentEnabled = enabledToolIds.includes(PAGE_AGENT_TOOL_ID);

if (isPageAgentEnabled) {
  const activePageId = getChatStoreState().activePageId;
  if (activePageId) {
    const document = documentSelectors.getDocumentById(activePageId)(fileState);

    pageEditorContext = {
      document: {
        id: document.id,
        title: document.title,
        fileType: document.fileType,
        totalCharCount: document.totalCharCount,
        totalLineCount: document.totalLineCount,
      },
      content: document.content || undefined,
      editorData: document.editorData || undefined,
    };
  }
}
```

### 3. Lexical to XML Conversion

**Location**: `packages/context-engine/src/providers/PageEditorContextInjector.ts:32-116`

**Input (Lexical JSON)**:

```json
{
  "root": {
    "type": "root",
    "children": [
      {
        "type": "heading",
        "tag": "h1",
        "children": [{ "type": "text", "text": "Hello World" }]
      }
    ]
  }
}
```

**Output (XML with IDs)**:

```xml
<root>
  <h1 id="node_1">
    <span id="node_2">Hello World</span>
  </h1>
</root>
```

**Supported Node Types**:

- `text` → `<span id="...">`
- `heading` → `<h1-h6 id="...">`
- `paragraph` → `<p id="...">`
- `list` → `<ul/ol id="...">`
- `listitem` → `<li id="...">`
- `quote` → `<blockquote id="...">`
- `code` → `<pre id="..."><code>`
- `link` → `<a id="..." href="...">`
- `image` → `<img id="..." src="..." alt="...">`

### 4. Context Injection

**Location**: `packages/context-engine/src/providers/PageEditorContextInjector.ts:217-237`

**Process**:

1. Check if Page Agent is enabled
2. Check if page context exists
3. Convert Lexical JSON to XML
4. Format as `<current_page_context>`
5. Insert as user message before first user message
6. Mark with metadata: `{ injectType: 'page-editor-context', systemInjection: true }`

## Document Tool Usage

The model can use these tools to manipulate the document:

### Example: Edit Title

```typescript
editTitle({ title: 'New Title' });
```

### Example: Initialize Page

```typescript
initPage({
  markdown: '# Heading\n\nParagraph content',
});
```

### Future: Node Manipulation

Currently disabled for MVP, but will support:

- `updateNode({ nodeId: "node_3", content: "New text" })`
- `deleteNode({ nodeId: "node_5" })`
- `createNode({ type: "p", content: "New paragraph", position: "after", referenceNodeId: "node_3" })`

## Debugging

### Console Logs to Check

1. **Page ID tracking**:

   ```
   [StoreUpdater] Updating activePageId in chat store: docs_abc123
   [ChatStore] Updating activePageId: docs_abc123
   ```

2. **Context building**:

   ```
   [ChatService] isPageAgentEnabled: true
   [ChatService] activePageId: docs_abc123
   [ChatService] Built page editor context: { documentId: '...', hasEditorData: true }
   ```

3. **XML conversion**:

   ```
   [PageEditorContextInjector] Converted Lexical to XML, node count: 15
   [PageEditorContextInjector] XML preview: <root>...
   ```

4. **Injection**:
   ```
   [PageEditorContextInjector] Page Editor context injected successfully
   [PageEditorContextInjector] Total messages after injection: 2
   ```

## Known Limitations

1. **MVP Features**: Only `initPage` and `editTitle` are currently enabled
2. **Node ID Generation**: IDs are generated per-request (not persistent)
3. **No Direct Editing**: Tools can't directly modify editor state (would need integration)
4. **Temp Documents**: Work in progress, IDs may change on save

## Future Enhancements

1. **Enable Full CRUD**: Activate all document manipulation tools
2. **Persistent Node IDs**: Store IDs in editorData for consistency
3. **Real-time Updates**: Sync tool changes back to editor
4. **Collaborative Editing**: Multiple users with conflict resolution
5. **Version History**: Full snapshot system integration

## Related Files

- **Agent Definition**: `packages/builtin-agents/src/agents/page-agent/`
- **Document Tools**: `src/tools/document/`
- **Context Injector**: `packages/context-engine/src/providers/PageEditorContextInjector.ts`
- **Chat Service**: `src/services/chat/index.ts`
- **Store Updater**: `src/features/PageEditor/StoreUpdater.tsx`
- **Chat Store**: `src/store/chat/slices/message/`
- **File Store**: `src/store/file/slices/document/`
