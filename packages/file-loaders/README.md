# @lobechat/file-loaders

`@lobechat/file-loaders` is a toolkit within the LobeHub project, specifically designed for loading various types of files from local file paths and converting their content into standardized `Document` object arrays.

Its primary purpose is to provide a unified interface for reading different file formats, extracting their core text content, and preparing them for subsequent processing (such as file preview, content extraction, or serving as knowledge base data sources in LobeHub).

## ✨ Features

- **Unified Interface**: Provides `loadFile(filePath: string)` function as the core entry point.
- **Automatic Type Detection**: Automatically selects appropriate loading methods based on file extensions.
- **Extensive Format Support**:
  - **Plain Text**: `.txt`, `.csv`, `.md`, `.json`, `.xml`, `.yaml`, `.html` and various code and configuration file formats.
  - **PDF**: `.pdf` files.
  - **Word**: `.docx` files.
  - **Excel**: `.xlsx`, `.xls` files, with each worksheet as a `Page`.
  - **PowerPoint**: `.pptx` files, with each slide as a `Page`.
- **Standardized Output**: Always returns `Promise<Document>`. A `Document` object represents a loaded file, containing an array of `Page` objects that represent the logical units of the file (pages, slides, worksheets, text blocks, etc.).
- **Hierarchical Structure**: Uses a structure where `Document` contains `Page[]`, better reflecting the original organization of the file.
- **Rich Metadata**: Provides detailed metadata at both `Document` and `Page` levels, including file information, content statistics, and structural information.

## Core Data Structures

The `loadFile` function returns a `FileDocument` object containing file-level information and all its logical pages/blocks (`DocumentPage`).

### `FileDocument` Interface

| Field             | Type              | Description                                                                           |
| :---------------- | :---------------- | :------------------------------------------------------------------------------------ |
| `content`         | `string`          | File content (aggregated content)                                                     |
| `createdTime`     | `Date`            | File creation timestamp.                                                              |
| `fileType`        | `string`          | File type or extension.                                                               |
| `filename`        | `string`          | Original filename.                                                                    |
| `metadata`        | `object`          | File-level metadata.                                                                  |
| `metadata.author` | `string?`         | Document author (if available).                                                       |
| `metadata.error`  | `string?`         | Error information if the entire file loading failed.                                  |
| `metadata.title`  | `string?`         | Document title (if available).                                                        |
| `...`             | `any`             | Other file-level metadata.                                                            |
| `modifiedTime`    | `Date`            | File last modified timestamp.                                                         |
| `pages`           | `DocumentPage[]?` | Array containing all logical pages/blocks in the document (optional).                 |
| `source`          | `string`          | Full path of the original file.                                                       |
| `totalCharCount`  | `number`          | Total character count of the entire document (sum of all `DocumentPage` `charCount`). |
| `totalLineCount`  | `number`          | Total line count of the entire document (sum of all `DocumentPage` `lineCount`).      |

### `DocumentPage` Interface

| Field                      | Type      | Description                                     |
| :------------------------- | :-------- | :---------------------------------------------- |
| `charCount`                | `number`  | Character count of this page/block content.     |
| `lineCount`                | `number`  | Line count of this page/block content.          |
| `metadata`                 | `object`  | Metadata related to this page/block.            |
| `metadata.chunkIndex`      | `number?` | Current chunk index if split into chunks.       |
| `metadata.error`           | `string?` | Error occurred when processing this page/block. |
| `metadata.lineNumberEnd`   | `number?` | End line number in the original file.           |
| `metadata.lineNumberStart` | `number?` | Start line number in the original file.         |
| `metadata.pageNumber`      | `number?` | Page number (applicable to PDF, DOCX).          |
| `metadata.sectionTitle`    | `string?` | Related section title.                          |
| `metadata.sheetName`       | `string?` | Worksheet name (applicable to XLSX).            |
| `metadata.slideNumber`     | `number?` | Slide number (applicable to PPTX).              |
| `metadata.totalChunks`     | `number?` | Total chunks if split into chunks.              |
| `...`                      | `any`     | Other page/block-specific metadata.             |
| `pageContent`              | `string`  | Core text content of this page/block.           |

## 🤝 Contribution

File formats and parsing requirements are constantly evolving. We welcome community contributions to expand format support and improve parsing accuracy. You can participate in improvements through:

### How to Contribute

1. **New File Format Support**: Add support for additional file types
2. **Parser Improvements**: Enhance existing parsers for better content extraction
3. **Metadata Enhancement**: Improve metadata extraction capabilities
4. **Performance Optimization**: Optimize file loading and processing performance

### Contribution Process

1. Fork the [LobeHub repository](https://github.com/lobehub/lobe-chat)
2. Add new format support or improve existing parsers
3. Submit a Pull Request describing:

- New file formats supported or improvements made
- Testing with various file samples
- Performance impact analysis
- Documentation updates

## 📌 Note

This is an internal module of LobeHub (`"private": true`), designed specifically for LobeHub and not published as a standalone package.

If you're interested in our project, feel free to check it out, star it, or contribute code on [GitHub](https://github.com/lobehub/lobe-chat)!
