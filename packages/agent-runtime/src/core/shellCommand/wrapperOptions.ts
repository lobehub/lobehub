/**
 * Security-first wrapper option model: a single-letter wrapper flag is
 * presumed to CONSUME the next word unless it is whitelisted here as
 * value-free. The whitelist direction matters: a missed value-free flag only
 * over-skips one harmless token (over-detection), whereas a missed
 * value-taking flag resolves the wrapper's VALUE as the command and lets a
 * real `rm -rf /` slip through (under-detection) — e.g. `sudo -p x rm -rf /`
 * previously resolved to command "x:".
 *
 * Flags not valid for a wrapper (typo/foreign) also consume a value under
 * this model — acceptable: unknown-flag invocations fail at exec time anyway,
 * and erring toward over-detection is the safe direction for a blacklist.
 */
export const WRAPPER_VALUE_FREE_FLAGS: Record<string, ReadonlySet<string>> = {
  // GNU sudo value-free flags only (verified against sudo 1.9 --help):
  // -A askpass, -B beep, -b badge, -e edit, -H set HOME, -h help,
  // -i login, -k kill ticket, -K kill all, -l list, -n non-interactive,
  // -s shell, -v validate. Value-taking (deliberately NOT whitelisted):
  // -p prompt, -u user, -g group, -C fd, -R chroot, -r role, -t type,
  // -T timeout, -D cwd.
  sudo: new Set(['A', 'B', 'b', 'e', 'H', 'h', 'i', 'k', 'K', 'l', 'n', 's', 'v']),
  // util-linux runuser value-free flags: --login/-l implied shell (no arg in
  // the exec form), -c is command-taking like su. The `-u USER` user flag and
  // the `--` end-of-options marker are consumed as value words below; the
  // command after `--` resolves as the real executable.
  runuser: new Set(['l']),
  // GNU env value-free flags: -i ignore-env, -0 null-sep, -v verbose.
  // Value-taking: -u unset NAME, -S split-string (its value IS a command —
  // consumed as a value word, which hides it; covered by the predicate-level
  // ambiguity fallback in semanticShellPredicates/ambiguousShape.ts).
  env: new Set(['i', '0', 'v']),
  nohup: new Set(),
  // bash command builtin: -p default PATH, -v/-V describe.
  command: new Set(['p', 'v', 'V']),
  // GNU xargs value-free flags: -0/--null NUL-separated input,
  // -r/--no-run-if-empty, -t/--verbose, -p/--interactive, -x/--exit,
  // -o/--open-tty, plus the deprecated OPTIONAL-argument forms -e/-i/-l
  // (their argument is attachable only, see
  // WRAPPER_OPTIONAL_ARG_SHORT_FLAGS below). Value-taking: -a FILE, -E
  // EOF-str, -I replstr, -L lines, -n max-args, -P procs, -s size, -d delim.
  // Note the -0 form: an unwhitelisted `-0` would swallow the wrapped command
  // (`xargs -0 rm -rf / harmless` resolved the harmless word as the command),
  // and `-t` failed the same way — `printf x | xargs -t rm -rf /tmp/cache ~`
  // consumed `rm` as an option value and left `~` as a confidently unrelated
  // executable, so every predicate returned false while bash deleted the home
  // directory.
  xargs: new Set(['0', 'r', 't', 'p', 'x', 'o', 'e', 'i', 'l']),
  // `time` is a bash KEYWORD (`time [-p] pipeline`, `help time`: "-p print the
  // timing summary in the portable Posix format") and GNU time's `-p` is the
  // same switch. Without the table `-p` defaulted to "value-taking", ate the
  // wrapped command and left `~` as a confidently unrelated executable, so
  // `time -p rm -rf /tmp/cache ~` passed every predicate.
  time: new Set(['p']),
  // bash `exec` builtin (`help exec`: `exec [-cl] [-a name] [command …]`):
  // `-c` executes the command with an empty environment and `-l` makes it a
  // login shell — neither takes a word (`-a NAME` does, see
  // WRAPPER_VALUE_SHORT_FLAGS). Unlisted, `-c` defaulted to value-taking, ate
  // `rm`, then `/tmp/cache` became the value of `-rf` and `~` resolved as a
  // confidently unrelated executable, so `exec -c rm -rf /tmp/cache ~` passed
  // every predicate while bash ran the deletion.
  exec: new Set(['c', 'l']),
  // util-linux `setsid` (`setsid --help`: `-c, --ctty`, `-f, --fork`,
  // `-w, --wait`) — all switches, none takes a value word. Same failure shape
  // as `exec -c`: `setsid -f rm -rf /tmp/cache ~` resolved `~` as the command.
  setsid: new Set(['c', 'f', 'w']),
};

