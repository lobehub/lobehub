import type { ChatFileItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { filesPrompts } from './index';

describe('filesPrompts', () => {
  // 创建测试用的示例数据
  const mockImage: ChatImageItem = {
    id: 'img-1',
    alt: 'test image',
    url: 'https://example.com/image.jpg',
  };

  const mockFile: ChatFileItem = {
    id: 'file-1',
    name: 'test.pdf',
    fileType: 'application/pdf',
    size: 1024,
    url: 'https://example.com/test.pdf',
  };

  const mockVideo: ChatVideoItem = {
    id: 'video-1',
    alt: 'test video',
    url: 'https://example.com/video.mp4',
  };

  it('should generate prompt with only images', () => {
    const result = filesPrompts({
      imageList: [mockImage],
      fileList: undefined,
    });

    expect(result).toEqual(
      `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="test image" url="https://example.com/image.jpg"></image>
</images>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
    );
  });

  it('should generate prompt with only files', () => {
    const result = filesPrompts({
      imageList: [],
      fileList: [mockFile],
    });

    expect(result).toEqual(
      `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
<file id="file-1" name="test.pdf" type="application/pdf" size="1024" url="https://example.com/test.pdf"></file>
</files>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
    );
  });

  it('should generate prompt with both images and files', () => {
    const result = filesPrompts({
      imageList: [mockImage],
      fileList: [mockFile],
    });

    expect(result).toEqual(
      `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="test image" url="https://example.com/image.jpg"></image>
</images>
<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
<file id="file-1" name="test.pdf" type="application/pdf" size="1024" url="https://example.com/test.pdf"></file>
</files>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
    );
  });

  it('should generate prompt with empty lists', () => {
    const result = filesPrompts({
      imageList: [],
      fileList: [],
    });

    expect(result).toEqual('');
  });

  it('should handle multiple images and files', () => {
    const images: ChatImageItem[] = [
      mockImage,
      {
        id: 'img-2',
        alt: 'second image',
        url: 'https://example.com/image2.jpg',
      },
    ];

    const files: ChatFileItem[] = [
      mockFile,
      {
        id: 'file-2',
        name: 'document.docx',
        fileType: 'application/docx',
        size: 2048,
        url: 'https://example.com/document.docx',
      },
    ];

    const result = filesPrompts({
      imageList: images,
      fileList: files,
    });

    expect(result).toContain('second image');
    expect(result).toContain('document.docx');
    expect(result).toMatch(/<image.*?>.*<image.*?>/s); // Check for multiple image tags
    expect(result).toMatch(/<file.*?>.*<file.*?>/s); // Check for multiple file tags
  });

  it('should handle without url', () => {
    const images: ChatImageItem[] = [
      mockImage,
      {
        id: 'img-2',
        alt: 'second image',
        url: 'https://example.com/image2.jpg',
      },
    ];

    const files: ChatFileItem[] = [
      mockFile,
      {
        id: 'file-2',
        name: 'document.docx',
        fileType: 'application/docx',
        size: 2048,
        url: 'https://example.com/document.docx',
      },
    ];

    const result = filesPrompts({
      imageList: images,
      fileList: files,
      addUrl: false,
    });

    expect(result).toMatchInlineSnapshot(`
      "<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
      <context.instruction>following part contains context information injected by the system. Please follow these instructions:

      1. Always prioritize handling user-visible content.
      2. the context is only required when user's queries rely on it.
      </context.instruction>
      <files_info>
      <images>
      <images_docstring>here are user upload images you can refer to</images_docstring>
      <image name="test image"></image>
      <image name="second image"></image>
      </images>
      <files>
      <files_docstring>here are user upload files you can refer to</files_docstring>
      <file id="file-1" name="test.pdf" type="application/pdf" size="1024"></file>
      <file id="file-2" name="document.docx" type="application/docx" size="2048"></file>
      </files>
      </files_info>
      <!-- END SYSTEM CONTEXT -->"
    `);
  });

  describe('Video functionality', () => {
    it('should generate prompt with only videos', () => {
      const result = filesPrompts({
        videoList: [mockVideo],
      });

      expect(result).toEqual(
        `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
<video name="test video" url="https://example.com/video.mp4"></video>
</videos>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
      );
    });

    it('should generate prompt with videos and images', () => {
      const result = filesPrompts({
        imageList: [mockImage],
        videoList: [mockVideo],
      });

      expect(result).toEqual(
        `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="test image" url="https://example.com/image.jpg"></image>
</images>
<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
<video name="test video" url="https://example.com/video.mp4"></video>
</videos>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
      );
    });

    it('should generate prompt with all media types', () => {
      const result = filesPrompts({
        imageList: [mockImage],
        fileList: [mockFile],
        videoList: [mockVideo],
      });

      expect(result).toEqual(
        `<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="test image" url="https://example.com/image.jpg"></image>
</images>
<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
<file id="file-1" name="test.pdf" type="application/pdf" size="1024" url="https://example.com/test.pdf"></file>
</files>
<videos>
<videos_docstring>here are user upload videos you can refer to</videos_docstring>
<video name="test video" url="https://example.com/video.mp4"></video>
</videos>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
      );
    });

    it('should handle multiple videos', () => {
      const videos: ChatVideoItem[] = [
        mockVideo,
        {
          id: 'video-2',
          alt: 'second video',
          url: 'https://example.com/video2.mp4',
        },
      ];

      const result = filesPrompts({
        videoList: videos,
      });

      expect(result).toContain('test video');
      expect(result).toContain('second video');
      expect(result).toMatch(/<video.*?>.*<video.*?>/s); // Check for multiple video tags
    });

    it('should handle videos without url when addUrl is false', () => {
      const result = filesPrompts({
        videoList: [mockVideo],
        addUrl: false,
      });

      expect(result).toMatchInlineSnapshot(`
        "<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
        <context.instruction>following part contains context information injected by the system. Please follow these instructions:

        1. Always prioritize handling user-visible content.
        2. the context is only required when user's queries rely on it.
        </context.instruction>
        <files_info>
        <videos>
        <videos_docstring>here are user upload videos you can refer to</videos_docstring>
        <video name="test video"></video>
        </videos>
        </files_info>
        <!-- END SYSTEM CONTEXT -->"
      `);
    });

    it('should return empty string when all lists are empty', () => {
      const result = filesPrompts({
        imageList: [],
        fileList: [],
        videoList: [],
      });

      expect(result).toEqual('');
    });

    it('should return empty string when no lists are provided', () => {
      const result = filesPrompts({});

      expect(result).toEqual('');
    });
  });
});
