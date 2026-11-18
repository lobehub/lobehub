import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { redactCommandForAudit } from './device-audit';

const redact = (command: string) => redactCommandForAudit(command).command;

describe('redactCommandForAudit', () => {
  it('blanks credential-named assignments the sandbox list does not know', () => {
    expect(redact('OPENAI_API_KEY=sk-abc123 python job.py')).toBe(
      'OPENAI_API_KEY=[redacted] python job.py',
    );
    expect(redact('export DB_PASSWORD="p@ss word" && psql')).toBe(
      'export DB_PASSWORD=[redacted] && psql',
    );
    expect(redact('GITHUB_TOKEN=ghp_x git push')).toBe('GITHUB_TOKEN=[redacted] git push');
  });

  it('blanks secret flags, bearer headers, URL credentials and token literals', () => {
    expect(redact('cli login --token abcdef123456 --verbose')).toBe(
      'cli login --token [redacted] --verbose',
    );
    expect(redact('mysql --password=hunter2 -u root')).toBe('mysql --password=[redacted] -u root');
    expect(redact('curl -H "Authorization: Bearer abcdefghijklmnop" https://x')).toBe(
      'curl -H "Authorization: Bearer [redacted]" https://x',
    );
    expect(redact('git clone https://me:s3cret@github.com/a/b.git')).toBe(
      'git clone https://me:[redacted]@github.com/a/b.git',
    );
    expect(redact('echo sk-proj-abcdefghijklmnopqrstu')).toBe('echo [redacted]');
  });

  it('leaves ordinary commands alone and fingerprints the original', () => {
    const command = 'ls -la && git status';
    expect(redactCommandForAudit(command)).toEqual({
      command,
      commandSha256: createHash('sha256').update(command).digest('hex'),
    });
  });
});
