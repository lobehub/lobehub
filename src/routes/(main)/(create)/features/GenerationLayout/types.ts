'use client';

export interface GenerationLayoutCommonProps {
  breadcrumb: { href: string; title: string }[];
  generationTopicsSelector: (s: any) => any;
  namespace: 'image' | 'video';
  navKey: string;
  useStore: (selector: (s: any) => any) => any;
  viewModeStatusKey: 'imageTopicViewMode' | 'videoTopicViewMode';
}
