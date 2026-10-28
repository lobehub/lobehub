// An environment's setup command is, by contract, an arbitrary command the owner wants
// run in their isolated sandbox. Every argument value is quoted; the setup command is raw.
export interface SandboxInitialization {
  bootstrapCommand?: string;
  name: string;
  sources: { ref?: string; url: string }[];
}

const shellQuote = (value: string) => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** One shell command run through the sandbox's `runCommand` tool, never on the host. */
export const buildSandboxInitCommand = (init: SandboxInitialization): string => {
  const clones = init.sources.map((source, index) => {
    const branch = source.ref ? ` --branch ${shellQuote(source.ref)}` : '';
    return `git clone --depth 1${branch} ${shellQuote(source.url)} "$tmp/${index}"`;
  });

  const steps = [
    `tmp="$(mktemp -d)"`,
    ...clones,
    ...(init.bootstrapCommand ? [init.bootstrapCommand] : []),
  ];

  return [
    `if ( set -e; ${steps.join(' && ')} ); then`,
    `  echo "Initialized from environment "${shellQuote(init.name)}"."`,
    `fi`,
  ].join('\n');
};
