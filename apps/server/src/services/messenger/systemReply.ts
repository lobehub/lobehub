import { getBotReplyLocale } from '@/server/services/bot/platforms/const';

interface MessengerSystemStrings {
  accountAlreadyLinked: string;
  activeAgentAlready: (title: string) => string;
  activeAgentAlreadyToast: (title: string) => string;
  activeAgentChanged: (title: string) => string;
  activeAgentChangedToast: (title: string) => string;
  activeMarker: string;
  agentNotFound: string;
  agentsEmpty: string;
  agentsHeading: string;
  agentsHint: string;
  agentsPicker: string;
  agentsPrivateHeading: string;
  agentsUsage: (count: number) => string;
  agentsWorkspaceHeading: string;
  checkDirectMessage: string;
  currentMarker: string;
  genericError: string;
  help: string;
  needLink: string;
  newDirectMessageOnly: string;
  newStarted: string;
  noActiveAgent: string;
  notLinked: string;
  personalScope: string;
  privateSuffix: string;
  receiveMessagesPicker: string;
  scopeAlready: (name: string) => string;
  scopeNotFound: string;
  scopePicker: string;
  scopesHeading: string;
  scopesHint: string;
  scopesUsage: (count: number) => string;
  scopeSwitched: (name: string, agentTitle?: string) => string;
  staleScope: string;
  startDirectMessageOnly: string;
  stopDirectMessageOnly: string;
  stopNotActive: string;
  stopRequested: string;
  stopUnable: string;
  unknownAction: string;
  unknownCommand: (name: string) => string;
}

const EN_US: MessengerSystemStrings = {
  accountAlreadyLinked:
    'Your account is already linked to LobeHub. Send /agents to switch the active agent, or /new to start a fresh conversation.',
  activeAgentAlready: (title) => `${title} is already the active agent.`,
  activeAgentAlreadyToast: (title) => `${title} is already active.`,
  activeAgentChanged: (title) =>
    `Switched active agent to: ${title}. Your next message will go there.`,
  activeAgentChangedToast: (title) => `Switched to ${title}.`,
  activeMarker: 'active',
  agentNotFound: 'Agent not found.',
  agentsEmpty: 'You have no agents yet. Create one in LobeHub, then come back to /agents.',
  agentsHeading: 'Your agents:',
  agentsHint: 'Reply with /agents <n> to switch the active agent.',
  agentsPicker: 'Tap an agent to make it the active one:',
  agentsPrivateHeading: 'Private agents:',
  agentsUsage: (count) => `Usage: /agents <n>, where n is between 1 and ${count}.`,
  agentsWorkspaceHeading: 'Workspace agents:',
  checkDirectMessage: 'Check your DM with LobeHub for the link button.',
  currentMarker: 'current',
  genericError: 'Something went wrong.',
  help: [
    'Commands:',
    '• /start — bind (or rebind) your LobeHub account',
    '• /switch — switch the active scope (personal or a workspace)',
    '• /agents — list your agents and switch the active one',
    '• /new — start a new conversation',
    '• /stop — stop the current execution',
    '• /feedback <message> — send feedback to the LobeHub team (no AI reply)',
  ].join('\n'),
  needLink: 'You need to /start to bind your account first.',
  newDirectMessageOnly: 'Open your direct message with the LobeHub bot and send `/new` there.',
  newStarted: 'Started a new conversation. Your next message begins a fresh topic.',
  noActiveAgent: 'No active agent selected. Send /agents to pick one.',
  notLinked: 'Not linked. Send /start first.',
  personalScope: 'Personal',
  privateSuffix: ' (private)',
  receiveMessagesPicker: 'Pick an agent to receive your messages:',
  scopeAlready: (name) => `You're already in ${name}.`,
  scopeNotFound: 'Scope not found.',
  scopePicker: 'Tap a scope to switch:',
  scopeSwitched: (name, agentTitle) =>
    agentTitle
      ? `Switched to ${name}. Now chatting with ${agentTitle}. Send /agents to change.`
      : `Switched to ${name}. No agents here yet — create one in LobeHub, then /agents.`,
  scopesHeading: 'Scopes:',
  scopesHint: 'Reply with /switch <n> to switch scope.',
  scopesUsage: (count) => `Usage: /switch <n>, where n is between 1 and ${count}.`,
  startDirectMessageOnly:
    'Open your direct message with the LobeHub bot and send `/start` there to link your account.',
  staleScope: 'Your active workspace is no longer available. Send /switch to choose another scope.',
  stopDirectMessageOnly: 'Open your direct message with the LobeHub bot and send `/stop` there.',
  stopNotActive: 'No active execution to stop.',
  stopRequested: 'Stop requested.',
  stopUnable: 'Unable to stop the current execution.',
  unknownAction: 'Unknown action.',
  unknownCommand: (name) => `Unknown command: /${name}`,
};

