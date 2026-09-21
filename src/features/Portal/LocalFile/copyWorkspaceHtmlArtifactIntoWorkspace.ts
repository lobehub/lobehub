import {
  collectLocalResourceRefs,
  type GatheredWorkspaceHtmlResource,
  isCssAssetPath,
  isJsAssetPath,
  READ_CONCURRENCY,
  removeLocalBaseTag,
  replaceHrefToken,
  workspaceHtmlArtifactIdentifierForFile,
} from '@lobechat/html-artifact';
import { sha256 } from 'js-sha256';
import path from 'path-browserify-esm';

export interface CopyWorkspaceHtmlArtifactResult {
  entryPath: string;
  failed: GatheredWorkspaceHtmlResource[];
  htmlContent: string;
  targetDirectory: string;
}

const hrefSuffix = (href: string): string => href.match(/[?#].*$/u)?.[0] ?? '';

export const copyWorkspaceHtmlArtifactIntoWorkspace = async ({
  copyFile,
  htmlContent,
  htmlFilePath,
  resources,
  workingDirectory,
  writeFile,
}: {
  copyFile: (from: string, to: string) => Promise<void>;
  htmlContent: string;
  htmlFilePath: string;
  resources: GatheredWorkspaceHtmlResource[];
  workingDirectory: string;
  writeFile: (path: string, content: string) => Promise<void>;
}): Promise<CopyWorkspaceHtmlArtifactResult> => {
  const pathApi = (workingDirectory.includes('\\') ? path.win32 : path.posix)!;
  const identifier = workspaceHtmlArtifactIdentifierForFile(htmlFilePath, workingDirectory);
  const targetDirectory = pathApi.join(workingDirectory, '.lobe-artifacts', identifier);
  const entryPath = pathApi.join(targetDirectory, pathApi.basename(htmlFilePath));
  const htmlDirectory = pathApi.dirname(htmlFilePath);
  const failed: GatheredWorkspaceHtmlResource[] = [];
  const copiedPaths = new Set<string>();

  const targetRelativePath = (absolutePath: string) => {
    const relativePath = pathApi.relative(htmlDirectory, absolutePath);
    const keepsLayout =
      relativePath !== '' &&
      relativePath.split(/[\\/]/, 1)[0] !== '..' &&
      !pathApi.isAbsolute(relativePath);

    return keepsLayout
      ? relativePath
      : pathApi.join(
          '__external__',
          sha256(absolutePath).slice(0, 8),
          pathApi.basename(absolutePath),
        );
  };

  const targets = new Map(
    resources.map((resource) => [resource.absolutePath, targetRelativePath(resource.absolutePath)]),
  );

  const rewrite = (
    content: string,
    sourcePath: string,
    sourceTarget: string,
    sourceKind: 'css' | 'html' | 'js',
  ) => {
    const refs = collectLocalResourceRefs({
      allowExternalReads: true,
      content,
      rootDirectory: sourceKind === 'js' ? htmlDirectory : undefined,
      sourceKind,
      sourcePath,
      workingDirectory,
    });
    let rewritten = content;

    for (const ref of refs.refs) {
      const target = targets.get(ref.absolutePath);
      if (!target) continue;
      // path-browserify drops the first character for `relative('.', value)`;
      // root both artifact-relative paths before comparing them.
      const relativeTarget = pathApi
        .relative(
          pathApi.dirname(pathApi.join(pathApi.sep, sourceTarget)),
          pathApi.join(pathApi.sep, target),
        )
        .replaceAll('\\', '/');
      rewritten = replaceHrefToken(rewritten, ref.href, `${relativeTarget}${hrefSuffix(ref.href)}`);
    }

    return rewritten;
  };

  await copyFile(htmlFilePath, entryPath);

  for (let index = 0; index < resources.length; index += READ_CONCURRENCY) {
    await Promise.all(
      resources.slice(index, index + READ_CONCURRENCY).map(async (resource) => {
        try {
          await copyFile(
            resource.absolutePath,
            pathApi.join(targetDirectory, targets.get(resource.absolutePath)!),
          );
          copiedPaths.add(resource.absolutePath);
        } catch {
          failed.push(resource);
        }
      }),
    );
  }

  await Promise.all(
    resources.map(async (resource) => {
      if (!copiedPaths.has(resource.absolutePath) || resource.text === undefined) return;
      const sourceKind = isCssAssetPath(resource.absolutePath)
        ? 'css'
        : isJsAssetPath(resource.absolutePath)
          ? 'js'
          : undefined;
      if (!sourceKind) return;
      const target = targets.get(resource.absolutePath)!;
      const rewritten = rewrite(resource.text, resource.absolutePath, target, sourceKind);
      if (rewritten !== resource.text) {
        await writeFile(pathApi.join(targetDirectory, target), rewritten);
      }
    }),
  );

  const copiedHtml = removeLocalBaseTag(
    rewrite(htmlContent, htmlFilePath, pathApi.basename(entryPath), 'html'),
  );
  await writeFile(entryPath, copiedHtml);

  return { entryPath, failed, htmlContent: copiedHtml, targetDirectory };
};
