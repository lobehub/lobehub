const folderClosedSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/></svg>`;
const folderOpenSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H18a2 2 0 0 1 2 2v2'/></svg>`;

// PierreFileTree only renders a chevron in [data-item-section="icon"] for
// directories; inject the visible folder glyph into the content cell.
export const FOLDER_ICON_CSS = `
  [data-item-type="folder"] [data-item-section="content"] {
    display: flex;
    align-items: center;
  }
  [data-item-type="folder"] [data-item-section="content"]::before {
    content: '';
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-inline-end: 6px;
    background-color: currentColor;
    -webkit-mask: url("data:image/svg+xml;utf8,${folderClosedSvg}") no-repeat center / contain;
    mask: url("data:image/svg+xml;utf8,${folderClosedSvg}") no-repeat center / contain;
    opacity: 0.85;
  }
  [data-item-type="folder"][aria-expanded="true"] [data-item-section="content"]::before {
    -webkit-mask-image: url("data:image/svg+xml;utf8,${folderOpenSvg}");
    mask-image: url("data:image/svg+xml;utf8,${folderOpenSvg}");
  }
`;