/**
 * Wrapper short flags that TAKE a value (`env -uNAME`, `sudo -p prompt`).
 * Only used to tell an ATTACHED value (`-uFOO`: the rest of the token is the
 * argument, so the next word is the command) from a foreign cluster (`-rf`
 * arriving after a swallowed command). A letter absent here is not known to
 * take a value, so the security-first "consume the next word" default stays.
 */
export const WRAPPER_VALUE_SHORT_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['u', 'C', 'S']),
  sudo: new Set(['p', 'u', 'g', 'C', 'R', 'r', 't', 'T', 'D']),
  // bash `exec -a NAME` (argv[0] override) is the builtin's only value-taking
  // short option.
  exec: new Set(['a']),
  xargs: new Set(['a', 'E', 'I', 'L', 'n', 'P', 's', 'd']),
  runuser: new Set(['u', 'g', 'c']),
  timeout: new Set(['k', 's']),
  nice: new Set(['n']),
  stdbuf: new Set(['i', 'o', 'e']),
  ionice: new Set(['c', 'n', 'p']),
  flock: new Set(['w', 'E']),
};

/**
 * Wrapper short flags whose argument is OPTIONAL (`xargs -i[R]`, `xargs
 * -e[END]`, `xargs -l[MAX-LINES]`). getopt accepts an optional argument only
 * when it is glued to the token, so the bare form is complete on its own and
 * the next word is the wrapped command in BOTH shapes: neither `-i` nor
 * `-i{}` may consume a value word. Reading them as value-taking ate the
 * command (`xargs -i rm -rf ~` resolved `~` as the executable).
 */
export const WRAPPER_OPTIONAL_ARG_SHORT_FLAGS: Record<string, ReadonlySet<string>> = {
  xargs: new Set(['e', 'i', 'l']),
};

/**
 * Wrapper-owned LONG options, split by arity. The single-letter model above
 * cannot answer the question for `--long` names, and guessing is not safe in
 * either direction: assuming "value-free" resolves the option's VALUE as the
 * command (`sudo --user root rm -rf ~` → "root"), while assuming
 * "value-taking" eats the wrapped command (`env --ignore-environment rm -rf
 * /tmp/cache ~` → `-rf` ate `/tmp/cache` and left `~` as a confidently
 * unrelated executable, so every predicate returned false while bash deleted
 * the home dir). Both shapes are listed explicitly per wrapper below; a long
 * option with unknown arity makes resolution report ambiguity instead.
 */
export const WRAPPER_VALUE_FREE_LONG_FLAGS: Record<string, ReadonlySet<string>> = {
  // GNU coreutils env: -i/-0/-v and the optional-argument signal switches
  // (`--default-signal[=SIG]`) take no separate word.
  env: new Set([
    '--ignore-environment',
    '--null',
    '--debug',
    '--list-signal-handling',
    '--default-signal',
    '--ignore-signal',
    '--block-signal',
  ]),
  // sudo 1.9 value-free long forms (mirrors the short whitelist above).
  sudo: new Set([
    '--askpass',
    '--background',
    '--bell',
    '--edit',
    '--set-home',
    '--login',
    '--remove-timestamp',
    '--reset-timestamp',
    '--list',
    '--non-interactive',
    '--preserve-env',
    '--shell',
    '--stdin',
    '--validate',
  ]),
  // GNU xargs: switches without a value word, including the OPTIONAL-argument
  // forms (`--replace[=R]`, `--eof[=END]`): getopt_long only accepts an
  // optional argument attached with `=`, so the bare form takes no value word
  // and `xargs --replace rm -rf ~` runs rm.
  xargs: new Set([
    '--null',
    '--no-run-if-empty',
    '--verbose',
    '--interactive',
    '--exit',
    '--open-tty',
    '--replace',
    '--eof',
  ]),
  // GNU time long switches (the `-p` above is the bash keyword form).
  time: new Set(['--portability', '--verbose', '--quiet']),
  // util-linux `setsid` long forms mirror the short switches above.
  setsid: new Set(['--ctty', '--fork', '--wait']),
};

