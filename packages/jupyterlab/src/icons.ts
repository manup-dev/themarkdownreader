// LabIcon for md-reader. JupyterLab recolors monochrome SVGs to match the
// active theme via `currentColor`, so the stroke uses currentColor and the
// SVG ships without a fill.

import { LabIcon } from '@jupyterlab/ui-components'

const svgstr = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
  <rect x="2.5" y="2" width="9" height="12" rx="1.2" stroke="currentColor" stroke-width="1.2" fill="none"/>
  <path d="M4.6 6.5h4.4M4.6 9h4.4M4.6 11.5h2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M11.2 4.6l2 2-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M13.2 6.6h-3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`

export const mdReaderIcon = new LabIcon({
  name: 'md-reader:icon',
  svgstr,
})
