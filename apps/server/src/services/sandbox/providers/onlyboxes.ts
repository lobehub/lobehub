import { createHmac } from 'node:crypto';

import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import { isRecord } from '@lobechat/utils';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { appEnv } from '@/envs/app';
import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxServiceOptions,
} from '../types';

const log = debug('lobe-server:sandbox:onlyboxes');

const DEFAULT_TIMEOUT_MS = 120_000;
const EXPORT_TASK_WAIT_MS = 60_000;
const DEFAULT_LEASE_TTL_SEC = 900;
const DEFAULT_JIT_TTL_SEC = 1800;
const JIT_TOKEN_PREFIX = 'obx_jit_v1.';
const WRITE_FILE_CHUNK_BYTES = 48 * 1024;
const SKILL_ARCHIVE_CACHE_DIR = '/tmp/lobe-skills';

interface OnlyboxesTaskResponse {
  error?: { code?: string; message?: string };
  result?: Record<string, unknown>;
  status?: string;
  task_id?: string;
}

interface TerminalExecResult {
  created?: boolean;
  exit_code?: number;
  lease_expires_unix_ms?: number;
  session_id?: string;
  stderr?: string;
  stderr_truncated?: boolean;
  stdout?: string;
  stdout_truncated?: boolean;
}

export class OnlyboxesSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: true,
    shell: true,
    skillScripts: true,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'onlyboxes';

  private readonly baseUrl: string;
  private readonly jitIssuer: string;
  private readonly jitSigningKey: string;
  private readonly jitTTLSec: number;
  private readonly leaseTTLSec: number;
  private readonly options: SandboxServiceOptions;

  constructor(options: SandboxServiceOptions) {
    this.options = options;
    this.baseUrl = (sandboxEnv.ONLYBOXES_BASE_URL || '').replace(/\/+$/, '');
    this.jitIssuer = sandboxEnv.ONLYBOXES_JIT_ISSUER || appEnv.APP_URL || 'lobehub';
    this.jitSigningKey = sandboxEnv.ONLYBOXES_JIT_SIGNING_KEY || '';
    this.jitTTLSec = sandboxEnv.ONLYBOXES_JIT_TTL_SEC || DEFAULT_JIT_TTL_SEC;
    this.leaseTTLSec = sandboxEnv.ONLYBOXES_LEASE_TTL_SEC || DEFAULT_LEASE_TTL_SEC;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    if (!this.baseUrl || !this.jitSigningKey) {
      return this.errorResult('ONLYBOXES_BASE_URL and ONLYBOXES_JIT_SIGNING_KEY are required');
    }

    try {
      switch (toolName) {
        case 'runCommand': {
          return this.runCommand(params);
        }

        case 'getCommandOutput': {
          return this.getCommandOutput(params);
        }

        case 'killCommand': {
          return this.killCommand(params);
        }

        case 'executeCode': {
          return this.executeCode(params);
        }

        case 'execScript': {
          return this.execScript(params);
        }

        case 'listLocalFiles': {
          return this.runJsonScript(listFilesScript, params);
        }

        case 'listFiles': {
          return this.runJsonScript(listFilesScript, params);
        }

        case 'readLocalFile': {
          return this.runJsonScript(readFileScript, params);
        }

        case 'readFile': {
          return this.runJsonScript(readFileScript, params);
        }

        case 'writeLocalFile': {
          return this.writeLocalFile(params);
        }

        case 'writeFile': {
          return this.writeLocalFile(params);
        }

        case 'editLocalFile': {
          return this.runJsonScript(editFileScript, params);
        }

        case 'editFile': {
          return this.runJsonScript(editFileScript, params);
        }

        case 'searchLocalFiles': {
          return this.runJsonScript(searchFilesScript, params);
        }

        case 'searchFiles': {
          return this.runJsonScript(searchFilesScript, params);
        }

        case 'moveLocalFiles': {
          return this.runJsonScript(moveFilesScript, params);
        }

        case 'moveFiles': {
          return this.runJsonScript(moveFilesScript, params);
        }

        case 'grepContent': {
          return this.runJsonScript(grepContentScript, params);
        }

        case 'globLocalFiles': {
          return this.runJsonScript(globFilesScript, params);
        }

        case 'globFiles': {
          return this.runJsonScript(globFilesScript, params);
        }

        default: {
          return this.errorResult(`Unsupported Onlyboxes sandbox tool: ${toolName}`);
        }
      }
    } catch (error) {
      log('Onlyboxes tool %s failed: %O', toolName, error);
      return this.errorResult((error as Error).message, (error as Error).name);
    }
  }

  async exportFileToUploadUrl({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    if (!this.baseUrl || !this.jitSigningKey) {
      return {
        error: { message: 'ONLYBOXES_BASE_URL and ONLYBOXES_JIT_SIGNING_KEY are required' },
        success: false,
      };
    }

    try {
      await this.ensureSession();

      const task = await this.submitTask('terminalResource', {
        action: 'export',
        file_path: path,
        headers: uploadHeaders,
        session_id: this.sessionId,
        signed_url: uploadUrl,
      });

      if (task.status !== 'succeeded') {
        return {
          error: { message: task.error?.message || 'Failed to export file from Onlyboxes sandbox' },
          success: false,
        };
      }

      return {
        mimeType: String(task.result?.mime_type || ''),
        result: task.result,
        size: typeof task.result?.size_bytes === 'number' ? task.result.size_bytes : undefined,
        success: true,
      };
    } catch (error) {
      log('Onlyboxes export failed: %O', error);
      return {
        error: { message: (error as Error).message },
        success: false,
      };
    }
  }

  private get sessionId() {
    const scope = `${this.options.userId}-${this.options.topicId}`;
    return `lobe-${scope.replaceAll(/[^\w.-]/g, '-')}`;
  }

  private async executeCode(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const code = String(params.code || '');
    const language = String(params.language || 'python');

    const runners: Record<string, string> = {
      javascript: 'node',
      python: 'python3',
      typescript: 'npx --yes tsx',
    };
    const extensions: Record<string, string> = {
      javascript: 'js',
      python: 'py',
      typescript: 'ts',
    };
    const runner = runners[language];

    if (!runner) {
      return this.errorResult(`Unsupported code language for Onlyboxes sandbox: ${language}`);
    }

    const filePath = `/tmp/lobe-code-${Date.now()}.${extensions[language]}`;
    const writeResult = await this.writeTextFile({
      content: code,
      createDirectories: true,
      path: filePath,
      timeoutMs: this.timeout(params),
    });

    if (!writeResult.success) {
      return writeResult;
    }

    const command = `${runner} '${filePath}'`;
    const terminal = await this.execTerminal(command, this.timeout(params));

    return {
      result: {
        error: terminal.exit_code === 0 ? undefined : terminal.stderr,
        exitCode: terminal.exit_code,
        output: terminal.stdout,
        stderr: terminal.stderr,
      },
      success: true,
    };
  }

  private async execScript(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    const skillZipUrls = this.resolveExecScriptZipUrls(params);
    const timeoutMs = this.timeout(params);

    if (Object.keys(skillZipUrls).length === 0) {
      return this.runCommand({ command, timeout: timeoutMs });
    }

    const defaultSkillName = this.resolveExecScriptSkillName(params, skillZipUrls);
    const workspaceDir = this.skillWorkspaceDir(skillZipUrls);
    const setupCommand = this.buildSkillSetupCommand({ skillZipUrls, workspaceDir });
    const setup = await this.execTerminal(setupCommand, timeoutMs);

    if (setup.exit_code !== 0) {
      return {
        error: { message: setup.stderr || setup.stdout || 'Failed to prepare skill resources' },
        result: {
          exitCode: setup.exit_code,
          output: setup.stdout,
          stderr: setup.stderr,
        },
        success: false,
      };
    }

    const runDir = defaultSkillName
      ? `${workspaceDir}/${this.safeSkillDirName(defaultSkillName)}`
      : workspaceDir;
    const result = await this.execTerminal(
      `cd ${this.shellQuote(runDir)} && ${command}`,
      timeoutMs,
    );

    return {
      result: {
        commandId: result.session_id,
        exitCode: result.exit_code,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exit_code === 0,
      },
      success: true,
    };
  }

  private async runCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const command = String(params.command || '');

    if (!command.trim()) {
      return this.errorResult('command is required');
    }

    if (params.background === true) {
      const task = await this.submitTask(
        'terminalExec',
        {
          command,
          create_if_missing: true,
          lease_ttl_sec: this.leaseTTLSec,
          session_id: this.sessionId,
        },
        { mode: 'async', timeoutMs: this.timeout(params) },
      );

      if (task.error || !task.task_id) {
        return this.errorResult(
          task.error?.message || task.error?.code || 'Failed to start Onlyboxes background command',
        );
      }

      return {
        result: {
          commandId: task.task_id,
          shell_id: task.task_id,
        },
        success: true,
      };
    }

    const terminal = await this.execTerminal(command, this.timeout(params));

    return {
      result: {
        commandId: terminal.session_id,
        exitCode: terminal.exit_code,
        output: terminal.stdout,
        stderr: terminal.stderr,
        stdout: terminal.stdout,
        success: terminal.exit_code === 0,
      },
      success: true,
    };
  }

  private resolveExecScriptZipUrls(params: Record<string, unknown>) {
    const zipUrl = typeof params.zipUrl === 'string' ? params.zipUrl : undefined;
    if (zipUrl) return { [this.resolveLegacyExecScriptSkillName(params)]: zipUrl };

    if (!isRecord(params.skillZipUrls)) return {};

    const result: Record<string, string> = {};

    for (const [name, value] of Object.entries(params.skillZipUrls)) {
      if (typeof value === 'string' && value) {
        result[name] = value;
      }
    }

    return result;
  }

  private resolveLegacyExecScriptSkillName(params: Record<string, unknown>) {
    const configName = isRecord(params.config) ? params.config.name : undefined;
    if (typeof configName === 'string' && configName) return configName;

    if (Array.isArray(params.activatedSkills)) {
      for (const skill of [...params.activatedSkills].reverse()) {
        if (!isRecord(skill)) continue;

        const name = typeof skill.name === 'string' ? skill.name : undefined;
        if (name) return name;
      }
    }

    return 'default';
  }

  private resolveExecScriptSkillName(
    params: Record<string, unknown>,
    skillZipUrls: Record<string, string>,
  ) {
    const configName = isRecord(params.config) ? params.config.name : undefined;
    if (typeof configName === 'string' && skillZipUrls[configName]) return configName;

    if (Array.isArray(params.activatedSkills)) {
      for (const skill of [...params.activatedSkills].reverse()) {
        if (!isRecord(skill)) continue;

        const name = typeof skill.name === 'string' ? skill.name : undefined;
        if (name && skillZipUrls[name]) return name;
      }
    }

    const [firstName] = Object.keys(skillZipUrls);
    return firstName;
  }

  private skillWorkspaceDir(skillZipUrls: Record<string, string>) {
    const entries = Object.entries(skillZipUrls).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const cacheKey = sha256(JSON.stringify(entries)).slice(0, 32);
    return `${SKILL_ARCHIVE_CACHE_DIR}/${cacheKey || 'default'}`;
  }

  private buildSkillSetupCommand({
    skillZipUrls,
    workspaceDir,
  }: {
    skillZipUrls: Record<string, string>;
    workspaceDir: string;
  }) {
    const quotedWorkspaceDir = this.shellQuote(workspaceDir);
    const setupCommands = Object.entries(skillZipUrls).map(([name, zipUrl]) => {
      const skillDir = `${workspaceDir}/${this.safeSkillDirName(name)}`;
      const markerPath = `${skillDir}/.prepared`;
      const archivePath = `${skillDir}/skill.zip`;
      const quotedArchivePath = this.shellQuote(archivePath);
      const quotedDir = this.shellQuote(skillDir);
      const quotedMarkerPath = this.shellQuote(markerPath);
      const quotedUrl = this.shellQuote(zipUrl);

      return `if [ ! -f ${quotedMarkerPath} ]; then rm -rf ${quotedDir} && mkdir -p ${quotedDir} && curl -fsSL ${quotedUrl} -o ${quotedArchivePath} && unzip -q ${quotedArchivePath} -d ${quotedDir} && printf prepared > ${quotedMarkerPath}; fi`;
    });

    return [
      `mkdir -p ${this.shellQuote(SKILL_ARCHIVE_CACHE_DIR)}`,
      `mkdir -p ${quotedWorkspaceDir}`,
      ...setupCommands,
    ].join(' && ');
  }

  private safeSkillDirName(name: string) {
    return name.replaceAll(/[^\w.-]/g, '-');
  }

  private shellQuote(value: string) {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  private async writeLocalFile(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const path = String(params.path || '');

    if (!path) {
      return this.errorResult('path is required');
    }

    return this.writeTextFile({
      content: String(params.content || ''),
      createDirectories: params.createDirectories === true,
      path,
      timeoutMs: this.timeout(params),
    });
  }

  private async writeTextFile({
    content,
    createDirectories,
    path,
    timeoutMs,
  }: {
    content: string;
    createDirectories: boolean;
    path: string;
    timeoutMs: number;
  }): Promise<SandboxCallToolResult> {
    const init = await this.runJsonScript(
      prepareWriteFileScript,
      { createDirectories, path },
      timeoutMs,
    );

    if (!init.success) {
      return init;
    }

    const bytes = Buffer.from(content);
    let bytesWritten = 0;

    for (let offset = 0; offset < bytes.length; offset += WRITE_FILE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + WRITE_FILE_CHUNK_BYTES).toString('base64');
      const append = await this.runJsonScript(
        appendWriteFileChunkScript,
        { chunk, path },
        timeoutMs,
      );

      if (!append.success) {
        return append;
      }

      bytesWritten += Number(append.result?.bytesWritten || 0);
    }

    return {
      result: {
        bytesWritten,
        success: true,
      },
      success: true,
    };
  }

  private async getCommandOutput(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = String(params.commandId || '');
    if (!commandId) return this.errorResult('commandId is required');

    const task = await this.request<OnlyboxesTaskResponse>(`/api/v1/tasks/${commandId}`, {
      method: 'GET',
    });

    const running =
      task.status === 'running' || task.status === 'pending' || task.status === 'dispatched';
    const success = running || task.status === 'succeeded';
    const result = task.result || {};

    return {
      error: task.error
        ? { message: task.error.message || task.error.code || 'Task failed' }
        : undefined,
      result: {
        error: task.error?.message,
        newOutput: String(result.stdout || result.output || ''),
        output: String(result.stdout || result.output || ''),
        running,
        stderr: String(result.stderr || ''),
        success,
      },
      success: !task.error,
    };
  }

  private async killCommand(params: Record<string, unknown>): Promise<SandboxCallToolResult> {
    const commandId = String(params.commandId || '');
    if (!commandId) return this.errorResult('commandId is required');

    const task = await this.request<OnlyboxesTaskResponse>(`/api/v1/tasks/${commandId}/cancel`, {
      method: 'POST',
    });

    return {
      error: task.error
        ? { message: task.error.message || task.error.code || 'Failed to cancel task' }
        : undefined,
      result: {
        success: !task.error,
      },
      success: !task.error,
    };
  }

  private async runJsonScript(
    script: string,
    params: Record<string, unknown>,
    timeoutMs = this.timeout(params),
  ): Promise<SandboxCallToolResult> {
    const encoded = Buffer.from(JSON.stringify(params)).toString('base64');
    const command = `python3 - <<'PY'\n${script}\nmain('${encoded}')\nPY`;
    const terminal = await this.execTerminal(command, timeoutMs);

    if (terminal.exit_code !== 0) {
      return {
        error: { message: terminal.stderr || terminal.stdout || 'Onlyboxes script failed' },
        result: null,
        success: false,
      };
    }

    try {
      const result = JSON.parse(terminal.stdout || '{}') as Record<string, unknown>;

      if (result.success === false) {
        return {
          error: { message: String(result.error || 'Onlyboxes script failed') },
          result,
          success: false,
        };
      }

      return {
        result,
        success: true,
      };
    } catch (error) {
      return {
        error: { message: `Failed to parse Onlyboxes script output: ${(error as Error).message}` },
        result: { output: terminal.stdout, stderr: terminal.stderr },
        success: false,
      };
    }
  }

  private async execTerminal(command: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.request<TerminalExecResult>('/api/v1/commands/terminal', {
      body: JSON.stringify({
        command,
        create_if_missing: true,
        lease_ttl_sec: this.leaseTTLSec,
        session_id: this.sessionId,
        timeout_ms: timeoutMs,
      }),
      method: 'POST',
    });
  }

  private async ensureSession() {
    await this.execTerminal(':', DEFAULT_TIMEOUT_MS);
  }

  private async submitTask(
    capability: string,
    input: Record<string, unknown>,
    options?: { mode?: 'async' | 'auto' | 'sync'; timeoutMs?: number },
  ) {
    return this.request<OnlyboxesTaskResponse>('/api/v1/tasks', {
      body: JSON.stringify({
        capability,
        input,
        mode: options?.mode || 'sync',
        timeout_ms: options?.timeoutMs || DEFAULT_TIMEOUT_MS,
        wait_ms: options?.mode === 'async' ? 1 : EXPORT_TASK_WAIT_MS,
      }),
      method: 'POST',
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.createJITToken()}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const body = await response.text();
    const json = body ? JSON.parse(body) : {};

    if (!response.ok) {
      const message =
        typeof json?.error === 'string'
          ? json.error
          : typeof json?.error?.message === 'string'
            ? json.error.message
            : `Onlyboxes request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    return json as T;
  }

  private createJITToken(now = Date.now()) {
    const claims = {
      exp: now + this.jitTTLSec * 1000,
      iss: this.jitIssuer,
      sub: this.options.userId,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signed = `${JIT_TOKEN_PREFIX}${payload}`;
    const signature = createHmac('sha256', this.jitSigningKey).update(signed).digest('base64url');

    return `${signed}.${signature}`;
  }

  private timeout(params: Record<string, unknown>) {
    const value = params.timeout ?? params.timeout_ms;
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TIMEOUT_MS;
  }

  private errorResult(message: string, name?: string): SandboxCallToolResult {
    return {
      error: { message, name },
      result: null,
      success: false,
    };
  }
}

const scriptPrelude = `
import base64, json, os, re, shutil, glob, fnmatch
from pathlib import Path

def load_args(encoded):
    return json.loads(base64.b64decode(encoded).decode())

def emit(value):
    print(json.dumps(value, ensure_ascii=False))
`;

const listFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directoryPath') or '.'
    entries = []
    for entry in os.scandir(directory):
        stat = entry.stat()
        entries.append({
            'name': entry.name,
            'path': entry.path,
            'isDirectory': entry.is_dir(),
            'size': stat.st_size,
            'mtime': stat.st_mtime,
        })
    emit({'files': entries, 'totalCount': len(entries)})
`;

const readFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = args.get('path')
    start = args.get('startLine')
    end = args.get('endLine')
    text = Path(path).read_text(errors='replace')
    lines = text.splitlines(True)
    selected = lines
    if start is not None or end is not None:
        start_idx = max((start or 1) - 1, 0)
        end_idx = end if end is not None else len(lines)
        selected = lines[start_idx:end_idx]
    content = ''.join(selected)
    emit({
        'content': content,
        'filename': os.path.basename(path),
        'charCount': len(content),
        'totalCharCount': len(text),
        'totalLineCount': len(lines),
    })
`;

const prepareWriteFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    if args.get('createDirectories'):
        path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'')
    emit({'success': True})
`;

const appendWriteFileChunkScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    chunk = base64.b64decode(args.get('chunk') or '')
    with path.open('ab') as file:
        file.write(chunk)
    emit({'bytesWritten': len(chunk), 'success': True})
`;

const editFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    search = args.get('search') or ''
    replace = args.get('replace') or ''
    text = path.read_text(errors='replace')
    count = text.count(search)
    if count == 0:
        emit({'success': False, 'error': 'search text not found', 'replacements': 0})
        return
    new_text = text.replace(search, replace) if args.get('all') else text.replace(search, replace, 1)
    replacements = count if args.get('all') else 1
    path.write_text(new_text)
    emit({'success': True, 'replacements': replacements, 'linesAdded': replace.count('\\n'), 'linesDeleted': search.count('\\n')})
`;

const searchFilesScript = `${scriptPrelude}
from datetime import datetime

def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except Exception:
        return None

def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    raw_keywords = args.get('keywords') or args.get('keyword') or ''
    keywords = [item.strip() for item in str(raw_keywords).split() if item.strip()]
    raw_file_types = args.get('fileTypes') or args.get('fileType') or []
    if isinstance(raw_file_types, str):
        raw_file_types = [raw_file_types]
    file_types = [item if str(item).startswith('.') else f'.{item}' for item in raw_file_types if str(item).strip()]
    modified_after = parse_time(args.get('modifiedAfter'))
    modified_before = parse_time(args.get('modifiedBefore'))
    content_contains = args.get('contentContains')
    limit = args.get('limit')
    results = []
    for root, _, files in os.walk(directory):
        for name in files:
            if keywords and not all(keyword in name for keyword in keywords):
                continue
            if file_types and not any(name.endswith(file_type) for file_type in file_types):
                continue
            path = os.path.join(root, name)
            try:
                stat = os.stat(path)
            except Exception:
                continue
            if modified_after is not None and stat.st_mtime < modified_after:
                continue
            if modified_before is not None and stat.st_mtime > modified_before:
                continue
            if content_contains:
                try:
                    if str(content_contains) not in Path(path).read_text(errors='replace'):
                        continue
                except Exception:
                    continue
            results.append({'name': name, 'path': path, 'size': stat.st_size, 'mtime': stat.st_mtime})
    sort_by = args.get('sortBy')
    reverse = args.get('sortDirection') == 'desc'
    if sort_by == 'size':
        results.sort(key=lambda item: item.get('size') or 0, reverse=reverse)
    elif sort_by == 'date':
        results.sort(key=lambda item: item.get('mtime') or 0, reverse=reverse)
    else:
        results.sort(key=lambda item: item.get('name') or '', reverse=reverse)
    total = len(results)
    if isinstance(limit, int) and limit > 0:
        results = results[:limit]
    emit({'results': results, 'totalCount': total})
`;

const moveFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    results = []
    for op in args.get('operations') or []:
        try:
            shutil.move(op.get('source'), op.get('destination'))
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': True})
        except Exception as error:
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': False, 'error': str(error)})
    emit({'results': results, 'successCount': len([r for r in results if r.get('success')])})
`;

const grepContentScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or ''
    file_pattern = args.get('filePattern') or '*'
    recursive = args.get('recursive', True)
    regex = re.compile(pattern)
    matches = []
    walker = os.walk(directory) if recursive else [(directory, [], os.listdir(directory))]
    for root, _, files in walker:
        for name in files:
            if not fnmatch.fnmatch(name, file_pattern):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, 'r', errors='replace') as file:
                    for index, line in enumerate(file, 1):
                        if regex.search(line):
                            matches.append({'path': path, 'lineNumber': index, 'line': line.rstrip('\\n')})
            except Exception:
                pass
    emit({'matches': matches, 'totalMatches': len(matches)})
`;

const globFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or '*'
    files = glob.glob(os.path.join(directory, pattern), recursive=True)
    emit({'files': files, 'totalCount': len(files)})
`;
