import MarkdownIt from 'markdown-it';
import { trim } from 'lodash-es';


const tokenType = 'ob_img';

// Module-level constant: avoids recompiling on every inline token parse
const WIKILINK_IMAGE_RE = /^!\[\[([^|\]\n]+)(\|([^\]\n]+))?\]\]/;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface MarkdownItImageActionParams {
  src: string;
  width?: string;
  height?: string;
}

interface MarkdownItImagePluginOptions {
  doWithImage: (img: MarkdownItImageActionParams) => void;
}

const pluginOptions: MarkdownItImagePluginOptions = {
  doWithImage: () => {},
}

export const MarkdownItImagePluginInstance = {
  plugin: plugin,
  doWithImage: (action: (img: MarkdownItImageActionParams) => void) => {
    pluginOptions.doWithImage = action;
  },
}

function plugin(md: MarkdownIt): void {
  md.inline.ruler.after('image', tokenType, (state, silent) => {
    const match = state.src.slice(state.pos).match(WIKILINK_IMAGE_RE);
    if (match) {
      if (silent) {
        return true;
      }
      const token = state.push(tokenType, 'img', 0);
      const matched = match[0];
      const src = match[1];
      const size = match[3];
      let width: string | undefined;
      let height: string | undefined;
      if (size) {
        const sepIndex = size.indexOf('x'); // width x height
        if (sepIndex > 0) {
          width = trim(size.substring(0, sepIndex));
          height = trim(size.substring(sepIndex + 1));
          token.attrs = [
            [ 'src', src ],
            [ 'width', width ],
            [ 'height', height ],
          ];
        } else {
          width = trim(size);
          token.attrs = [
            [ 'src', src ],
            [ 'width', width ],
          ];
        }
      } else {
        token.attrs = [
          [ 'src', src ],
        ];
      }
      if (pluginOptions.doWithImage) {
        pluginOptions.doWithImage({
          src: token.attrs?.[0]?.[1],
          width: token.attrs?.[1]?.[1],
          height: token.attrs?.[2]?.[1],
        });
      }
      state.pos += matched.length;
      return true;
    } else {
      return false;
    }
  });
  md.renderer.rules.ob_img = (tokens: MarkdownIt.Token[], idx: number) => {
    const token = tokens[idx];
    const src = escapeAttr(token.attrs?.[0]?.[1] ?? '');
    const width = token.attrs?.[1]?.[1];
    const height = token.attrs?.[2]?.[1];
    if (width) {
      if (height) {
        return `<img src="${src}" width="${escapeAttr(width)}" height="${escapeAttr(height)}" alt="">`;
      }
      return `<img src="${src}" width="${escapeAttr(width)}" alt="">`;
    } else {
      return `<img src="${src}" alt="">`;
    }
  };
}
