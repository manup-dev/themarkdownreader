// PostCSS config for @md-reader/react. The build-css script imports
// postcss-prefix-selector directly (see scripts/build-css.mjs); this config
// is here for ad-hoc tools (postcss-cli, IDEs) that auto-pick it up.

const prefixer = require('postcss-prefix-selector')

const PREFIX = '.md-reader-jupyter'

module.exports = {
  plugins: [
    prefixer({
      prefix: PREFIX,
      transform(prefix, selector, prefixedSelector) {
        if (selector === ':root' || selector === 'html' || selector === 'body') return prefix
        if (selector.startsWith('@')) return selector
        return prefixedSelector
      },
    }),
  ],
}
