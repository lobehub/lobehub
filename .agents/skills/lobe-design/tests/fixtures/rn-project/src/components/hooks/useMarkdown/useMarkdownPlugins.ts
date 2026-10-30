// RN 复用 web 包里平台无关的 Markdown 插件与工具（#2：不是 DOM 组件，不报 LOBE-RN-DOM-UI）
import { rehypeKatexDir } from '@lobehub/ui/es/Markdown/plugins/rehypeKatexDir';
import { remarkCustomFootnotes } from '@lobehub/ui/es/Markdown/plugins/remarkCustomFootnotes';
import { preprocessMarkdownContent } from '@lobehub/ui/es/hooks/useMarkdown/utils';

export const useMarkdownPlugins = () => ({ preprocess: preprocessMarkdownContent, rehype: [rehypeKatexDir], remark: [remarkCustomFootnotes] });
