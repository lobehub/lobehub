# 集成测试

本目录包含 LobeChat 后端的集成测试。

## 目录结构

```
tests/integration/
├── README.md           # 本文件
├── setup.ts            # 集成测试的通用设置
├── utils.ts            # 集成测试工具函数
└── routers/            # tRPC Router 集成测试
    ├── message.integration.test.ts
    ├── session.integration.test.ts
    └── topic.integration.test.ts
```

## 什么是集成测试？

集成测试验证多个模块协同工作的正确性，与单元测试不同：

- **单元测试**: 测试单个函数 / 类，使用 mock 隔离依赖
- **集成测试**: 测试完整的调用链路（Router → Service → Model → Database），使用真实数据库

## 为什么需要集成测试？

即使单元测试覆盖率很高（80%+），仍可能出现集成问题：

1. **参数传递遗漏**: 如 `containerId`、`threadId` 在调用链中丢失
2. **数据库约束**: 外键关系、级联删除等在 mock 中无法验证
3. **事务完整性**: 跨表操作的原子性
4. **真实场景**: 模拟用户的完整操作流程

## 运行集成测试

```bash
# 运行所有集成测试
pnpm test:integration

# 运行特定文件
pnpm vitest tests/integration/routers/message.integration.test.ts

# 监听模式
pnpm vitest tests/integration --watch
```

## 编写集成测试的最佳实践

### 1. 使用真实数据库环境

```typescript
import { getTestDB } from '@/database/models/__tests__/_util';

const serverDB = await getTestDB();
```

### 2. 每个测试用例独立

```typescript
beforeEach(async () => {
  // 准备测试数据
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // 清理测试数据
  await serverDB.delete(users).where(eq(users.id, userId));
});
```

### 3. 测试完整的调用链路

```typescript
// ✅ 好的集成测试
it('should create message with correct sessionId and topicId', async () => {
  const caller = messageRouter.createCaller(createTestContext());

  const messageId = await caller.createMessage({
    content: 'Test',
    sessionId: testSessionId,
    topicId: testTopicId,
  });

  // 从数据库验证
  const message = await serverDB.select().from(messages).where(eq(messages.id, messageId));
  expect(message.topicId).toBe(testTopicId);
});
```

### 4. 验证关键路径

优先测试：

- 跨层级的 ID 传递
- 权限验证
- 并发场景
- 错误处理

## 测试覆盖目标

- **API 层集成测试**: 30%
- **关键业务流程**: 100%
- **错误场景**: 主要路径覆盖

## 注意事项

1. 集成测试比单元测试慢，不要过度使用
2. 保持测试数据隔离，避免测试间相互影响
3. 使用有意义的测试数据，便于调试
4. 测试失败时，检查数据库状态
