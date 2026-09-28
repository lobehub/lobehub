// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { FeishuMessageService } from './service';

const makeService = (listMessages: ReturnType<typeof vi.fn>) =>
  new FeishuMessageService({ listMessages } as any, 'feishu');

describe('FeishuMessageService.reactToMessage', () => {
  it('translates unicode into the named emoji_type Feishu actually accepts', async () => {
    const addReaction = vi.fn().mockResolvedValue(undefined);
    const service = new FeishuMessageService({ addReaction } as any, 'feishu');

    await service.reactToMessage({
      emoji: '\u{1F44D}',
      messageId: 'om_1',
      platform: 'feishu',
    } as any);

    // Passing the unicode straight through is what returns `231001`.
    expect(addReaction).toHaveBeenCalledWith('om_1', 'THUMBSUP');
  });

  it('rejects an emoji Feishu has no equivalent for, naming what it does accept', async () => {
    const addReaction = vi.fn().mockResolvedValue(undefined);
    const service = new FeishuMessageService({ addReaction } as any, 'feishu');

    await expect(
      service.reactToMessage({ emoji: '\u{1F984}', messageId: 'om_1', platform: 'feishu' } as any),
    ).rejects.toThrow('THUMBSUP');
    expect(addReaction).not.toHaveBeenCalled();
  });
});

describe('FeishuMessageService.readMessages', () => {
  it('asks for the NEWEST page and returns it in chronological order', async () => {
    // Feishu's default sort is ascending, so an unsorted first page would be
    // the oldest messages in the chat — useless for "what was just discussed".
    const item = (id: string, createTime: string) => ({
      body: { content: JSON.stringify({ text: id }) },
      create_time: createTime,
      message_id: id,
      sender: { id: 'ou_1' },
    });
    const listMessages = vi.fn().mockResolvedValue({
      hasMore: true,
      items: [
        item('om_newest', '1700000003000'),
        item('om_middle', '1700000002000'),
        item('om_oldest', '1700000001000'),
      ],
      pageToken: 'next',
    });

    const result = await makeService(listMessages).readMessages({
      channelId: 'oc_chat_1',
      cursor: 'prev',
      platform: 'feishu',
    } as any);

    expect(listMessages).toHaveBeenCalledWith(
      'oc_chat_1',
      expect.objectContaining({ pageToken: 'prev', sortType: 'ByCreateTimeDesc' }),
    );
    expect(result.channelId).toBe('oc_chat_1');
    expect(result.messages?.map((m) => m.id)).toEqual(['om_oldest', 'om_middle', 'om_newest']);
  });

  it.each([
    ['230027', 'im:message.group_msg'],
    ['230002', 'not a member of this chat'],
    ['230006', 'bot capability is not enabled'],
    ['230073', 'not visible to the bot'],
  ])(
    'turns Feishu error %s into an actionable hint instead of a bare code',
    async (code, expected) => {
      const listMessages = vi
        .fn()
        .mockRejectedValue(
          new Error(`Lark API GET /im/v1/messages failed: ${code} Permission denied`),
        );

      await expect(
        makeService(listMessages).readMessages({
          channelId: 'oc_chat_1',
          platform: 'feishu',
        } as any),
      ).rejects.toThrow(expected);
    },
  );

  it('leaves unrecognized failures untouched so they stay debuggable', async () => {
    const listMessages = vi.fn().mockRejectedValue(new Error('socket hang up'));

    await expect(
      makeService(listMessages).readMessages({
        channelId: 'oc_chat_1',
        platform: 'feishu',
      } as any),
    ).rejects.toThrow('socket hang up');
  });

  it('flattens rich-text and card bodies so document links stay visible', async () => {
    // Meeting minutes land in the group as a `post` (rich text) or an
    // `interactive` card — previously both read back as content ''.
    const listMessages = vi.fn().mockResolvedValue({
      hasMore: false,
      items: [
        {
          body: {
            content: JSON.stringify({
              elements: [{ tag: 'div', text: { content: '会议纪要已生成', tag: 'lark_md' } }],
              header: { title: { content: '9/9 评审会', tag: 'plain_text' } },
              // The link lives on a button, not in any text — it must be appended.
              link: { url: 'https://lobe-hub.feishu.cn/docx/CardTok' },
            }),
          },
          create_time: '1700000002000',
          message_id: 'om_card',
          msg_type: 'interactive',
          sender: { id: 'ou_bot', sender_type: 'app' },
        },
        {
          body: {
            content: JSON.stringify({
              content: [
                [{ href: 'https://lobe-hub.feishu.cn/docx/PostTok', tag: 'a', text: '纪要' }],
              ],
              title: '',
            }),
          },
          create_time: '1700000001000',
          message_id: 'om_post',
          msg_type: 'post',
          sender: { id: 'ou_1', sender_type: 'user' },
        },
      ],
    });

    const result = await makeService(listMessages).readMessages({
      channelId: 'oc_chat_1',
      platform: 'feishu',
    } as any);

    expect(result.messages?.map((m) => m.content)).toEqual([
      '纪要 (https://lobe-hub.feishu.cn/docx/PostTok)',
      '会议纪要已生成\n9/9 评审会\n[links: https://lobe-hub.feishu.cn/docx/CardTok]',
    ]);
  });
});

