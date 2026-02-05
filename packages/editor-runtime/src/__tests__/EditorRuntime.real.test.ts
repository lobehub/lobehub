import type { IEditor } from '@lobehub/editor';
import {
  CommonPlugin,
  Kernel,
  ListPlugin,
  LitexmlPlugin,
  MarkdownPlugin,
  moment,
} from '@lobehub/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorRuntime } from '../EditorRuntime';
import editAllFixture from './fixtures/edit-all.json';
import removeFixture from './fixtures/remove.json';
import removeThenAddFixture from './fixtures/remove-then-add.json';

describe('EditorRuntime - Real Cases', () => {
  let runtime: EditorRuntime;
  let editor: IEditor;
  let mockTitleSetter: ReturnType<typeof vi.fn>;
  let mockTitleGetter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    editor = new Kernel() as unknown as IEditor;
    editor.registerPlugins([CommonPlugin, MarkdownPlugin, ListPlugin, LitexmlPlugin]);
    editor.initNodeEditor();

    runtime = new EditorRuntime();
    runtime.setEditor(editor);

    mockTitleSetter = vi.fn();
    mockTitleGetter = vi.fn().mockReturnValue('Test Title');
    runtime.setTitleHandlers(mockTitleSetter, mockTitleGetter);
  });

  describe('modifyNodes - batch modify all paragraphs', () => {
    it('should modify all 16 paragraphs in a single call', async () => {
      // Initialize editor with the JSON fixture
      editor.setDocument('json', editAllFixture);
      await moment();

      // Get the XML to verify initial state
      const xmlBefore = editor.getDocument('litexml') as unknown as string;
      const paragraphMatches = [...xmlBefore.matchAll(/<p id="([^"]+)"/g)];
      expect(paragraphMatches.length).toBe(16);

      // Extract paragraph IDs from the XML
      const paragraphIds = paragraphMatches.map((m) => m[1]);

      const result = await runtime.modifyNodes({
        operations: [
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[0]}">（雨点敲打着咖啡馆的玻璃窗，像无数细小的手指在弹奏着无声的钢琴。林晓坐在靠窗的位置，手中的咖啡已经凉了，她却浑然不觉。这是她第三次来到这家咖啡馆，每次都是同样的位置，同样的时间。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[1]}">（窗外雨丝如帘，街灯昏黄。咖啡馆内灯光柔和，墙上挂着旧照片，书架上摆满了书。空气里是咖啡香和旧书纸的味道。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[2]}">林晓：（内心独白）第一次来的时候，也是这样的雨夜。那天我刚结束一段五年的感情，整个人像是被掏空了。我点了一杯美式咖啡，就这样坐着，看着窗外的雨，直到打烊。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[3]}">林晓：（继续独白）第二次来的时候，我遇到了他。穿着灰色风衣，坐在对面的位置。他一直在看书，偶尔抬头看看窗外。他的手指修长，翻书的动作优雅从容。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[4]}">林晓：（独白）今天，我又来了。雨还是那样下着，咖啡馆还是那样安静。我不知道自己在期待什么，也许只是习惯了这种孤独的仪式感。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[5]}">（门上的风铃响了，有人推门进来。林晓下意识地抬头，心跳突然漏了一拍。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[6]}">（风铃叮咚作响。一个身影站在门口，雨伞滴着水，灯光勾勒出他的轮廓。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[7]}">林晓：（低声）是他。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[8]}">（他收起雨伞，抖了抖身上的水珠，然后径直走向她。这一次，他没有坐在对面的位置，而是在她面前停了下来。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[9]}">陈默：（声音低沉温和）我可以坐这里吗？</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[10]}">（林晓点了点头，喉咙有些发干。窗外的雨声似乎变小了，咖啡馆里的音乐也变得清晰起来。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[11]}">陈默：（眼中带着笑意）我注意到你每次都在这里。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[12]}">林晓：（凝视着他，内心独白）他的眼睛是深褐色的，像秋天的落叶，温暖而深邃。他的鼻梁挺直，唇线分明，微笑时眼角有细微的皱纹，更添了几分沧桑感。我忽然觉得这个人似曾相识，却又分明是第一次见面。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[13]}">陈默：（伸出手）我叫陈默。很高兴终于能和你说话。我观察你三次了，每次你都这样静静地坐着看雨，若有所思，若有所待。</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[14]}">（林晓握住他的手，感受到他掌心的温度。他的手温暖，却有薄茧，像是经常写字或弹琴的人。雨还在下，但咖啡馆里忽然觉得温暖如春，先前的孤独寂寥，竟然悄然消散了。）</p>`,
          },
          {
            action: 'modify',
            litexml: `<p id="${paragraphIds[15]}">（旁白）也许，有些相遇注定要在雨夜发生。就像有些故事，注定要从一句简单的问候开始。</p>`,
          },
        ],
      });
      await moment();

      // Verify all operations succeeded
      expect(result.successCount).toBe(16);
      expect(result.totalCount).toBe(16);
      expect(result.results.every((r) => r.success)).toBe(true);
      expect(result.results.every((r) => r.action === 'modify')).toBe(true);

      // Verify the content was modified
      const markdown = editor.getDocument('markdown') as unknown as string;
      expect(markdown).toContain('雨点敲打着咖啡馆的玻璃窗');
      expect(markdown).toContain('林晓：（低声）是他。');
      expect(markdown).toContain('陈默：（声音低沉温和）我可以坐这里吗？');
      expect(markdown).toContain('也许，有些相遇注定要在雨夜发生');
      expect(markdown).toMatchSnapshot();
    });
  });

  describe('modifyNodes - batch remove paragraphs', () => {
    it('should remove 7 paragraphs in a single call', async () => {
      // Initialize editor with the JSON fixture
      editor.setDocument('json', removeFixture);
      await moment();

      // Get paragraph count before removal
      const xmlBefore = editor.getDocument('litexml') as unknown as string;
      const paragraphsBefore = [...xmlBefore.matchAll(/<p id="([^"]+)"/g)];
      const initialCount = paragraphsBefore.length;

      const result = await runtime.modifyNodes({
        operations: [
          { action: 'remove', id: 'wps3' },
          { action: 'remove', id: 'w936' },
          { action: 'remove', id: 'vse9' },
          { action: 'remove', id: 'sp45' },
          { action: 'remove', id: 's8f8' },
          { action: 'remove', id: 'rrqb' },
          { action: 'remove', id: 'plu1' },
        ],
      });
      await moment();

      // Verify all operations succeeded
      expect(result.successCount).toBe(7);
      expect(result.totalCount).toBe(7);
      expect(result.results.every((r) => r.success)).toBe(true);
      expect(result.results.every((r) => r.action === 'remove')).toBe(true);

      // Verify paragraphs were removed
      const xmlAfter = editor.getDocument('litexml') as unknown as string;

      // Verify the removed IDs are no longer present
      expect(xmlAfter).not.toContain('id="wps3"');
      expect(xmlAfter).not.toContain('id="w936"');
      expect(xmlAfter).not.toContain('id="vse9"');
      expect(xmlAfter).not.toContain('id="sp45"');
      expect(xmlAfter).not.toContain('id="s8f8"');
      expect(xmlAfter).not.toContain('id="rrqb"');
      expect(xmlAfter).not.toContain('id="plu1"');

      expect(xmlAfter).toMatchSnapshot();
    });
  });

  describe('modifyNodes - remove then add', () => {
    it('should remove 13 paragraphs then insert a list', async () => {
      // Initialize editor with the JSON fixture
      editor.setDocument('json', removeThenAddFixture);
      await moment();

      // First operation: remove 13 paragraphs
      const removeResult = await runtime.modifyNodes({
        operations: [
          { action: 'remove', id: 'x4qr' },
          { action: 'remove', id: 'xfvd' },
          { action: 'remove', id: 'xqzz' },
          { action: 'remove', id: 'zrby' },
          { action: 'remove', id: '02gk' },
          { action: 'remove', id: '0dl6' },
          { action: 'remove', id: '0ops' },
          { action: 'remove', id: '1rnx' },
          { action: 'remove', id: '22sj' },
          { action: 'remove', id: '2dx5' },
          { action: 'remove', id: '3gva' },
          { action: 'remove', id: '3rzw' },
          { action: 'remove', id: '434i' },
        ],
      });

      await moment();

      // Verify all remove operations succeeded
      expect(removeResult.successCount).toBe(13);
      expect(removeResult.totalCount).toBe(13);
      expect(removeResult.results.every((r) => r.success)).toBe(true);
      expect(removeResult.results.every((r) => r.action === 'remove')).toBe(true);

      // Verify the content was removed
      const removed = editor.getDocument('litexml') as unknown as string;
      expect(removed).toMatchSnapshot('remove 13 paragraphs');

      // Second operation: insert a list after wtm5
      const insertResult = await runtime.modifyNodes({
        operations: [
          {
            action: 'insert',
            afterId: 'wtm5',
            litexml:
              '<ul><li>西湖风景区：杭州的灵魂，世界文化遗产</li><li>灵隐寺：杭州最著名的佛教寺庙</li><li>西溪国家湿地公园：中国第一个国家湿地公园</li><li>宋城：以宋代文化为主题的大型主题公园</li></ul>',
          },
        ],
      });
      await moment();

      // Verify insert operation succeeded
      expect(insertResult.successCount).toBe(1);
      expect(insertResult.totalCount).toBe(1);
      expect(insertResult.results.every((r) => r.success)).toBe(true);
      expect(insertResult.results.every((r) => r.action === 'insert')).toBe(true);

      // Verify full output
      const xmlAfter = editor.getDocument('litexml') as unknown as string;
      expect(xmlAfter).toMatchSnapshot('insert new');
    });
  });
});
