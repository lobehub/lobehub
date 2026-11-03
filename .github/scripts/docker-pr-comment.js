/**
 * Generate or update PR comment with Docker build info
 */
module.exports = async ({
  github,
  context,
  dockerMetaJson,
  image,
  version,
  dockerhubUrl,
  platforms,
}) => {
  const COMMENT_IDENTIFIER = '<!-- DOCKER-BUILD-COMMENT -->';

  const parseTags = () => {
    try {
      if (dockerMetaJson) {
        const parsed = JSON.parse(dockerMetaJson);
        if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
          return parsed.tags;
        }
      }
    } catch (e) {
      // ignore parsing error, fallback below
    }
    if (image && version) {
      return [`${image}:${version}`];
    }
    return [];
  };

  const generateCommentBody = () => {
    const tags = parseTags();
    const buildTime = new Date().toISOString();

    // Use the first tag as the main version
    const mainTag = tags.length > 0 ? tags[0] : `${image}:${version}`;
    const tagVersion = mainTag.includes(':') ? mainTag.split(':')[1] : version;

    return [
      COMMENT_IDENTIFIER,
      '',
      '### 🐳 Database Docker Build Completed!',
      `**Version**: \`${tagVersion || 'N/A'}\``,
      `**Build Time**: \`${buildTime}\``,
      '',
      dockerhubUrl ? `🔗 View all tags on Docker Hub: ${dockerhubUrl}` : '',
      '',
      '### Pull Image',
      'Download the Docker image to your local machine:',
      '',
      '```bash',
      `docker pull ${mainTag}`,
      '```',
      '> [!IMPORTANT]',
      '> This build is for testing and validation purposes.',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const body = generateCommentBody();

  // List comments on the PR
  const { data: comments } = await github.rest.issues.listComments({
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
  });

  const existing = comments.find((c) => c.body && c.body.includes(COMMENT_IDENTIFIER));
  if (existing) {
    await github.rest.issues.updateComment({
      comment_id: existing.id,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body,
    });
    return { updated: true, id: existing.id };
  }

  const result = await github.rest.issues.createComment({
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
    body,
  });
  return { updated: false, id: result.data.id };
};
