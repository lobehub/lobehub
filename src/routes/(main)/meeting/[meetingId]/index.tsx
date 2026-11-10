'use client';

import { useParams } from 'react-router';

import MeetingDetailPage from '@/features/Meeting/MeetingDetail';

const MeetingDetailRoute = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  if (!meetingId) return null;

  // Keyed, so moving between meetings resets playback instead of carrying it over.
  return <MeetingDetailPage key={meetingId} meetingId={meetingId} />;
};

export default MeetingDetailRoute;
