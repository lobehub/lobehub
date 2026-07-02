import { memo, useMemo } from 'react';
import { Md5 } from 'ts-md5';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import FilePlayer from './FilePlayer';
import { type TTSProps } from './InitPlayer';
import InitPlayer from './InitPlayer';

const TTS = memo<TTSProps>(
  (props) => {
    const { file, voice, content, contentMd5 } = props;
    const lang = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const agentId = useConversationStore(contextSelectors.agentId);
    const currentVoice = useAgentStore(agentByIdSelectors.getAgentTTSVoiceById(agentId, lang));

    const md5 = useMemo(() => Md5.hashStr(content).toString(), [content]);

    const isContentEqual = contentMd5 === md5;
    const isVoiceEqual = currentVoice === voice;
    const isEqual = isVoiceEqual && isContentEqual;

    const PlayerRender = file && isEqual ? FilePlayer : InitPlayer;

    return <PlayerRender {...props} contentMd5={md5} />;
  },
  (prevProps, nextProps) => {
    return prevProps.id === nextProps.id && prevProps.content === nextProps.content;
  },
);
export default TTS;
