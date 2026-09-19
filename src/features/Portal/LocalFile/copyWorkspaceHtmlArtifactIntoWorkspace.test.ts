import { sha256 } from 'js-sha256';
import { describe, expect, it, vi } from 'vitest';

import { copyWorkspaceHtmlArtifactIntoWorkspace } from './copyWorkspaceHtmlArtifactIntoWorkspace';

const resource = (absolutePath: string, hrefs: string[], text?: string) => ({
  absolutePath,
  contentType: text === undefined ? 'image/png' : 'text/css',
  hrefs,
  text,
});

describe('copyWorkspaceHtmlArtifactIntoWorkspace', () => {
  it('copies the complete closure and persists the final HTML entry', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const htmlContent = '<html><img src="logo.png"></html>';

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent,
      htmlFilePath: '/tmp/site/index.html',
      resources: [resource('/tmp/site/logo.png', ['logo.png'])],
      workingDirectory: '/project',
      writeFile,
    });

    expect(result.entryPath).toBe(`${result.targetDirectory}/index.html`);
    expect(result.htmlContent).toBe(htmlContent);
    expect(result.failed).toEqual([]);
    expect(copyFile.mock.calls).toEqual([
      ['/tmp/site/index.html', result.entryPath],
      ['/tmp/site/logo.png', `${result.targetDirectory}/logo.png`],
    ]);
    expect(writeFile).toHaveBeenCalledWith(result.entryPath, htmlContent);
  });

  it('drops a local base tag so the copy resolves against its own directory', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const source = '/tmp/shared/logo.png';

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent: '<html><head><base href="../shared/"></head><img src="logo.png"></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources: [resource(source, ['logo.png'])],
      workingDirectory: '/project',
      writeFile,
    });

    expect(result.htmlContent).not.toContain('<base');
    expect(result.htmlContent).toContain(
      `src="__external__/${sha256(source).slice(0, 8)}/logo.png"`,
    );
  });

  it('keeps a remote base tag, which governs refs the copy never relocates', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent: '<html><head><base href="https://cdn.example.com/app/"></head></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources: [],
      workingDirectory: '/project',
      writeFile,
    });

    expect(result.htmlContent).toContain('<base href="https://cdn.example.com/app/">');
  });

  it('copies one file and rewrites every spelling of its external href', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const source = '/tmp/shared/logo.png';
    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent: '<html><img src="../shared/logo.png"><img src="../shared/logo.png?v=2"></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources: [resource(source, ['../shared/logo.png', '../shared/logo.png?v=2'])],
      workingDirectory: '/project',
      writeFile,
    });
    const relativeTarget = `__external__/${sha256(source).slice(0, 8)}/logo.png`;

    expect(copyFile).toHaveBeenCalledTimes(2);
    expect(copyFile).toHaveBeenLastCalledWith(
      source,
      `${result.targetDirectory}/${relativeTarget}`,
    );
    expect(result.htmlContent).toBe(
      `<html><img src="${relativeTarget}"><img src="${relativeTarget}?v=2"></html>`,
    );
    expect(writeFile).toHaveBeenLastCalledWith(result.entryPath, result.htmlContent);
  });

  it('rewrites nested references inside copied external CSS', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const cssPath = '/tmp/shared/app.css';
    const imagePath = '/tmp/shared/image.png';

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent: '<html><link rel="stylesheet" href="../shared/app.css"></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources: [
        resource(cssPath, ['../shared/app.css'], 'body { background: url("image.png") }'),
        resource(imagePath, ['image.png']),
      ],
      workingDirectory: '/project',
      writeFile,
    });
    const cssTarget = `__external__/${sha256(cssPath).slice(0, 8)}/app.css`;
    const imageTarget = `__external__/${sha256(imagePath).slice(0, 8)}/image.png`;
    const cssToImage = `../${sha256(imagePath).slice(0, 8)}/image.png`;

    expect(result.htmlContent).toContain(cssTarget);
    expect(copyFile).toHaveBeenCalledWith(imagePath, `${result.targetDirectory}/${imageTarget}`);
    expect(writeFile).toHaveBeenCalledWith(
      `${result.targetDirectory}/${cssTarget}`,
      `body { background: url("${cssToImage}") }`,
    );
  });

  it('copies workspace-local and external resources from the same closure', async () => {
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent:
        '<html><link rel="stylesheet" href="/assets/app.css"><script src="../outside/app.js"></script></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources: [
        resource('/project/assets/app.css', ['/assets/app.css'], 'body{}'),
        {
          ...resource('/tmp/outside/app.js', ['../outside/app.js'], 'console.log(1)'),
          contentType: 'text/javascript',
        },
      ],
      workingDirectory: '/project',
      writeFile,
    });

    expect(copyFile).toHaveBeenCalledTimes(3);
    expect(result.htmlContent).not.toContain('/assets/app.css');
    expect(result.htmlContent).not.toContain('../outside/app.js');
  });

  it('keeps external entry identifiers distinct and canonical', async () => {
    const input = {
      copyFile: vi.fn().mockResolvedValue(undefined),
      htmlContent: '<html></html>',
      resources: [],
      workingDirectory: '/project',
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    const siteA = await copyWorkspaceHtmlArtifactIntoWorkspace({
      ...input,
      htmlFilePath: '/tmp/site-a/index.html',
    });
    const siteARepeat = await copyWorkspaceHtmlArtifactIntoWorkspace({
      ...input,
      htmlFilePath: '/tmp/site-a/index.html',
    });
    const privateSiteA = await copyWorkspaceHtmlArtifactIntoWorkspace({
      ...input,
      htmlFilePath: '/private/tmp/site-a/index.html',
    });
    const siteB = await copyWorkspaceHtmlArtifactIntoWorkspace({
      ...input,
      htmlFilePath: '/tmp/site-b/index.html',
    });

    expect(siteA.targetDirectory).toBe(siteARepeat.targetDirectory);
    expect(siteA.targetDirectory).toBe(privateSiteA.targetDirectory);
    expect(siteA.targetDirectory).not.toBe(siteB.targetDirectory);
  });

  it('returns copy failures and bounds resource concurrency at five', async () => {
    let active = 0;
    let maxActive = 0;
    const copyFile = vi.fn(async (from: string) => {
      if (from.endsWith('index.html')) return;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (from.endsWith('gone.png')) throw new Error('gone');
    });
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const resources = Array.from({ length: 7 }, (_, index) =>
      resource(`/tmp/site/${index === 6 ? 'gone' : index}.png`, [`${index}.png`]),
    );

    const result = await copyWorkspaceHtmlArtifactIntoWorkspace({
      copyFile,
      htmlContent: '<html></html>',
      htmlFilePath: '/tmp/site/index.html',
      resources,
      workingDirectory: '/project',
      writeFile,
    });

    expect(maxActive).toBe(5);
    expect(result.failed).toEqual([resources[6]]);
    expect(copyFile).toHaveBeenCalledTimes(8);
  });
});
