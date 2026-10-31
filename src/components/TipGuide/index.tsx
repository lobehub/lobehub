import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, type PopoverPlacement } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { type CSSProperties, type FC, type ReactNode } from 'react';

const styles = stylex.create({
  close: { color: 'white' },
  container: { position: 'relative' },
});

export interface TipGuideProps {
  /**
   * Guide content
   */
  children?: ReactNode;
  /**
   * Class name
   */
  className?: string;
  /**
   * Default open state
   */
  defaultOpen?: boolean;
  /**
   * Render function for customizing the footer section
   */
  footerRender?: (dom: ReactNode) => ReactNode;
  /**
   * Maximum width
   */
  maxWidth?: number;
  /**
   * Vertical offset value
   */
  offsetY?: number;
  /**
   * Callback triggered when the open property changes
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Controlled open property
   */
  open?: boolean;
  /**
   * Tooltip placement, defaults to bottom
   */
  placement?: PopoverPlacement;
  /**
   * style
   */
  style?: CSSProperties;
  tip?: boolean;
  /**
   * Guide title
   */
  title: string;
}

const TipGuide: FC<TipGuideProps> = ({
  children,
  placement = 'bottom',
  title,
  offsetY,
  maxWidth = 300,
  className,
  style,
  open,
  onOpenChange: setOpen,
}) => {
  if (!open) return children;

  return (
    <div {...stylex.props(styles.container)}>
      <div
        style={{
          marginTop: offsetY,
        }}
      >
        <Popover
          arrow={true}
          classNames={{ root: className }}
          open={open}
          placement={placement}
          trigger="hover"
          content={
            <Flexbox horizontal gap={24} style={{ userSelect: 'none' }}>
              <div>{title}</div>
              <ActionIcon
                className={stylex.props(styles.close).className}
                icon={XIcon}
                size={'small'}
                onClick={() => {
                  setOpen(false);
                }}
              />
            </Flexbox>
          }
          styles={{
            root: { maxWidth, zIndex: 1000, ...style },
          }}
        >
          {children}
        </Popover>
      </div>
    </div>
  );
};

export default TipGuide;
