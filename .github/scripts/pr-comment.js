/**
 * Generate PR comment with download links for desktop builds
 * and handle comment creation/update logic
 */
const prComment = async ({ github, context, releaseUrl, artifactsUrl, version, tag }) => {
  const COMMENT_IDENTIFIER = '<!-- DESKTOP-BUILD-COMMENT -->';

  /**
   * 生成评论内容
   */
  const generateCommentBody = async () => {
    try {
      // Get release assets to create download links
      const release = await github.rest.repos.getReleaseByTag({
        owner: context.repo.owner,
        repo: context.repo.repo,
        tag,
      });

      // Organize assets by platform
      const macAssets = release.data.assets.filter(
        (asset) =>
          (asset.name.includes('.dmg') || asset.name.includes('.zip')) &&
          !asset.name.includes('.blockmap'),
      );

      const winAssets = release.data.assets.filter(
        (asset) => asset.name.includes('.exe') && !asset.name.includes('.blockmap'),
      );

      const linuxAssets = release.data.assets.filter(
        (asset) => asset.name.includes('.AppImage') && !asset.name.includes('.blockmap'),
      );

      // Generate combined download table
      let assetTable = '| Platform | File | Size |\n| --- | --- | --- |\n';

      // Add macOS assets with architecture detection
      macAssets.forEach((asset) => {
        const sizeInMB = (asset.size / (1024 * 1024)).toFixed(2);

        // Detect architecture from filename
        let architecture = '';
        if (asset.name.includes('arm64')) {
          architecture = ' (Apple Silicon)';
        } else if (asset.name.includes('x64') || asset.name.includes('-mac.')) {
          architecture = ' (Intel)';
        }

        assetTable += `| macOS${architecture} | [${asset.name}](${asset.browser_download_url}) | ${sizeInMB} MB |\n`;
      });

      // Add Windows assets
      winAssets.forEach((asset) => {
        const sizeInMB = (asset.size / (1024 * 1024)).toFixed(2);
        assetTable += `| Windows | [${asset.name}](${asset.browser_download_url}) | ${sizeInMB} MB |\n`;
      });

      // Add Linux assets
      linuxAssets.forEach((asset) => {
        const sizeInMB = (asset.size / (1024 * 1024)).toFixed(2);
        assetTable += `| Linux | [${asset.name}](${asset.browser_download_url}) | ${sizeInMB} MB |\n`;
      });

      return `${COMMENT_IDENTIFIER}
### 🚀 Desktop App Build Completed!

**Version**: \`${version}\`
**Build Time**: \`${new Date().toISOString()}\`

📦 [Release Download](${releaseUrl}) · 📥 [Actions Artifacts](${artifactsUrl || `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`})


## Build Artifacts

${assetTable}

> [!Warning]
>
> Note: This is a temporary build for testing purposes only.`;
    } catch (error) {
      console.error('Error generating PR comment:', error);
      // Fallback to a simple comment if error occurs
      return `${COMMENT_IDENTIFIER}
### 🚀 Desktop App Build Completed!

**Version**: \`${version}\`
**Build Time**: \`${new Date().toISOString()}\`

📦 [Release Download](${releaseUrl}) · 📥 [Actions Artifacts](${artifactsUrl || `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`})

> Note: This is a temporary build for testing purposes only.
      `;
    }
  };

  /**
   * Find and update or create the PR comment
   */
  const updateOrCreateComment = async () => {
    const body = await generateCommentBody();

    const { data: comments } = await github.rest.issues.listComments({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    const buildComment = comments.find((comment) => comment.body.includes(COMMENT_IDENTIFIER));

    if (buildComment) {
      await github.rest.issues.updateComment({
        comment_id: buildComment.id,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: body,
      });
      console.log(`Updated existing comment ID: ${buildComment.id}`);
      return { updated: true, id: buildComment.id };
    } else {
      const result = await github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: body,
      });
      console.log(`Created new comment ID: ${result.data.id}`);
      return { updated: false, id: result.data.id };
    }
  };

  return await updateOrCreateComment();
};

module.exports = prComment;
