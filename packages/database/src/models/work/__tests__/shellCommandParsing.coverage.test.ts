import { describe, expect, it } from 'vitest';

import { parseShellCommandSegments } from '../shellCommandParsing';

describe('parseShellCommandSegments · heredoc operators', () => {
  it('keeps a `<<<` here-string literal instead of reading it as a heredoc', () => {
    expect(parseShellCommandSegments(`cat <<<"inline body"\ngh pr list`)).toEqual([
      ['cat', '<<<inline body'],
      ['gh', 'pr', 'list'],
    ]);
  });

  it('strips leading tabs before matching a `<<-` delimiter', () => {
    expect(
      parseShellCommandSegments(`cat <<-EOF > notes.md\n\tit's prose\n\tEOF\ngh pr view 1`),
    ).toEqual([
      ['cat', '>', 'notes.md'],
      ['gh', 'pr', 'view', '1'],
    ]);
  });

  it('reads a quoted delimiter after spaces and drops its body', () => {
    expect(
      parseShellCommandSegments(`cat << 'EOF' > body.md\npanel's copy\nEOF\ngh pr create`),
    ).toEqual([
      ['cat', '>', 'body.md'],
      ['gh', 'pr', 'create'],
    ]);
  });

  it('runs a heredoc body without its delimiter to the end of input', () => {
    expect(parseShellCommandSegments(`cat <<EOF\nfirst line\nit's unterminated`)).toEqual([
      ['cat'],
    ]);
  });

  it('treats `<<` without a delimiter word as literal text', () => {
    expect(parseShellCommandSegments('echo << ;')).toEqual([['echo', '<<']]);
  });

  it('treats a quoted delimiter whose closing quote does not follow the word as literal', () => {
    expect(parseShellCommandSegments(`cat <<'EOF tail'`)).toEqual([['cat', '<<EOF tail']]);
  });
});

describe('parseShellCommandSegments · quoting and escapes', () => {
  it('returns null when a double quote ends on a dangling backslash', () => {
    expect(parseShellCommandSegments('echo "unterminated \\')).toBeNull();
  });

  it('keeps a trailing unquoted backslash as an empty escape', () => {
    expect(parseShellCommandSegments('echo done\\')).toEqual([['echo', 'done']]);
  });
});

describe('parseShellCommandSegments · control operators', () => {
  it('drops empty segments between leading, repeated and trailing operators', () => {
    expect(parseShellCommandSegments('; git push && && gh pr list ;')).toEqual([
      ['git', 'push'],
      ['gh', 'pr', 'list'],
    ]);
  });
});

describe('parseShellCommandSegments · shell `-c` wrappers', () => {
  it('skips non-command flags before `-c` and expands the payload', () => {
    expect(parseShellCommandSegments(`bash -l -c 'gh pr view 7'`)).toEqual([
      ['gh', 'pr', 'view', '7'],
    ]);
  });

  it('drops only the wrapper segment when its payload has unterminated quoting', () => {
    expect(parseShellCommandSegments(`bash -c "it's broken" && gh pr list`)).toEqual([
      ['gh', 'pr', 'list'],
    ]);
  });

  it('keeps a wrapper that carries flags but no command string', () => {
    expect(parseShellCommandSegments('zsh -lc')).toEqual([['zsh', '-lc']]);
  });
});
