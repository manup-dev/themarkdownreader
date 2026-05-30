import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Root } from 'mdast'

// Curated source-file extensions so we match real code citations and skip
// times (12:30), versions (v3.14:15), and URLs (example.com:8080).
const EXT =
  'tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|cc?|hh?|cpp|hpp|cs|php|swift|kt|scala|' +
  'md|mdx|json|ya?ml|toml|sh|bash|zsh|sql|css|scss|less|html|vue|svelte|astro'

// path/to/file.ext:line  (optionally :col or -endline)
const CITE = new RegExp(`([\\w./-]+\\.(?:${EXT})):(\\d+)(?:[-:](\\d+))?`, 'gi')

/**
 * Remark plugin: turn `file.ext:line` citations in prose into clickable
 * `cite:`-scheme links. Reader's <a> handler intercepts the scheme to copy
 * the reference to the clipboard. Text inside existing links is left alone;
 * inline/fenced code is never a text node so it is untouched.
 */
export function remarkCitations() {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        [
          CITE,
          (match: string) => ({
            type: 'link' as const,
            url: 'cite:' + match,
            children: [{ type: 'text' as const, value: match }],
          }),
        ],
      ],
      { ignore: ['link', 'linkReference'] }
    )
  }
}
