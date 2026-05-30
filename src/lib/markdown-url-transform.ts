import { defaultUrlTransform } from 'react-markdown'

/**
 * react-markdown's defaultUrlTransform drops any non-safe URL scheme. We
 * additionally allow:
 *   - data:image/ and blob:  — inline / folder-resolved image sources
 *   - cite:                  — the grounding-citation scheme; Reader's <a>
 *                              handler intercepts it to copy the reference
 * Everything else keeps the default sanitising, so dangerous schemes like
 * javascript: are still stripped.
 */
export function markdownUrlTransform(url: string): string {
  if (/^data:image\//i.test(url) || /^blob:/i.test(url) || /^cite:/i.test(url)) return url
  return defaultUrlTransform(url)
}
