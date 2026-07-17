// Validates the browser extension is Web-Store-uploadable: manifest parses,
// every referenced file exists, host matches are narrow (no <all_urls> in
// required content_scripts — that's the slow-review path we just escaped).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../browser-extension')
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1) }

if (manifest.manifest_version !== 3) fail('not MV3')
if (!manifest.version) fail('missing version')

const referenced = [
  ...Object.values(manifest.icons ?? {}),
  manifest.action?.default_popup,
  manifest.action?.default_icon,
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
].filter(Boolean)
for (const f of referenced) {
  if (!existsSync(path.join(dir, f))) fail(`manifest references missing file: ${f}`)
}

for (const cs of manifest.content_scripts ?? []) {
  if (!cs.matches?.length) fail('content_script with empty matches')
  const BROAD = ['<all_urls>', 'https://*/*', 'http://*/*', '*://*/*']
  if (cs.matches.some((m) => BROAD.includes(m))) fail('overly broad match in required content_scripts — use optional_host_permissions')
}
// C12: the popup's host handling must cover every content-script host, and
// optional_host_permissions must not be declared without a
// chrome.permissions.request call to ever grant it.
const popup = readFileSync(path.join(dir, 'popup.js'), 'utf-8')
for (const cs of manifest.content_scripts ?? []) {
  for (const m of cs.matches) {
    const host = new URL(m.replace('*', 'x')).hostname
    if (!popup.includes(host)) fail(`popup.js does not handle content-script host: ${host}`)
  }
}
if (manifest.optional_host_permissions) {
  fail('optional_host_permissions declared but never requested (no chrome.permissions.request in the extension)')
}

console.log(`PASS: extension manifest v${manifest.version} (${referenced.length} files verified)`)
