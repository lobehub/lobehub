export enum TraceNameMap {
  ConnectivityChecker = 'Connectivity Checker',
  Conversation = 'Conversation',
  EmojiPicker = 'Emoji Picker',
  FetchPluginAPI = 'Fetch Plugin API',
  LanguageDetect = 'Language Detect',
  SearchIntentRecognition = 'Search Intent Recognition',
  SummaryAgentDescription = 'Summary Agent Description',
  SummaryAgentTags = 'Summary Agent Tags',
  SummaryAgentTitle = 'Summary Agent Title',
  SummaryHistoryMessages = 'Summary History Messages',
  SummaryTopicTitle = 'Summary Topic Title',
  Translator = 'Translator',
}

export enum TraceEventType {
  CopyMessage = 'Copy Message',
  DeleteAndRegenerateMessage = 'Delete And Regenerate Message',
  ModifyMessage = 'Modify Message',
  RegenerateMessage = 'Regenerate Message',
}

export enum TraceTopicType {
  AgentSettings = 'Agent Settings',
}

export enum TraceTagMap {
  Chat = 'Chat Competition',
  SystemChain = 'System Chain',
  ToolCalling = 'Tool Calling',
  ToolsCalling = 'Tools Calling',
}
