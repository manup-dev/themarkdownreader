import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@app/index.css'
import { VscodeApp } from './VscodeApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VscodeApp />
  </StrictMode>,
)
