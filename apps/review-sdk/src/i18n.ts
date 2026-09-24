const zh = {
  allow: '去授权',
  cancel: '取消',
  close: '关闭',
  composerPlaceholder: '这里哪里不对？希望改成什么样？',
  connectHint: '用你的 LobeHub 账号授权后，就能在这个页面上直接标注并打回。',
  connectTitle: '在页面上审阅',
  connectFailed: '授权没有完成',
  connectWaiting: '请在弹出的 LobeHub 窗口里确认；确认后这里会自动继续。',
  popupBlocked: '弹窗被浏览器拦截了，请允许本站弹窗后重试',
  delete: '删除',
  drafts: (n: number) => `我的意见 ${n}`,
  empty: '还没有意见。点页面上的元素写下第一条。',
  exit: '退出',
  expires: (time: string) => `授权有效至 ${time}`,
  hint: '审阅模式 · 点选页面元素写意见，Esc 退出',
  noReject: '你可以写意见，但没有打回这个交付的权限。',
  overallPlaceholder: '总体意见（可选）：优先级、希望的方向……',
  panelTitle: '审阅',
  reject: (n: number) => `打回 ${n} 条，交给 agent 修复`,
  rejected: '已打回',
  rejectedDispatched: '已打回，agent 开始修复',
  rejectedNoAgent: '已打回。这个交付没有可派发的 agent，请把修复交给负责的 agent。',
  save: '保存意见',
  saved: '已记下',
  savedNoShot: '已记下（截图失败，只保存了文字）',
  sendBack: (n: number) => `打回 ${n} 条`,
  sessionEnded: '授权已失效，请重新授权',
  start: '审阅',
};

const en: typeof zh = {
  allow: 'Authorize',
  cancel: 'Cancel',
  close: 'Close',
  composerPlaceholder: 'What is wrong here? What should it be instead?',
  connectHint:
    'Authorize with your LobeHub account to annotate this page and send the delivery back.',
  connectTitle: 'Review on this page',
  connectFailed: 'Authorization was not completed',
  connectWaiting: 'Confirm in the LobeHub window; this continues on its own once you do.',
  popupBlocked: 'The popup was blocked — allow popups for this site and try again',
  delete: 'Delete',
  drafts: (n) => `My remarks ${n}`,
  empty: 'No remarks yet. Click an element on the page to write the first one.',
  exit: 'Exit',
  expires: (time) => `Authorized until ${time}`,
  hint: 'Review mode · click an element to comment, Esc to exit',
  noReject: 'You can comment, but you cannot send this delivery back.',
  overallPlaceholder: 'Overall note (optional): priority, direction…',
  panelTitle: 'Review',
  reject: (n) => `Send back ${n} for repair`,
  rejected: 'Sent back',
  rejectedDispatched: 'Sent back — the agent is on it',
  rejectedNoAgent: 'Sent back. This delivery has no agent to dispatch to; hand the repair over.',
  save: 'Save remark',
  saved: 'Saved',
  savedNoShot: 'Saved (screenshot failed, text only)',
  sendBack: (n) => `Send back ${n}`,
  sessionEnded: 'Authorization expired — authorize again',
  start: 'Review',
};

export type Messages = typeof zh;
export const messagesFor = (locale?: string): Messages =>
  (locale ?? (typeof navigator === 'undefined' ? 'en' : navigator.language))
    .toLowerCase()
    .startsWith('zh')
    ? zh
    : en;
