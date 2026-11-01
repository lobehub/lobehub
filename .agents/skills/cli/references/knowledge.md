# Knowledge Base, File & Document Commands

## Knowledge Base (`lh kb`)

Manage knowledge bases for RAG (Retrieval-Augmented Generation). Supports directory tree structure with folders, documents, and file uploads.

**Source**: `apps/cli/src/commands/kb.ts`

### `lh kb list`

```bash
lh kb list [--json [fields]]
```

**Table columns**: ID, NAME, DESCRIPTION, UPDATED

### `lh kb view <id>`

```bash
lh kb view <id> [--json [fields]]
```

**Displays**: Name, description, full directory tree with all files and documents (recursively fetched). Shows indented tree structure with item type (File/Doc), file type, and size.

**API**: Uses `file.getKnowledgeItems` to recursively fetch items. Folders (`custom/folder` fileType) are traversed in parallel via `Promise.all` for performance.

### `lh kb create`

```bash
lh kb create -n <name> [-d <desc>] [--avatar <url>]
```

| Option                     | Description         | Required |
| -------------------------- | ------------------- | -------- |
| `-n, --name <name>`        | Knowledge base name | Yes      |
| `-d, --description <desc>` | Description         | No       |
| `--avatar <url>`           | Avatar URL          | No       |

**Output**: Created KB ID. Note: backend returns ID as a string directly (not an object).

### `lh kb edit <id>`

```bash
lh kb edit <id> [-n <name>] [-d <desc>] [--avatar <url>]
```

Requires at least one change flag. Errors if none specified.

### `lh kb delete <id>`

```bash
lh kb delete <id> [--remove-files] [--yes]
```

| Option           | Description                  |
| ---------------- | ---------------------------- |
| `--remove-files` | Also delete associated files |
| `--yes`          | Skip confirmation            |

### `lh kb add-files <knowledgeBaseId>`

```bash
lh kb add-files <kbId> --ids <fileId1> [fileId2...]
```

Link existing files to a knowledge base.

### `lh kb remove-files <knowledgeBaseId>`

```bash
lh kb remove-files <kbId> --ids <fileId1> [fileId2...] [--yes]
```

Unlink files from a knowledge base.

### `lh kb mkdir <knowledgeBaseId>`

```bash
lh kb mkdir <kbId> -n <name> [--parent <folderId>]
```

Create a folder in a knowledge base. Uses `document.createDocument` with `fileType: 'custom/folder'`.

| Option                | Description      | Required |
| --------------------- | ---------------- | -------- |
| `-n, --name <name>`   | Folder name      | Yes      |
| `--parent <parentId>` | Parent folder ID | No       |

### `lh kb create-doc <knowledgeBaseId>`

```bash
lh kb create-doc <kbId> -t <title> [-c <content>] [--parent <folderId>]
```

Create a document in a knowledge base. Uses `document.createDocument` with `fileType: 'custom/document'`.

| Option                 | Description      | Required |
| ---------------------- | ---------------- | -------- |
| `-t, --title <title>`  | Document title   | Yes      |
| `-c, --content <text>` | Document content | No       |
| `--parent <parentId>`  | Parent folder ID | No       |

### `lh kb move <id>`

```bash
lh kb move <id> [--type <file|doc>] [--parent <folderId>]
```

Move a file or document to a different folder (or to root if `--parent` is omitted).

| Option                | Description                      | Default |
| --------------------- | -------------------------------- | ------- |
| `--type <type>`       | Item type: `file` or `doc`       | `file`  |
| `--parent <parentId>` | Target folder ID (omit for root) | -       |

Uses `document.updateDocument` for docs, `file.updateFile` for files.

### `lh kb upload <knowledgeBaseId> <filePath>`

```bash
lh kb upload <kbId> <filePath> [--parent <folderId>]
```

Upload a local file to a knowledge base via S3 presigned URL.

| Option                | Description      |
| --------------------- | ---------------- |
| `--parent <parentId>` | Parent folder ID |

**Flow**: Compute SHA-256 hash → get presigned URL via `upload.createS3PreSignedUrl` → PUT to S3 → create file record via `file.createFile`.

