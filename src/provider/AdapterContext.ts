import { createContext } from 'react'
import type { StorageAdapter } from '../types/storage-adapter'

export const AdapterContext = createContext<StorageAdapter | null>(null)
