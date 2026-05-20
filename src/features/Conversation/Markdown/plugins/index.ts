import ImageSearchRef from './ImageSearchRef';
import LobeAgents from './LobeAgents';
import LobeArtifact from './LobeArtifact';
import LobeThinking from './LobeThinking';
import LocalFile from './LocalFile';
import Mention from './Mention';
import Task from './Task';
import Thinking from './Thinking';
import { type MarkdownElement } from './type';
import UserFeedback from './UserFeedback';

export type { MarkdownElement } from './type';

export const markdownElements: MarkdownElement[] = [
  Thinking,
  LobeArtifact,
  LobeThinking,
  LocalFile,
  Mention,
  Task,
  UserFeedback,
  ImageSearchRef,
  LobeAgents,
];
