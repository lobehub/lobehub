import { A2uiExecutionRuntime } from '@lobechat/builtin-tool-a2ui/executionRuntime';
import { A2uiExecutor } from '@lobechat/builtin-tool-a2ui/executor';

const runtime = new A2uiExecutionRuntime();

export const a2uiExecutor = new A2uiExecutor(runtime);