---

## File Management (`lh file`)

Manage uploaded files.

**Source**: `apps/cli/src/commands/file.ts`

### `lh file list`

```bash
lh file list [--kb-id <id>] [-L <n>] [--json [fields]]
```

| Option            | Description              | Default |
| ----------------- | ------------------------ | ------- |
| `--kb-id <id>`    | Filter by knowledge base | -       |
| `-L, --limit <n>` | Maximum items            | `30`    |

**Table columns**: ID, NAME, TYPE, SIZE, UPDATED

### `lh file view <id>`

```bash
lh file view <id> [--json [fields]]
```

**Displays**: Name, type, size, chunking status, embedding status.

### `lh file delete <ids...>`

```bash
lh file delete <id1> [id2...] [--yes]
```

Supports deleting multiple files at once.

### `lh file recent`

```bash
lh file recent [-L <n>] [--json [fields]]
```

| Option            | Description     | Default |
| ----------------- | --------------- | ------- |
| `-L, --limit <n>` | Number of items | `10`    |

---

## Document Management (`lh doc`)

Manage text documents (notes, wiki pages).

**Source**: `apps/cli/src/commands/doc.ts`

### `lh doc list`

```bash
lh doc list [-L <n>] [--file-type <type>] [--source-type <type>] [--json [fields]]
```

| Option                 | Description                                   | Default |
| ---------------------- | --------------------------------------------- | ------- |
| `-L, --limit <n>`      | Maximum items                                 | `30`    |
| `--file-type <type>`   | Filter by file type                           | -       |
| `--source-type <type>` | Filter by source type (file, web, api, topic) | -       |

**Table columns**: ID, TITLE, TYPE, UPDATED

### `lh doc view <id>`

```bash
lh doc view <id> [--json [fields]]
```

**Displays**: Title, type, KB association, updated time, full content.

### `lh doc create`

```bash
lh doc create -t <title> [-b <content>] [-F <path>] [--parent <id>] [--slug <slug>] [--kb <id>] [--file-type <type>]
```

| Option                   | Description                                     | Required |
| ------------------------ | ----------------------------------------------- | -------- |
| `-t, --title <title>`    | Document title                                  | Yes      |
| `-b, --body <content>`   | Document body text                              | No       |
| `-F, --body-file <path>` | Read body from file                             | No       |
| `--parent <id>`          | Parent document ID                              | No       |
| `--slug <slug>`          | Custom URL slug                                 | No       |
| `--kb <id>`              | Knowledge base ID to associate with             | No       |
| `--file-type <type>`     | File type (e.g. custom/document, custom/folder) | No       |

`-b` and `-F` are mutually exclusive; `-F` reads the file content as the body.

### `lh doc batch-create <file>`

Batch create documents from a JSON file. The file must contain a non-empty array of document objects.

```bash
lh doc batch-create documents.json
```

Each object in the array can have: `title`, `content`, `fileType`, `knowledgeBaseId`, `parentId`, `slug`.

### `lh doc edit <id>`

```bash
lh doc edit <id> [-t <title>] [-b <content>] [-F <path>] [--parent <id>] [--file-type <type>]
```

### `lh doc delete <ids...>`

```bash
lh doc delete <id1> [id2...] [--yes]
```

### `lh doc parse <fileId>`

Parse an uploaded file into a document.

```bash
lh doc parse <fileId> [--with-pages] [--json [fields]]
```

| Option         | Description             |
| -------------- | ----------------------- |
| `--with-pages` | Preserve page structure |

**Output**: Parsed title and content preview.

### `lh doc link-topic <docId> <topicId>`

Associate a document with a topic. Creates a linked copy via the notebook router.

```bash
lh doc link-topic <docId> <topicId>
```

### `lh doc topic-docs <topicId>`

List documents associated with a topic.

```bash
lh doc topic-docs <topicId> [--type <type>] [--json [fields]]
```

| Option          | Description                                      |
| --------------- | ------------------------------------------------ |
| `--type <type>` | Filter by type (article, markdown, note, report) |
