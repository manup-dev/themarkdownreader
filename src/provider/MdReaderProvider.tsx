import { type ReactNode } from 'react'
import type { StorageAdapter } from '../types/storage-adapter'
import { AdapterContext } from './AdapterContext'

interface MdReaderProviderProps {
  adapter: StorageAdapter
  children: ReactNode
}

export function MdReaderProvider({ adapter, children }: MdReaderProviderProps) {
  return (
    <AdapterContext.Provider value={adapter}>
      {children}
    </AdapterContext.Provider>
  )
}
