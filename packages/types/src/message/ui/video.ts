export interface ChatVideoItem {
  alt: string;
  id: string;
  /**
   * Size in bytes, when the source row knows it. The send path needs it to
   * decide whether the video can be inlined as a `video_url` part or has to be
   * handed to the media-analysis tool instead.
   */
  size?: number;
  url: string;
}
