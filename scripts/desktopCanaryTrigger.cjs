const BUILD_TYPE_RE =
  /^[^\p{L}\p{N}]*(?:style|feat|fix|perf|refactor|release)(?:\([^\r\n)]+\))?:/iu;

const shouldBuildDesktopCanary = (subject) => BUILD_TYPE_RE.test(subject.trim());

if (require.main === module) {
  process.exitCode = shouldBuildDesktopCanary(process.argv.slice(2).join(' ')) ? 0 : 1;
}

module.exports = { shouldBuildDesktopCanary };