const ZH_CN: MessengerSystemStrings = {
  accountAlreadyLinked:
    '你的账号已绑定到 LobeHub。发送 /agents 可切换当前 Agent，发送 /new 可开启新对话。',
  activeAgentAlready: (title) => `${title} 已经是当前 Agent。`,
  activeAgentAlreadyToast: (title) => `${title} 已是当前 Agent。`,
  activeAgentChanged: (title) => `已将当前 Agent 切换为：${title}。下一条消息会发送给它。`,
  activeAgentChangedToast: (title) => `已切换到 ${title}。`,
  activeMarker: '当前',
  agentNotFound: '未找到该 Agent。',
  agentsEmpty: '你还没有 Agent。请先在 LobeHub 创建，然后再发送 /agents。',
  agentsHeading: '你的 Agent：',
  agentsHint: '回复 /agents <序号> 可切换当前 Agent。',
  agentsPicker: '请选择要设为当前 Agent 的项目：',
  agentsPrivateHeading: '私人 Agent：',
  agentsUsage: (count) => `用法：/agents <序号>，序号范围为 1–${count}。`,
  agentsWorkspaceHeading: '工作区 Agent：',
  checkDirectMessage: '请查看与 LobeHub 机器人的私聊消息，并点击其中的绑定按钮。',
  currentMarker: '当前',
  genericError: '发生错误，请稍后再试。',
  help: [
    '可用命令：',
    '• /start — 绑定（或重新绑定）LobeHub 账号',
    '• /switch — 切换当前空间（个人账号或工作区）',
    '• /agents — 查看 Agent 并切换当前 Agent',
    '• /new — 开启新对话',
    '• /stop — 停止当前执行',
    '• /feedback <内容> — 向 LobeHub 团队发送反馈（不会触发 AI 回复）',
  ].join('\n'),
  needLink: '请先发送 /start 绑定你的 LobeHub 账号。',
  newDirectMessageOnly: '请在与 LobeHub 机器人的私聊中发送 `/new`。',
  newStarted: '已开启新对话，下一条消息会创建一个新话题。',
  noActiveAgent: '当前未选择 Agent。请发送 /agents 进行选择。',
  notLinked: '尚未绑定，请先发送 /start。',
  personalScope: '个人账号',
  privateSuffix: '（私人）',
  receiveMessagesPicker: '请选择接收消息的 Agent：',
  scopeAlready: (name) => `当前已经在 ${name}。`,
  scopeNotFound: '未找到该空间。',
  scopePicker: '请选择要切换到的空间：',
  scopeSwitched: (name, agentTitle) =>
    agentTitle
      ? `已切换到 ${name}，当前 Agent 为 ${agentTitle}。发送 /agents 可更换 Agent。`
      : `已切换到 ${name}，但该空间还没有 Agent。请先在 LobeHub 创建，然后发送 /agents。`,
  scopesHeading: '可切换空间：',
  scopesHint: '回复 /switch <序号> 可切换空间。',
  scopesUsage: (count) => `用法：/switch <序号>，序号范围为 1–${count}。`,
  startDirectMessageOnly: '请打开与 LobeHub 机器人的私聊，并在那里发送 `/start` 绑定账号。',
  staleScope: '当前工作区已不可用。请发送 /switch 选择其他空间。',
  stopDirectMessageOnly: '请在与 LobeHub 机器人的私聊中发送 `/stop`。',
  stopNotActive: '当前没有正在执行的任务可以停止。',
  stopRequested: '已发出停止请求。',
  stopUnable: '无法停止当前执行。',
  unknownAction: '未知操作。',
  unknownCommand: (name) => `未知命令：/${name}`,
};

const WECHAT_ZH_CN: MessengerSystemStrings = {
  ...ZH_CN,
  help: [
    '可用命令：',
    '• /switch — 切换当前空间（个人账号或工作区）',
    '• /agents — 查看 Agent 并切换当前 Agent',
    '• /new — 开启新对话',
    '• /stop — 停止当前执行',
    '• /feedback <内容> — 向 LobeHub 团队发送反馈（不会触发 AI 回复）',
  ].join('\n'),
  needLink: '当前微信账号尚未连接，请前往 LobeHub 的 Messenger 设置重新扫码。',
  notLinked: '当前微信账号尚未连接，请前往 LobeHub 的 Messenger 设置重新扫码。',
};

export const getMessengerSystemStrings = (platform: string): MessengerSystemStrings => {
  if (platform === 'wechat') return WECHAT_ZH_CN;
  return getBotReplyLocale(platform) === 'zh-CN' ? ZH_CN : EN_US;
};
