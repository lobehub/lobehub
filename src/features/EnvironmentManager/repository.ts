/**
 * Only what naming a repository needs. Typed structurally rather than against
 * either configuration type, because the stored shape and the service's own
 * specification type disagree on the rest of the object and neither difference
 * matters to a checkout URL.
 */
interface SourcedConfiguration {
  sources?: { kind?: string; url?: string }[];
}

/**
 * The one repository an environment builds from, as `owner/name`.
 *
 * A specification stores a checkout URL because that is what the execution
 * plane clones; `owner/name` is what the repository is called everywhere a
 * person meets it, so the translation happens here rather than in each surface
 * that shows one.
 */
export const repositoryPath = (configuration?: SourcedConfiguration): string | undefined => {
  const url = configuration?.sources?.find((source) => source.kind === 'git')?.url;
  const path = url?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

  return path || undefined;
};

/** Every repository an environment checks out, as `owner/name` (or the url when not GitHub). */
export const repositoryPaths = (configuration?: SourcedConfiguration): string[] =>
  (configuration?.sources ?? []).flatMap((source) => {
    if (source.kind !== 'git' || !source.url) return [];
    const path = source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    return path ? [path] : [];
  });
