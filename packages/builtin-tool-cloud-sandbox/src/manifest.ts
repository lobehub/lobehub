import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CloudSandboxApiName } from './types';

export const CloudSandboxIdentifier = 'lobe-cloud-sandbox';

export const CloudSandboxManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Execute code directly in the sandbox environment. Supports Python, JavaScript, and TypeScript. Returns execution output, errors, and exit code.',
      humanIntervention: 'required',
      name: CloudSandboxApiName.executeCode,
      parameters: {
        properties: {
          description: {
            description:
              'A brief description of what this code does (required for user understanding)',
            type: 'string',
          },
          language: {
            description: 'Programming language: python (default), javascript, or typescript',
            enum: ['python', 'javascript', 'typescript'],
            type: 'string',
          },
          code: {
            description: 'The code to execute',
            type: 'string',
          },
        },
        required: ['description', 'language', 'code'],
        type: 'object',
      },
    },
    {
      description:
        'List files and folders in a specified directory. Input should be a path. Output is a JSON array of file/folder names.',
      name: CloudSandboxApiName.listLocalFiles,
      parameters: {
        properties: {
          directoryPath: {
            description: 'The directory path to list',
            type: 'string',
          },
        },
        required: ['directoryPath'],
        type: 'object',
      },
    },
    {
      description:
        'Read the content of a specific file. Input should be the file path. Output is the file content as a string.',
      name: CloudSandboxApiName.readLocalFile,
      parameters: {
        properties: {
          endLine: {
            description: 'End line number (1-based, inclusive)',
            type: 'number',
          },
          path: {
            description: 'The file path to read',
            type: 'string',
          },
          startLine: {
            description: 'Start line number (1-based)',
            type: 'number',
          },
        },
        required: ['path'],
        type: 'object',
      },
    },
    {
      description: 'Search for files within the sandbox based on keywords and filter options.',
      name: CloudSandboxApiName.searchLocalFiles,
      parameters: {
        properties: {
          directory: {
            description: 'Directory to search in',
            type: 'string',
          },
          fileType: {
            description: 'File type/extension filter',
            type: 'string',
          },
          keyword: {
            description: 'Filename keyword filter',
            type: 'string',
          },
          modifiedAfter: {
            description: 'Modified time lower bound (ISO date string)',
            type: 'string',
          },
          modifiedBefore: {
            description: 'Modified time upper bound (ISO date string)',
            type: 'string',
          },
        },
        required: ['directory'],
        type: 'object',
      },
    },
    {
      description:
        'Moves or renames multiple files/directories. Input is an array of operations with source and destination paths.',
      humanIntervention: 'required',
      name: CloudSandboxApiName.moveLocalFiles,
      parameters: {
        properties: {
          operations: {
            description: 'A list of move operations to perform.',
            items: {
              properties: {
                destination: {
                  description: 'The target path for the file/directory.',
                  type: 'string',
                },
                source: {
                  description: 'The current path of the file/directory to move.',
                  type: 'string',
                },
              },
              required: ['source', 'destination'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['operations'],
        type: 'object',
      },
    },
    {
      description:
        'Rename a file or folder in its current location. Input should be the current full path and the new name.',
      name: CloudSandboxApiName.renameLocalFile,
      parameters: {
        properties: {
          newName: {
            description: 'The new name for the file or folder (filename only, not full path)',
            type: 'string',
          },
          oldPath: {
            description: 'The current full path of the file or folder to rename',
            type: 'string',
          },
        },
        required: ['oldPath', 'newName'],
        type: 'object',
      },
    },
    {
      description:
        'Write content to a specific file. Input should be the file path and content. Overwrites existing file or creates a new one.',
      humanIntervention: 'required',
      name: CloudSandboxApiName.writeLocalFile,
      parameters: {
        properties: {
          content: {
            description: 'The content to write',
            type: 'string',
          },
          createDirectories: {
            description: 'Whether to create parent directories if they do not exist',
            type: 'boolean',
          },
          path: {
            description: 'The file path to write to',
            type: 'string',
          },
        },
        required: ['path', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Perform exact string replacements in files. Must read the file first before editing.',
      humanIntervention: 'required',
      name: CloudSandboxApiName.editLocalFile,
      parameters: {
        properties: {
          all: {
            description: 'Replace all occurrences (default: false)',
            type: 'boolean',
          },
          path: {
            description: 'The absolute path to the file to modify',
            type: 'string',
          },
          replace: {
            description: 'The text to replace with (must differ from search)',
            type: 'string',
          },
          search: {
            description: 'The exact text to search for',
            type: 'string',
          },
        },
        required: ['path', 'search', 'replace'],
        type: 'object',
      },
    },
    {
      description:
        'Execute a shell command and return its output. Supports both synchronous and background execution with timeout control.',
      humanIntervention: 'required',
      name: CloudSandboxApiName.runCommand,
      parameters: {
        properties: {
          description: {
            description:
              'A brief description of what this code does (required for user understanding)',
            type: 'string',
          },
          background: {
            description: 'Set to true to run command in background and return commandId',
            type: 'boolean',
          },
          command: {
            description: 'The shell command to execute',
            type: 'string',
          },
          timeout: {
            description: 'Timeout in milliseconds (default: 120000ms)',
            type: 'number',
          },
        },
        required: ['description', 'command'],
        type: 'object',
      },
    },
    {
      description:
        'Retrieve output from a running or completed background shell command. Returns only new output since the last check.',
      name: CloudSandboxApiName.getCommandOutput,
      parameters: {
        properties: {
          commandId: {
            description: 'The ID of the background command to retrieve output from',
            type: 'string',
          },
        },
        required: ['commandId'],
        type: 'object',
      },
    },
    {
      description: 'Kill a running background shell command by its ID.',
      name: CloudSandboxApiName.killCommand,
      parameters: {
        properties: {
          commandId: {
            description: 'The ID of the background command to kill',
            type: 'string',
          },
        },
        required: ['commandId'],
        type: 'object',
      },
    },
    {
      description:
        'Search for content within files using regex patterns. Supports various output modes and filtering options.',
      name: CloudSandboxApiName.grepContent,
      parameters: {
        properties: {
          directory: {
            description: 'Directory to search in',
            type: 'string',
          },
          filePattern: {
            description: 'File name pattern filter (e.g., "*.ts")',
            type: 'string',
          },
          pattern: {
            description: 'The regex pattern to search for',
            type: 'string',
          },
          recursive: {
            description: 'Whether to search recursively (default: true)',
            type: 'boolean',
          },
        },
        required: ['pattern', 'directory'],
        type: 'object',
      },
    },
    {
      description:
        'Find files matching glob patterns. Supports standard glob syntax like "**/*.js" or "src/**/*.ts".',
      name: CloudSandboxApiName.globLocalFiles,
      parameters: {
        properties: {
          directory: {
            description: 'The base directory to search in (defaults to current working directory)',
            type: 'string',
          },
          pattern: {
            description: 'The glob pattern to match files against (e.g. "**/*.js", "*.{ts,tsx}")',
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    },
    {
      description:
        'Export a file from the sandbox to cloud storage. The file will be uploaded to a pre-signed URL and can be downloaded by the user.',
      name: CloudSandboxApiName.exportFile,
      parameters: {
        properties: {
          path: {
            description:
              'The path of the file in the sandbox to export (e.g., "./output/result.csv")',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    },
  ],
  identifier: CloudSandboxIdentifier,
  meta: {
    avatar: '💻',
    description: 'Execute code, run commands, and manage files in a secure cloud environment',
    readme:
      'Execute Python, JavaScript, and TypeScript code in an isolated cloud environment. Run shell commands, manage files, search content with regex, and export results securely.',
    title: 'Cloud Sandbox',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

export { CloudSandboxApiName } from './types';
