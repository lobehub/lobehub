import { type ChatMessageError } from '@lobechat/types';
import { Alert, Button, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Mic, MicOff } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '../components/Action';

const styles = createStaticStyles(({ css }) => ({
  recording: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${cssVar.colorError};
  `,
}));

const CommonSTT = memo<{
  desc: string;
  error?: ChatMessageError;
  formattedTime: string;
  handleCloseError: () => void;
  handleRetry: () => void;
  handleTriggerStartStop: () => void;
  isLoading: boolean;
  isRecording: boolean;
  mobile?: boolean;
  time: number;
}>(
  ({
    mobile,
    isLoading,
    formattedTime,
    time,
    isRecording,
    error,
    handleRetry,
    handleTriggerStartStop,
    handleCloseError,
    desc,
  }) => {
    const { t } = useTranslation('chat');
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const handleDropdownVisibleChange = (open: boolean) => {
      setDropdownOpen(open);
    };

    return (
      <Action
        active={isRecording}
        icon={isLoading ? MicOff : Mic}
        title={dropdownOpen ? undefined : desc}
        variant={mobile ? 'outlined' : 'borderless'}
        dropdown={{
          menu: {
            // @ts-expect-error 等待 antd 修复
            activeKey: 'time',
            items: [
              {
                key: 'title',
                label: (
                  <Flexbox>
                    <div style={{ fontWeight: 'bolder' }}>{t('stt.action')}</div>
                  </Flexbox>
                ),
              },
              {
                key: 'time',
                label: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <div className={styles.recording} />
                    {time > 0 ? formattedTime : t(isRecording ? 'stt.loading' : 'stt.prettifying')}
                  </Flexbox>
                ),
              },
            ],
          },
          onOpenChange: handleDropdownVisibleChange,
          open: dropdownOpen || !!error || isRecording || isLoading,
          placement: mobile ? 'topRight' : 'top',
          popupRender: error
            ? () => (
                <Alert
                  closable
                  style={{ alignItems: 'center' }}
                  title={error.message}
                  type="error"
                  action={
                    <Button size={'small'} type={'primary'} onClick={handleRetry}>
                      {t('retry', { ns: 'common' })}
                    </Button>
                  }
                  extra={
                    error.body && (
                      <Highlighter
                        actionIconSize={'small'}
                        language={'json'}
                        variant={'borderless'}
                      >
                        {JSON.stringify(error.body, null, 2)}
                      </Highlighter>
                    )
                  }
                  onClose={handleCloseError}
                />
              )
            : undefined,
          trigger: 'click',
        }}
        onClick={handleTriggerStartStop}
      />
    );
  },
);

export default CommonSTT;
