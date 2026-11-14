'use client';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';
import { useMusicStore } from '@/store/music';

import Sidebar from './Sidebar';

const MusicLayout = () => <GenerationLayout sidebar={<Sidebar />} useStore={useMusicStore} />;

export default MusicLayout;