/**
 * `runuser` is deliberately absent from both tables: `runuser --login nobody
 * rm -rf /` takes the USER as a positional, so no listed arity describes it —
 * unknown-arity → ambiguity keeps the segment blockable.
 *
 * Wrapper LONG options that consume the NEXT WORD as their value. GNU
 * getopt_long accepts the space-separated form for required arguments, so
 * `--user root` and `--user=root` are both valid and both must consume.
 */
export const WRAPPER_VALUE_LONG_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['--unset', '--chdir', '--split-string']),
  sudo: new Set([
    '--prompt',
    '--user',
    '--group',
    '--close-from',
    '--chroot',
    '--role',
    '--type',
    '--command-timeout',
    '--chdir',
    '--other-user',
  ]),
  xargs: new Set([
    '--arg-file',
    '--delimiter',
    '--max-lines',
    '--max-args',
    '--max-procs',
    '--max-chars',
  ]),
};

/** Long options that never run a command, so their arity cannot hide one. */
export const GLOBAL_VALUE_FREE_LONG_FLAGS = new Set(['--help', '--version']);

/**
 * Exec-prefix commands that run their first non-flag argument as a program.
 * Unwrapped so `exec rm -rf /`, `xargs rm -rf /`, `timeout 30 rm -rf /`,
 * `nice rm -rf /` … resolve to the real command. (The old substring regex
 * blocked these shapes incidentally; semantic matching must unwrap them
 * explicitly or coverage narrows.)
 */
export const EXEC_PREFIX_WRAPPERS = new Set([
  'sudo', // superuser exec
  'runuser', // util-linux run-as-user exec (runuser -u u -- cmd)
  'env', // env VAR=… cmd
  'nohup', // hangup-immune exec
  'command', // bash builtin: bypass aliases/functions
  'builtin', // bash builtin: run the named shell builtin (`builtin command rm -rf /`)
  'exec', // bash builtin: replace the shell with the command
  'xargs', // stdin-driven invocation: `find … | xargs rm …`
  'time', // bash keyword + binary: runs the command
  'nice', // runs the command with niceness
  'setsid', // runs the command in a new session
  'ionice', // runs the command with I/O niceness
  'stdbuf', // runs the command with adjusted stdio buffering
  'timeout', // runs the command with a time limit (first arg = duration value)
  'flock', // runs the command holding a lock (first arg = lockfile value)
  'strace', // traces execution by running the command
  'ltrace', // traces execution by running the command
  'chroot', // runs the command with NEWROOT as '/': `chroot /mnt rm -rf /`
]);

/**
 * Exec-prefix wrappers whose FIRST POSITIONAL argument is a value (not the
 * wrapped command): `timeout 30 rm …`, `flock /tmp/lock rm …`. The unwrap
 * loop consumes that many bare words after the wrapper before treating the
 * next bare word as the command. Flags and assignments are always skipped.
 */
export const WRAPPER_POSITIONAL_VALUES: Record<string, number> = {
  timeout: 1, // DURATION
  flock: 1, // LOCKFILE (when not -n form with command only)
  chroot: 1, // NEWROOT (GNU chroot has no short value-free flags; its options are long-only)
  nice: 0, // nice -N cmd handled by flag model; bare `nice cmd` has none
  time: 0,
};
