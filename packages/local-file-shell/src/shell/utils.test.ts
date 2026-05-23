import { describe, expect, it } from 'vitest';

import { expandEnvVars } from './utils';

describe('expandEnvVars', () => {
  describe('%VAR% expansion', () => {
    it('expands %VAR% from provided env with POSIX quoting', () => {
      const result = expandEnvVars('echo %FOO%', { FOO: 'hello' }, 'linux');
      expect(result).toBe("echo 'hello'");
    });

    it('expands %VAR% from provided env with PowerShell quoting', () => {
      const result = expandEnvVars('Write-Output %FOO%', { FOO: 'hello' }, 'win32');
      expect(result).toBe("Write-Output 'hello'");
    });

    it('escapes single quotes in value — POSIX', () => {
      const result = expandEnvVars('echo %FOO%', { FOO: "it's fine" }, 'linux');
      expect(result).toBe("echo 'it'\\''s fine'");
    });

    it('escapes single quotes in value — PowerShell', () => {
      const result = expandEnvVars('Write-Output %FOO%', { FOO: "it's fine" }, 'win32');
      expect(result).toBe("Write-Output 'it''s fine'");
    });

    it('leaves %VAR% unchanged when key is missing from env', () => {
      const result = expandEnvVars('echo %MISSING%', {});
      expect(result).toBe('echo %MISSING%');
    });

    it('expands multiple %VAR% references in a single command', () => {
      const result = expandEnvVars('echo %A% %B%', { A: 'foo', B: 'bar' }, 'linux');
      expect(result).toBe("echo 'foo' 'bar'");
    });

    it('uses extraEnv override over process.env (P2 regression)', () => {
      // Simulate childEnv = { ...process.env, API_KEY: 'secret' }
      const childEnv = { ...process.env, API_KEY: 'secret' };
      const result = expandEnvVars('echo %API_KEY%', childEnv, 'win32');
      expect(result).toBe("echo 'secret'");
    });
  });

  describe('non-%VAR% syntaxes are left untouched (P1 security)', () => {
    it('does NOT expand $VAR (left for shell native expansion)', () => {
      const result = expandEnvVars('echo $FOO', { FOO: 'injected' }, 'linux');
      expect(result).toBe('echo $FOO');
    });

    it('does NOT expand ${VAR}', () => {
      const result = expandEnvVars('echo ${FOO}', { FOO: 'injected' }, 'linux');
      expect(result).toBe('echo ${FOO}');
    });

    it('does NOT expand $env:VAR', () => {
      const result = expandEnvVars('Write-Output $env:FOO', { FOO: 'injected' }, 'win32');
      expect(result).toBe('Write-Output $env:FOO');
    });

    it('does not execute subexpressions present in env values (P1 injection guard)', () => {
      // A malicious value that would execute if not properly quoted
      const malicious = '$(touch /tmp/pwned)';
      const result = expandEnvVars('echo %EVIL%', { EVIL: malicious }, 'linux');
      // The value must be wrapped in single quotes, making it literal
      expect(result).toBe("echo '$(touch /tmp/pwned)'");
      // Must NOT be the unquoted value
      expect(result).not.toBe(`echo ${malicious}`);
    });
  });

  describe('edge cases', () => {
    it('handles empty string value', () => {
      const result = expandEnvVars('echo %FOO%', { FOO: '' }, 'linux');
      expect(result).toBe("echo ''");
    });

    it('handles value with backslashes (Windows path)', () => {
      const result = expandEnvVars('Set-Content %DEST%', { DEST: 'C:\\Users\\foo\\file.txt' }, 'win32');
      expect(result).toBe("Set-Content 'C:\\Users\\foo\\file.txt'");
    });

    it('handles command with no %VAR% references unchanged', () => {
      const cmd = 'Get-ChildItem C:\Users\emanuele.gallo';
      const result = expandEnvVars(cmd, {});
      expect(result).toBe(cmd);
    });
  });
});
