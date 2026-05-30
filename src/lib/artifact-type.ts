export type ArtifactType = 'plan' | 'spec' | 'research' | 'postmortem' | 'readme' | 'todo' | 'doc'

export interface ArtifactInfo {
  type: ArtifactType
  label: string
}

const LABELS: Record<ArtifactType, string> = {
  plan: 'Plan',
  spec: 'Spec',
  research: 'Research',
  postmortem: 'Postmortem',
  readme: 'README',
  todo: 'To-Do',
  doc: 'Doc',
}

const info = (type: ArtifactType): ArtifactInfo => ({ type, label: LABELS[type] })

/**
 * Classify a markdown doc by purpose (what kind of agent artifact it is).
 * Filename signals win; otherwise fall back to content heuristics; else 'doc'.
 * Pure — safe to call in any environment.
 */
export function detectArtifactType(fileName: string | null, markdown: string): ArtifactInfo {
  const name = (fileName ?? '').toLowerCase()

  if (/(^|\/)readme(\.|$)/.test(name)) return info('readme')
  if (/(^|\/)(todo|tasks?)(\.|$)/.test(name)) return info('todo')
  if (/postmortem|post-mortem|incident|retro/.test(name)) return info('postmortem')
  if (/plan|roadmap/.test(name)) return info('plan')
  if (/spec|design|rfc|requirement/.test(name)) return info('spec')
  if (/research|analysis|investigation|findings/.test(name)) return info('research')

  const headings = (markdown.match(/^#{1,6}\s+.+$/gm) ?? []).map((h) => h.toLowerCase())
  const hasHeading = (re: RegExp) => headings.some((h) => re.test(h))

  if (hasHeading(/root cause|timeline|impact|action items|incident/)) return info('postmortem')
  if (hasHeading(/requirement|non-goal|architecture|\bdesign\b|api surface/)) return info('spec')
  if (hasHeading(/finding|methodology|sources|hypothesis|references/)) return info('research')

  const checkboxes = (markdown.match(/^\s*[-*]\s+\[[ xX]\]\s+/gm) ?? []).length
  if (checkboxes >= 3) return info('plan')

  return info('doc')
}
