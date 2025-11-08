import { ChatMessageError } from '@lobechat/types';
import { Alert, Button, Highlighter } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Mic, MicOff } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Action from '../components/Action';

const useStyles = createStyles(({ css, token }) => ({
  recording: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${token.colorError};
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
    const { styles } = useStyles();
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const handleDropdownVisibleChange = (open: boolean) => {
      setDropdownOpen(open);
    };

    return (
      <Action
        active={isRecording}
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
                  <Flexbox align={'center'} gap={8} horizontal>
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
                  action={
                    <Button onClick={handleRetry} size={'small'} type={'primary'}>
                      {t('retry', { ns: 'common' })}
                    </Button>
                  }
                  closable
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
                  message={error.message}
                  onClose={handleCloseError}
                  style={{ alignItems: 'center' }}
                  type="error"
                />
              )
            : undefined,
          trigger: ['click'],
        }}
        icon={isLoading ? MicOff : Mic}
        onClick={handleTriggerStartStop}
        title={dropdownOpen ? undefined : desc}
        variant={mobile ? 'outlined' : 'borderless'}
      />
    );
  },
);

export default CommonSTT;
