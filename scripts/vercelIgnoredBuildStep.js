const { execSync } = require('node:child_process');

// Get current branch name
const branchName = process.env.VERCEL_GIT_COMMIT_REF || '';

function shouldProceedBuild() {
  // If the branch is 'lighthouse' or starts with a skip prefix, cancel the build
  if (
    branchName === 'lighthouse' ||
    ['gru', 'automatic', 'reproduction'].some((item) =>
      branchName.startsWith(`${item.toLowerCase()}/`),
    )
  ) {
    return false;
  }

  try {
    // Check file changes, excluding specific files and directories
    const diffCommand =
      'git diff HEAD^ HEAD --quiet -- \
      ":!./*.md" \
      ":!./Dockerfile" \
      ":!./.github" \
      ":!./.githooks" \
      ":!./scripts"';

    execSync(diffCommand);

    return false;
  } catch {
    return true;
  }
}

const shouldBuild = shouldProceedBuild();

console.log('shouldBuild:', shouldBuild);
if (shouldBuild) {
  console.log('✅ - Build can proceed');

  process.exit(1);
} else {
  console.log('🛑 - Build cancelled');

  process.exit(0);
}
