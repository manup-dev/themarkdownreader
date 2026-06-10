export type ImageProtocol = 'kitty' | 'sixel' | 'iterm' | 'none'

const KITTY_CHUNK_SIZE = 4096

export function encodeInlineImage(pngBuffer: Buffer, protocol: ImageProtocol): string {
  switch (protocol) {
    case 'none':
      return ''

    case 'iterm': {
      const base64 = pngBuffer.toString('base64')
      return `\x1b]1337;File=inline=1;size=${pngBuffer.length};width=auto;height=auto;preserveAspectRatio=1:${base64}\x07`
    }

    case 'kitty': {
      const base64 = pngBuffer.toString('base64')
      if (base64.length <= KITTY_CHUNK_SIZE) {
        // Single chunk
        return `\x1b_Ga=T,f=100,t=d;${base64}\x1b\\`
      }
      // Multi-chunk
      const chunks: string[] = []
      for (let i = 0; i < base64.length; i += KITTY_CHUNK_SIZE) {
        chunks.push(base64.slice(i, i + KITTY_CHUNK_SIZE))
      }
      const parts: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (i === 0) {
          parts.push(`\x1b_Ga=T,f=100,t=d,m=1;${chunk}\x1b\\`)
        } else if (i === chunks.length - 1) {
          parts.push(`\x1b_Gm=0;${chunk}\x1b\\`)
        } else {
          parts.push(`\x1b_Gm=1;${chunk}\x1b\\`)
        }
      }
      return parts.join('')
    }

    case 'sixel':
      return '[Sixel rendering not yet implemented — use MD_READER_TERM_CAPS=iterm or view in browser]'
  }
}