describe('FeishuMessageService.readDocument', () => {
  const makeDocService = (api: Record<string, ReturnType<typeof vi.fn>>) =>
    new FeishuMessageService(api as any, 'feishu');

  it('reads a docx link: raw body plus the title from metadata', async () => {
    const getDocxRawContent = vi.fn().mockResolvedValue('参会人：A、B\n总结：...');
    const getDocxDocument = vi
      .fn()
      .mockResolvedValue({ documentId: 'DocTok', title: '远程设备研讨会' });

    const result = await makeDocService({ getDocxDocument, getDocxRawContent }).readDocument({
      platform: 'feishu',
      url: 'https://lobe-hub.feishu.cn/docx/DocTok?from=chat',
    });

    expect(getDocxRawContent).toHaveBeenCalledWith('DocTok');
    expect(result).toEqual({
      content: '参会人：A、B\n总结：...',
      documentId: 'DocTok',
      kind: 'docx',
      platform: 'feishu',
      title: '远程设备研讨会',
      truncated: false,
      url: 'https://lobe-hub.feishu.cn/docx/DocTok',
    });
  });

  it('still returns the body when only the metadata call fails', async () => {
    const getDocxRawContent = vi.fn().mockResolvedValue('body');
    const getDocxDocument = vi.fn().mockRejectedValue(new Error('meta down'));

    const result = await makeDocService({ getDocxDocument, getDocxRawContent }).readDocument({
      documentId: 'DocTok',
      platform: 'feishu',
    });

    expect(result).toMatchObject({ content: 'body', documentId: 'DocTok', title: undefined });
    expect(result.url).toBeUndefined();
  });

  it('resolves a wiki link to the docx it wraps', async () => {
    const getWikiNode = vi.fn().mockResolvedValue({
      nodeToken: 'WikiTok',
      objToken: 'DocTok',
      objType: 'docx',
      title: 'Wiki 页',
    });
    const getDocxRawContent = vi.fn().mockResolvedValue('wiki body');
    const getDocxDocument = vi.fn().mockResolvedValue({ documentId: 'DocTok' });

    const result = await makeDocService({
      getDocxDocument,
      getDocxRawContent,
      getWikiNode,
    }).readDocument({ platform: 'feishu', url: 'https://lobe-hub.feishu.cn/wiki/WikiTok' });

    expect(getWikiNode).toHaveBeenCalledWith('WikiTok');
    expect(getDocxRawContent).toHaveBeenCalledWith('DocTok');
    expect(result).toMatchObject({ documentId: 'DocTok', kind: 'wiki', title: 'Wiki 页' });
  });

  it('refuses a wiki node that does not wrap a docx', async () => {
    const getWikiNode = vi.fn().mockResolvedValue({ objToken: 'sht', objType: 'sheet' });
    await expect(
      makeDocService({ getWikiNode }).readDocument({
        platform: 'feishu',
        url: 'https://lobe-hub.feishu.cn/wiki/WikiTok',
      }),
    ).rejects.toThrow('wraps a "sheet" object');
  });

  it.each([
    ['1770032', 'add the app as a collaborator'],
    ['1770002', 'does not exist'],
    ['1770003', 'has been deleted'],
  ])('turns docx error %s into an actionable hint', async (code, expected) => {
    const getDocxRawContent = vi
      .fn()
      .mockRejectedValue(
        new Error(`Lark API GET /docx/v1/documents/x/raw_content failed: ${code} forbidden`),
      );
    await expect(
      makeDocService({ getDocxRawContent }).readDocument({
        platform: 'feishu',
        url: 'https://lobe-hub.feishu.cn/docx/x',
      }),
    ).rejects.toThrow(expected);
  });

  it.each([
    ['https://lobe-hub.feishu.cn/docs/legacy', 'legacy /docs/ document'],
    ['https://lobe-hub.feishu.cn/minutes/obcn1', 'minutes:minutes'],
    ['https://lobe-hub.feishu.cn/sheets/sht1', 'spreadsheet'],
  ])('explains why %s cannot be read instead of calling the API', async (url, expected) => {
    const getDocxRawContent = vi.fn();
    await expect(
      makeDocService({ getDocxRawContent }).readDocument({ platform: 'feishu', url }),
    ).rejects.toThrow(expected);
    expect(getDocxRawContent).not.toHaveBeenCalled();
  });

  it('rejects a URL that is not a Feishu document link', async () => {
    await expect(
      makeDocService({}).readDocument({ platform: 'feishu', url: 'https://example.com/x' }),
    ).rejects.toThrow('not a Feishu/Lark document link');
  });

  it('truncates very long bodies and says so', async () => {
    const getDocxRawContent = vi.fn().mockResolvedValue('x'.repeat(70_000));
    const getDocxDocument = vi.fn().mockResolvedValue({});
    const result = await makeDocService({ getDocxDocument, getDocxRawContent }).readDocument({
      documentId: 'DocTok',
      platform: 'feishu',
    });
    expect(result.truncated).toBe(true);
    expect(result.content?.length).toBe(60_000);
  });
});
