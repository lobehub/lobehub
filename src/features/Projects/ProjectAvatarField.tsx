import { Flexbox, Icon, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImagePlusIcon, LoaderCircleIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';

import { isLocalAvatarPreview } from './pickedAvatar';
import ProjectAvatar from './ProjectAvatar';
import { useAvatarFileDrop } from './useAvatarFileDrop';
import { useProjectAvatarUpload } from './useProjectAvatarUpload';

const TILE_SIZE = 32;

const styles = stylex.create({
  dragging: {
    outlineWidth: 2,
    outlineStyle: 'dashed',
    outlineColor: cssVar.colorPrimary,
    outlineOffset: 1,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: cssVar.colorTextLightSolid,
    background: cssVar.colorBgMask,
    opacity: { 'default': 0, ':hover': 1 },
    transitionProperty: 'opacity',
    transitionDuration: cssVar.motionDurationMid,
  },
  overlayShown: {
    opacity: 1,
  },
  tile: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: cssVar.borderRadius,
  },
});

interface ProjectAvatarFieldProps {
  avatar?: string;
  /** The rest of the row; an image dropped on it lands here as well. */
  children: ReactNode;
  disabled?: boolean;
  /** Seeds the generated avatar shown until the user picks one. */
  name: string;
  onChange: (avatar?: string) => void;
  /** An upload is in flight; the avatar it brings arrives through `onChange` later. */
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * The project's avatar beside its name: click to pick an emoji or upload an
 * image, or drop an image anywhere on the row.
 */
const ProjectAvatarField = memo<ProjectAvatarFieldProps>(
  ({ avatar, children, disabled, name, onChange, onUploadingChange }) => {
    const { t } = useTranslation('project');
    const { upload, uploading } = useProjectAvatarUpload({ onChange, onUploadingChange });

    const { dragging, dropProps } = useAvatarFileDrop({
      disabled: disabled || uploading,
      onFile: (file) => void upload(file, { crop: true }),
      onReject: () => toast.error(t('create.avatarInvalidType')),
    });

    return (
      <Flexbox horizontal align={'center'} gap={8} {...dropProps}>
        <EmojiPicker
          allowDelete={!!avatar}
          allowUpload={{ enableEmoji: true }}
          loading={uploading}
          open={disabled ? false : undefined}
          popupProps={{ placement: 'bottomLeft' }}
          size={TILE_SIZE}
          value={avatar}
          customRender={(value) => (
            <Tooltip title={t('create.avatarHint')}>
              <div
                aria-label={t('create.avatarHint')}
                {...stylex.props(styles.tile, dragging && styles.dragging)}
                role={'button'}
              >
                {/* Until one is picked, the project's own generated avatar: the one
                    it keeps after creation, seeded by the name as it is typed. */}
                <ProjectAvatar
                  avatar={value}
                  name={name.trim() || t('create.title')}
                  size={TILE_SIZE}
                />
                <div
                  {...stylex.props(styles.overlay, (dragging || uploading) && styles.overlayShown)}
                >
                  <Icon
                    icon={uploading ? LoaderCircleIcon : ImagePlusIcon}
                    size={16}
                    spin={uploading}
                  />
                </div>
              </div>
            </Tooltip>
          )}
          onDelete={() => onChange(undefined)}
          onUpload={(file) => void upload(file, { crop: false })}
          // Typed as a string, but delete reports `null`.
          onChange={(next: string | null) => {
            // The uploader reports a local preview first; keep only the stored URL.
            if (!isLocalAvatarPreview(next)) onChange(next || undefined);
          }}
        />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          {children}
        </Flexbox>
      </Flexbox>
    );
  },
);

ProjectAvatarField.displayName = 'ProjectAvatarField';

export default ProjectAvatarField;
