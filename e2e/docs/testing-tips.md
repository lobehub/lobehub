# 测试技巧

## 页面元素定位

### 富文本编辑器 (contenteditable) 输入

LobeHub 使用 `@lobehub/editor` 作为聊天输入框，是一个 contenteditable 的富文本编辑器。

**关键点**:

1. 不能直接用 `locator.fill()` - 对 contenteditable 不生效
2. 需要先 click 容器让编辑器获得焦点
3. 使用 `keyboard.type()` 输入文本

```typescript
// 正确的输入方式
await chatInputContainer.click();
await this.page.waitForTimeout(500); // 等待焦点
await this.page.keyboard.type(message, { delay: 30 });
await this.page.keyboard.press('Enter'); // 发送
```

### 添加 data-testid

为了更可靠的元素定位，可以在组件上添加 `data-testid`：

```tsx
// src/features/ChatInput/Desktop/index.tsx
<ChatInput
  data-testid="chat-input"
  ...
/>
```

## 调试技巧

### 添加步骤日志

在每个关键步骤添加 console.log，帮助定位问题：

```typescript
Given('用户进入页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 导航到首页...');
  await this.page.goto('/');

  console.log('   📍 Step: 查找元素...');
  const element = this.page.locator('...');

  console.log('   ✅ 步骤完成');
});
```

### 查看失败截图

测试失败时会自动保存截图到 `e2e/screenshots/` 目录。

### 非 headless 模式

设置 `HEADLESS=false` 可以看到浏览器操作：

```bash
HEADLESS=false pnpm exec cucumber-js --config cucumber.config.js --tags "@smoke"
```

## 常见问题

### 测试超时 (function timed out)

**原因**: 元素定位失败或等待时间不足

**解决**:

- 检查选择器是否正确
- 增加 timeout 参数
- 添加显式等待 `waitForTimeout()`

### strict mode violation (多个元素匹配)

**原因**: 选择器匹配到多个元素（如 desktop/mobile 双组件）

**解决**:

- 使用 `.first()` 或 `.nth(n)`
- 使用 `boundingBox()` 过滤可见元素

### 输入框内容为空

**原因**: contenteditable 编辑器的特殊性

**解决**:

- 先 click 容器确保焦点
- 使用 `keyboard.type()` 而非 `fill()`
- 添加适当的等待时间
