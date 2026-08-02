'use client';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';
import { useVideoStore } from '@/store/video';

import Sidebar from './Sidebar';

const VideoLayout = () => <GenerationLayout sidebar={<Sidebar />} useStore={useVideoStore} />;

export default VideoLayout;
