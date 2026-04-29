import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const VENDORED = join(HERE, '..', 'src', 'lib', 'annotation-events.ts')
const PARENT   = join(HERE, '..', '..', 'src', 'lib', 'annotation-events.ts')

const vendored = readFileSync(VENDORED, 'utf8')
let parent
try {
  parent = readFileSync(PARENT, 'utf8')
} catch {
  console.warn('check-vendored-sync: parent annotation-events.ts not found at ' + PARENT)
  console.warn('  (this is OK in CI where the github-integration package is consumed standalone)')
  process.exit(0)
}

// We can't expect them to match byte-for-byte (vendored inlines the type imports),
// so we compare the function signatures and op constants instead.
const sigs = (s) => s.match(/export (?:function|const|interface|class|type)[^\n=({]+/g) ?? []
const vendoredSigs = sigs(vendored).sort()
const parentSigs   = sigs(parent).sort()

const missing = parentSigs.filter((s) => !vendoredSigs.includes(s))
const extra   = vendoredSigs.filter((s) => !parentSigs.includes(s))

if (missing.length || extra.length) {
  console.warn('check-vendored-sync: vendored copy has drifted from parent.')
  if (missing.length) console.warn('  Missing from vendored: ' + missing.join('; '))
  if (extra.length)   console.warn('  Extra in vendored:    ' + extra.join('; '))
  console.warn('Update github-integration/src/lib/annotation-events.ts to match.')
  // In CI, fail the build. Locally, just warn so dev iterations stay fast.
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
    process.exit(1)
  }
}
