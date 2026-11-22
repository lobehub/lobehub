'use client';

import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';

import { isMobileSurface } from '@/utils/mobileSurface';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** The idle auto-save hint ("loaded the latest version") on the right of a group head. */
const SAVE_HINT = <SkeletonBar height={20} width={102} />;

/** A `Select` at 50% of the 335px control column, right-aligned as the loaded one. */
const HALF_SELECT = (
  <Flexbox horizontal justify={'flex-end'} width={'100%'}>
    <SkeletonBar height={32} width={'50%'} />
  </Flexbox>
);

/** Replies: reply language, then the switches for what a running turn shows. */
export const ReplySectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            { control: HALF_SELECT, label: text('settingCommon.responseLanguage.title', 64, 14) },
            {
              control: SWITCH_CONTROL,
              label: text('settingChatAppearance.autoScrollOnStreaming.title', 120, 14),
              minWidth: undefined,
            },
            {
              control: SWITCH_CONTROL,
              label: text('settingChatAppearance.workflowStreamingExpand.title', 120, 14),
              minWidth: undefined,
            },
            {
              control: SWITCH_CONTROL,
              desc: text('settingChatAppearance.showImageReadPreview.desc', 360, 12),
              label: text('settingChatAppearance.showImageReadPreview.title', 120, 14),
              minWidth: undefined,
            },
          ],
          title: text('settingConversation.reply.title', 48),
        },
      ]}
    />
  );
};

/** Chat assist: the follow-up suggestion and input completion rows. */
export const ChatAssistSectionSkeleton = () => {
  const text = useSkeletonText('setting');
  const row = (key: string) => ({
    control: { height: 32, width: 320 },
    desc: text(`systemAgent.${key}.modelDesc`, 240, 12),
    label: text(`systemAgent.${key}.title`, 96, 14),
  });

  return (
    <SettingsFormSkeleton
      groups={[
        {
          desc: text('chatPreference.assist.desc', 360, 12),
          items: [row('followUpAction'), row('inputCompletion')],
          title: text('chatPreference.assist.title', 64),
        },
      ]}
    />
  );
};

/** Input & sending: send key (not on mobile) and paste conversion. */
export const SendingSectionSkeleton = () => {
  const text = useSkeletonText('setting');
  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            ...(isMobileSurface()
              ? []
              : [
                  {
                    control: { height: 32, width: 160 },
                    desc: text('hotkey.sendMessage.desc', 240, 12),
                    label: text('hotkey.sendMessage.title', 72, 14),
                  },
                ]),
            {
              control: SWITCH_CONTROL,
              desc: text('settingChatAppearance.pasteAutoConvert.desc', 360, 12),
              label: text('settingChatAppearance.pasteAutoConvert.title', 120, 14),
              minWidth: undefined,
            },
            {
              control: SWITCH_CONTROL,
              desc: text('settingConversation.voiceMessage.desc', 360, 12),
              label: text('settingConversation.voiceMessage.title', 96, 14),
              minWidth: undefined,
            },
          ],
          title: text('settingConversation.input.title', 72),
        },
      ]}
    />
  );
};

/** Message display: the vertical font-size slider with its preview, then link icons. */
export const DisplaySectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsFormSkeleton
      groups={[
        {
          extra: SAVE_HINT,
          items: [
            {
              control: (
                <Flexbox gap={16} width={'100%'}>
                  <Flexbox gap={24}>
                    <SkeletonBar height={4} />
                    <Flexbox horizontal align={'center'} justify={'space-between'}>
                      <SkeletonBar height={14} width={12} />
                      <SkeletonBar height={14} width={40} />
                      <SkeletonBar height={14} width={12} />
                    </Flexbox>
                  </Flexbox>
                  <Flexbox justify={'center'} style={{ height: 30 }}>
                    <SkeletonBar height={16} width={340} />
                  </Flexbox>
                </Flexbox>
              ),
              desc: text('settingChatAppearance.fontSize.desc', 72, 12),
              label: text('settingChatAppearance.fontSize.title', 56, 14),
              layout: 'vertical',
              minWidth: '100%',
            },
            {
              control: SWITCH_CONTROL,
              // The loaded description is a two-line link preview.
              desc: (
                <Flexbox gap={6} paddingBlock={4}>
                  <SkeletonBar height={14} width={160} />
                  <SkeletonBar height={14} width={200} />
                </Flexbox>
              ),
              label: text('settingChatAppearance.linkIcon.title', 120, 14),
              minWidth: undefined,
            },
          ],
          title: text('settingConversation.display.title', 72),
        },
      ]}
    />
  );
};

/** The three preview blocks: response transition, code and Mermaid themes. */
export const ThemesSectionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <>
      <Form.Group
        collapsible={false}
        extra={<SkeletonBar height={38} radius={8} width={151} />}
        title={text('settingChatAppearance.transitionMode.title', 64)}
        variant={'filled'}
      >
        <SkeletonBar height={182} radius={8} />
      </Form.Group>
      <Form.Group
        collapsible={false}
        extra={<SkeletonBar height={32} width={240} />}
        title={text('settingChatAppearance.highlighterTheme.title', 96)}
        variant={'filled'}
      >
        <SkeletonBar height={167} radius={8} />
      </Form.Group>
      <Form.Group
        extra={<SkeletonBar height={32} width={240} />}
        title={text('settingChatAppearance.mermaidTheme.title', 96)}
        variant={'filled'}
      >
        <SkeletonBar height={295} radius={8} />
      </Form.Group>
    </>
  );
};

/** The conversation sections, as direct children of the 36px-gap settings container. */
const Body = () => (
  <>
    <ReplySectionSkeleton />
    <ChatAssistSectionSkeleton />
    <SendingSectionSkeleton />
    <DisplaySectionSkeleton />
    <ThemesSectionSkeleton />
  </>
);

const ConversationSkeleton: SettingsTabSkeleton = { Body };

export default ConversationSkeleton;
