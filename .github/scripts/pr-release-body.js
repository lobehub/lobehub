/**
 * Generate PR pre-release body content
 * This script generates the description text for PR pre-releases
 */
const generatePrReleaseBody = ({ version, prNumber }) => {
  const prLink = `https://github.com/lobehub/lobehub/pull/${prNumber}`;

  return `
## PR Build Information

**Version**: \`${version}\`
**Release Time**: \`${new Date().toISOString()}\`
**PR**: [#${prNumber}](${prLink})


## ⚠️ Important Notice

This is a **development build** specifically created for testing purposes. Please note:

- This build is **NOT** intended for production use
- Features may be incomplete or unstable
- Use only for validating PR changes in a desktop environment
- May contain experimental code that hasn't been fully reviewed
- No guarantees are provided regarding stability or reliability

### Intended Use

- Focused testing of specific PR changes
- Verification of desktop-specific behaviors
- UI/UX validation on desktop platforms
- Performance testing on target devices

Please report any issues found in this build directly in the PR discussion.

---

## PR 构建信息

**版本**: \`${version}\`
**发布时间**: \`${new Date().toISOString()}\`
**PR**: [#${prNumber}](${prLink})

## ⚠️ 重要提示

这是专为测试目的创建的**开发构建版本**。请注意:

- 本构建**不适用于**生产环境
- 功能可能不完整或不稳定
- 仅用于在桌面环境中验证 PR 更改
- 可能包含尚未完全审核的实验性代码
- 不对稳定性或可靠性提供任何保证

### 适用场景

- 针对性测试特定 PR 变更
- 验证桌面特定的行为表现
- 在桌面平台上进行 UI/UX 验证
- 在目标设备上进行性能测试

如发现任何问题，请直接在 PR 讨论中报告。
`;
};

module.exports = generatePrReleaseBody;
