import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquare, MessageSquarePlus, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding-block: 24px;
    padding-inline: 28px;
  `,
  desc: css`
    font-size: 12px;
    line-height: 18px;
    color: #fff;
  `,
  icon: css`
    border-radius: ${cssVar.borderRadiusSM};
    color: color-mix(in srgb, ${cssVar.geekblue} 95%, black);
  `,
  iconSoft: css`
    background: color-mix(in srgb, ${cssVar.geekblue} 68%, white);
  `,
  iconStrong: css`
    background: color-mix(in srgb, ${cssVar.geekblue} 38%, white);
  `,
  overlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 100;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    background: ${cssVar.colorBgMask};
  `,
  panel: css`
    position: relative;

    box-sizing: border-box;
    width: min(460px, 72vw);
    min-height: 160px;
    padding: 28px;
    border-radius: 16px;

    background: ${cssVar.geekblue};
    box-shadow: 0 16px 48px color-mix(in srgb, ${cssVar.geekblue} 32%, transparent);

    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      inset: 10px;

      border: 1.5px dashed #fff;
      border-radius: ${cssVar.borderRadiusLG};
    }
  `,
  title: css`
    font-size: 16px;
    font-weight: bold;
    color: #fff;
  `,
}));

const BLOCK_SIZE = 48;
const ICON_SIZE = { size: 28, strokeWidth: 1.5 };

const TopicDropZone = memo(() => {
  const { t } = useTranslation('components');

  return (
    <div className={styles.overlay} data-testid="topic-drop-zone">
      <div className={styles.panel}>
        <Center className={styles.content} gap={8}>
          <Flexbox horizontal>
            <Center
              className={`${styles.icon} ${styles.iconSoft}`}
              height={BLOCK_SIZE * 1.2}
              style={{ transform: 'rotateZ(-20deg) translateX(8px)' }}
              width={BLOCK_SIZE}
            >
              <Icon icon={MessageSquare} size={ICON_SIZE} />
            </Center>
            <Center
              className={`${styles.icon} ${styles.iconStrong}`}
              height={BLOCK_SIZE * 1.2}
              style={{ transform: 'translateY(-10px)', zIndex: 1 }}
              width={BLOCK_SIZE}
            >
              <Icon icon={MessageSquarePlus} size={ICON_SIZE} />
            </Center>
            <Center
              className={`${styles.icon} ${styles.iconSoft}`}
              height={BLOCK_SIZE * 1.2}
              style={{ transform: 'rotateZ(20deg) translateX(-8px)' }}
              width={BLOCK_SIZE}
            >
              <Icon icon={MessagesSquare} size={ICON_SIZE} />
            </Center>
          </Flexbox>
          <Flexbox align="center" gap={4} style={{ textAlign: 'center' }}>
            <Flexbox className={styles.title}>{t('DropZone.topicTitle')}</Flexbox>
            <Flexbox className={styles.desc}>{t('DropZone.topicDesc')}</Flexbox>
          </Flexbox>
        </Center>
      </div>
    </div>
  );
});

TopicDropZone.displayName = 'TopicDropZone';

export default TopicDropZone;
