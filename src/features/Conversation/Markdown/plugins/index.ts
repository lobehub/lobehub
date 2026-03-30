import ImageSearchRef from './ImageSearchRef';
import LobeArtifact from './LobeArtifact';
import LobeThinking from './LobeThinking';
import LocalFile from './LocalFile';
import Mention from './Mention';
import { type MarkdownElement } from './type';

export type { MarkdownElement } from './type';

export const markdownElements: MarkdownElement[] = [
  LobeArtifact,
  LobeThinking,
  LocalFile,
  Mention,
  ImageSearchRef,
];
