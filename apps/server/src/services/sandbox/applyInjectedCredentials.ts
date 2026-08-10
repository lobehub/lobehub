import debug from 'debug';

import type { MarketService } from '@/server/services/market';

import { createSandboxService, getSandboxProviderKind } from './factory';
import { normalizeSandboxCommandResult } from './service';

const log = debug('lobe-server:sandbox:apply-creds');

export interface SandboxInjectedCredentials {
  env?: Record<string, string>;
  files?: Array<{
    content?: string;
    envName?: string;
    fileName?: string;
    filename?: string;
    key: string;
    path?: string;
  }>;
  headers?: Record<string, string>;
}

interface CredsFileOp {
  downloadUrl: string;
  envName?: string;
  fileName: string;
  key: string;
}

const APPLY_CREDS_SCRIPT = `
import base64
import json
import shlex
import subprocess
from pathlib import Path

def load_args(encoded):
    return json.loads(base64.b64decode(encoded).decode())

def safe_key_segment(value):
    return ''.join(c if c.isalnum() or c in '.-' else '-' for c in value)

def parse_env_line(line):
    line = line.strip()
    if not line or line.startswith('#'):
        return None
    if line.startswith('export '):
        line = line[len('export '):].strip()
    if '=' not in line:
        return None
    key, _, value = line.partition('=')
    return key.strip(), value.strip().strip("'").strip('"')

def main(encoded):
    data = load_args(encoded)
    home = Path.home()
    creds_dir = home / '.creds'
    files_dir = creds_dir / 'files'
    creds_dir.mkdir(parents=True, exist_ok=True)
    files_dir.mkdir(parents=True, exist_ok=True)

    env_path = creds_dir / 'env'
    existing = {}
    if env_path.exists():
        for line in env_path.read_text(errors='replace').splitlines():
            parsed = parse_env_line(line)
            if parsed:
                existing[parsed[0]] = parsed[1]

    for key, value in (data.get('env') or {}).items():
        if value is not None and value != '':
            existing[key] = str(value)

    for item in data.get('files') or []:
        key_segment = safe_key_segment(item['key'])
        dest_dir = files_dir / key_segment
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / item['fileName']
        subprocess.run(['curl', '-fsSL', item['downloadUrl'], '-o', str(dest)], check=True)
        env_name = item.get('envName')
        if env_name:
            existing[env_name] = str(dest)

    if existing:
        env_path.write_text(
            ''.join(
                f'export {key}={shlex.quote(str(value))}\\n'
                for key, value in existing.items()
            )
        )
`;

const collectEnvUpdates = (credentials: SandboxInjectedCredentials): Record<string, string> => {
  const updates: Record<string, string> = {};

  for (const [key, value] of Object.entries(credentials.env || {})) {
    if (value !== undefined && value !== '') updates[key] = value;
  }

  for (const [key, value] of Object.entries(credentials.headers || {})) {
    if (value !== undefined && value !== '') updates[key] = value;
  }

  return updates;
};

const collectFileOps = (credentials: SandboxInjectedCredentials): CredsFileOp[] => {
  const fileOps: CredsFileOp[] = [];

  for (const file of credentials.files || []) {
    const fileName = file.fileName || file.filename;
    const downloadUrl = file.content || file.path;

    if (!fileName || !downloadUrl || !file.key) continue;

    fileOps.push({
      downloadUrl,
      envName: file.envName,
      fileName,
      key: file.key,
    });
  }

  return fileOps;
};

export const buildApplyInjectedCredentialsCommand = (
  credentials: SandboxInjectedCredentials,
): string | null => {
  const env = collectEnvUpdates(credentials);
  const files = collectFileOps(credentials);

  if (Object.keys(env).length === 0 && files.length === 0) return null;

  const encoded = Buffer.from(JSON.stringify({ env, files })).toString('base64');

  return `python3 - <<'PY'\n${APPLY_CREDS_SCRIPT}\nmain('${encoded}')\nPY`;
};

export const hasSandboxInjectableCredentials = (
  credentials?: SandboxInjectedCredentials | null,
): boolean => {
  if (!credentials) return false;

  return (
    Object.keys(collectEnvUpdates(credentials)).length > 0 || collectFileOps(credentials).length > 0
  );
};

export const applyInjectedCredentialsToSandboxIfNeeded = async (params: {
  credentials?: SandboxInjectedCredentials | null;
  marketService: MarketService;
  sandbox?: boolean;
  topicId: string;
  userId: string;
}): Promise<{ applied: boolean; error?: string }> => {
  const { credentials, marketService, sandbox = true, topicId, userId } = params;

  if (
    !sandbox ||
    getSandboxProviderKind() !== 'onlyboxes' ||
    !hasSandboxInjectableCredentials(credentials)
  ) {
    return { applied: false };
  }

  const command = buildApplyInjectedCredentialsCommand(credentials!);
  if (!command) return { applied: false };

  log('Applying injected credentials to Onlyboxes sandbox for topic %s', topicId);

  const sandboxService = createSandboxService({ marketService, topicId, userId });
  const result = normalizeSandboxCommandResult(
    await sandboxService.callTool('runCommand', { command, timeout: 60_000 }),
  );

  if (!result.success) {
    const message = result.stderr || result.output || 'Failed to write credentials to sandbox';
    log('Failed to apply credentials for topic %s: %s', topicId, message);

    return {
      applied: false,
      error: message,
    };
  }

  return { applied: true };
};
