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
lh kb view [fields]] < id > [--json
```

**Displays**: Name, description, full directory tree with all files and documents (recursively fetched). Shows indented tree structure with item type (File/Doc), file type, and size.

**API**: Uses `file.getKnowledgeItems` to recursively fetch items. Folders (`custom/folder` fileType) are traversed in parallel via `Promise.all` for performance.

### `lh kb create`

```bash
lh kb create -n [--avatar < name > [-d < desc > ] < url > ]
```

| Option                     | Description         | Required |
| -------------------------- | ------------------- | -------- |
| `-n, --name <name>`        | Knowledge base name | Yes      |
| `-d, --description <desc>` | Description         | No       |
| `--avatar <url>`           | Avatar URL          | No       |

**Output**: Created KB ID. Note: backend returns ID as a string directly (not an object).

### `lh kb edit <id>`

```bash
lh kb edit [-d [--avatar < id > [-n < name > ] < desc > ] < url > ]
```

Requires at least one change flag. Errors if none specified.

### `lh kb delete <id>`

```bash
lh kb delete [--yes] < id > [--remove-files]
```

| Option           | Description                  |
| ---------------- | ---------------------------- |
| `--remove-files` | Also delete associated files |
| `--yes`          | Skip confirmation            |

### `lh kb add-files <knowledgeBaseId>`

```bash
lh kb add-files <kbId> --ids <fileId1> <fileId2> ...
```

Link existing files to a knowledge base.

### `lh kb remove-files <knowledgeBaseId>`

```bash
lh kb remove-files <kbId> --ids <fileId1> <fileId2> ... [--yes]
```

Unlink files from a knowledge base.

### `lh kb mkdir <knowledgeBaseId>`

```bash
lh kb mkdir < kbId > -n < name > [--parent < folderId > ]
```

Create a folder in a knowledge base. Uses `document.createDocument` with `fileType: 'custom/folder'`.

| Option                | Description      | Required |
| --------------------- | ---------------- | -------- |
| `-n, --name <name>`   | Folder name      | Yes      |
| `--parent <parentId>` | Parent folder ID | No       |

### `lh kb create-doc <knowledgeBaseId>`

```bash
lh kb create-doc [--parent < kbId > -t < title > [-c < content > ] < folderId > ]
```

Create a document in a knowledge base. Uses `document.createDocument` with `fileType: 'custom/document'`.

| Option                 | Description      | Required |
| ---------------------- | ---------------- | -------- |
| `-t, --title <title>`  | Document title   | Yes      |
| `-c, --content <text>` | Document content | No       |
| `--parent <parentId>`  | Parent folder ID | No       |

### `lh kb move <id>`

```bash
lh kb move < id > --type < file | doc > [--parent < folderId > ]
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
lh file list [--kb-id [-L [--json [fields]] < id > ] < n > ]
```

| Option            | Description              | Default |
| ----------------- | ------------------------ | ------- |
| `--kb-id <id>`    | Filter by knowledge base | -       |
| `-L, --limit <n>` | Maximum items            | `30`    |

**Table columns**: ID, NAME, TYPE, SIZE, UPDATED

### `lh file view <id>`

```bash
lh file view [fields]] < id > [--json
```

**Displays**: Name, type, size, chunking status, embedding status.

### `lh file delete <ids...>`

```bash
lh file delete [--yes] < id1 > [id2...]
```

Supports deleting multiple files at once.

### `lh file recent`

```bash
lh file recent [-L [--json [fields]] < n > ]
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
lh doc list [-L [--file-type [--json [fields]] < n > ] < type > ]
```

| Option               | Description         | Default |
| -------------------- | ------------------- | ------- |
| `-L, --limit <n>`    | Maximum items       | `30`    |
| `--file-type <type>` | Filter by file type | -       |

**Table columns**: ID, TITLE, TYPE, UPDATED

### `lh doc view <id>`

```bash
lh doc view [fields]] < id > [--json
```

**Displays**: Title, type, updated time, full content.

### `lh doc create`

```bash
lh doc create -t [-F [--parent [--slug < title > [-b < body > ] < path > ] < id > ] < slug > ]
```

| Option                   | Description         | Required |
| ------------------------ | ------------------- | -------- |
| `-t, --title <title>`    | Document title      | Yes      |
| `-b, --body <content>`   | Document body text  | No       |
| `-F, --body-file <path>` | Read body from file | No       |
| `--parent <id>`          | Parent document ID  | No       |
| `--slug <slug>`          | Custom URL slug     | No       |

`-b` and `-F` are mutually exclusive; `-F` reads the file content as the body.

### `lh doc edit <id>`

```bash
lh doc edit [-b [-F [--parent < id > [-t < title > ] < body > ] < path > ] < id > ]
```

### `lh doc delete <ids...>`

```bash
lh doc delete [--yes] < id1 > [id2...]
```
