export interface TerminalCaps {
  imageProtocol: 'kitty' | 'sixel' | 'iterm' | 'none'
  truecolor: boolean
  color256: boolean
  unicode: boolean
  mouse: boolean
  hyperlinks: boolean
}

const HYPERLINK_ALLOWLIST = new Set([
  'iTerm.app',
  'WezTerm',
  'vscode',
  'Hyper',
  'Tabby',
  'Alacritty',
  'kitty',
  'Ghostty',
])

const ITERM_PROTOCOL_PROGRAMS = new Set(['iTerm.app', 'WezTerm', 'mintty'])

/** Parse MD_READER_TERM_CAPS override: comma-separated flags */
function parseOverride(raw: string): TerminalCaps {
  const flags = new Set(raw.split(',').map((s) => s.trim().toLowerCase()))

  let imageProtocol: TerminalCaps['imageProtocol'] = 'none'
  if (flags.has('kitty')) imageProtocol = 'kitty'
  else if (flags.has('iterm')) imageProtocol = 'iterm'
  else if (flags.has('sixel')) imageProtocol = 'sixel'

  return {
    imageProtocol,
    truecolor: flags.has('truecolor'),
    color256: flags.has('color256') || flags.has('truecolor'),
    unicode: flags.has('unicode'),
    mouse: flags.has('mouse'),
    hyperlinks: flags.has('hyperlinks'),
  }
}

export function detectTerminalCaps(): TerminalCaps {
  // Manual override takes priority
  const override = process.env.MD_READER_TERM_CAPS
  if (override) {
    return parseOverride(override)
  }

  const term = process.env.TERM ?? ''
  const termProgram = process.env.TERM_PROGRAM ?? ''
  const colorterm = process.env.COLORTERM ?? ''

  // Dumb terminal — everything off
  if (term === 'dumb') {
    return {
      imageProtocol: 'none',
      truecolor: false,
      color256: false,
      unicode: false,
      mouse: false,
      hyperlinks: false,
    }
  }

  // Image protocol (kitty > iterm > none; sixel needs async query)
  let imageProtocol: TerminalCaps['imageProtocol'] = 'none'
  if (term === 'xterm-kitty' || termProgram === 'kitty') {
    imageProtocol = 'kitty'
  } else if (ITERM_PROTOCOL_PROGRAMS.has(termProgram)) {
    imageProtocol = 'iterm'
  }

  // Color
  const truecolor = colorterm === 'truecolor' || colorterm === '24bit'
  const color256 = truecolor || term.includes('256color')

  // Unicode — true unless dumb (already handled above)
  const unicode = true

  // Mouse — true unless dumb; check for xterm/screen/tmux/kitty in TERM or TERM_PROGRAM set
  const mouse =
    /xterm|screen|tmux|kitty/.test(term) || termProgram !== ''

  // Hyperlinks (OSC 8) — allowlist
  const hyperlinks =
    HYPERLINK_ALLOWLIST.has(termProgram) || term === 'xterm-kitty'

  return { imageProtocol, truecolor, color256, unicode, mouse, hyperlinks }
}

let _cache: TerminalCaps | null = null

export function getCachedCaps(): TerminalCaps {
  if (_cache === null) {
    _cache = detectTerminalCaps()
  }
  return _cache
}

export function resetCapsCache(): void {
  _cache = null
}
