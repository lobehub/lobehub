// GOOD fixture (3.0.0 rules): C-11 分层边界。
// lint-lobe.mjs 必须零 finding —— 组合层自建是允许的，只有「重写原子层」才报。
import { createStaticStyles } from '@lobehub/ui';
import { Button, Input, Modal, Table } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui';

// 组合层：业务语义决定的布局 → 自建。内部只用原子层 + 皮肤层。
export const ToolCallBlock = ({ call, onRetry }: { call: ToolCall; onRetry: () => void }) => (
  <div className={styles.wrap}>
    <Table dataSource={call.rows} columns={columns} variant="borderless" />
    <Button onClick={onRetry}>重试</Button>
  </div>
);

// 领域层：Agent 会话消息体 → 自建。
export const AgentMessage = ({ message }: { message: AgentMessage }) =>
  message.role === 'user' ? <Input readOnly value={message.text} /> : null;

// 皮肤层：直接用现成的表面件。
export const Panel = ({ children }: { children: React.ReactNode }) => <Surface>{children}</Surface>;

// 不是「重写原子层」的写法：这些命名不该被 LOBE-REIMPLEMENT-ATOM 命中。
const ButtonRow = () => <Button>保存设置</Button>;
const ModalContent = () => <Modal open>内容</Modal>;
const TableColumns = [{ key: 'id' }];
type InputValue = string;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  wrap: css`
    color: ${cssVar.colorText};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));
