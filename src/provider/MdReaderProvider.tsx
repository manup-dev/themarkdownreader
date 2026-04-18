import { createContext, type ReactNode } from 'react'
import type { StorageAdapter } from '../types/storage-adapter'

export const AdapterContext = createContext<StorageAdapter | null>(null)

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
