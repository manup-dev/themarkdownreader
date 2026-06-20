import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CloudUnavailableError,
  LocalCloudBackend,
  getCloudBackend,
  isCloudEnabled,
  registerCloudBackend,
  resetCloudBackend,
  type CloudBackend,
} from '../lib/cloud'

afterEach(() => resetCloudBackend())

describe('LocalCloudBackend (public default)', () => {
  it('reports local mode and a signed-out state', () => {
    const b = new LocalCloudBackend()
    expect(b.mode).toBe('local')
    const s = b.getAuthState()
    expect(s).toEqual({ mode: 'local', user: null, org: null })
  })

  it('onAuthChange never emits and unsubscribe is safe', () => {
    const b = new LocalCloudBackend()
    const listener = vi.fn()
    const unsub = b.onAuthChange(listener)
    unsub()
    expect(listener).not.toHaveBeenCalled()
  })

  it('signOut is an idempotent no-op; signIn rejects', async () => {
    const b = new LocalCloudBackend()
    await expect(b.signOut()).resolves.toBeUndefined()
    await expect(b.signIn()).rejects.toBeInstanceOf(CloudUnavailableError)
  })

  it('listDocuments returns empty in local mode', async () => {
    await expect(new LocalCloudBackend().listDocuments()).resolves.toEqual([])
  })

  it('cloud-only capabilities reject with CloudUnavailableError', async () => {
    const b = new LocalCloudBackend()
    await expect(b.pushEvents('doc', [])).rejects.toBeInstanceOf(
      CloudUnavailableError,
    )
    await expect(b.pullEvents('doc')).rejects.toBeInstanceOf(
      CloudUnavailableError,
    )
    await expect(
      b.createPersistentShare('doc', { scope: 'link' }),
    ).rejects.toBeInstanceOf(CloudUnavailableError)
  })

  it('aiProxy rejects when iterated in local mode', async () => {
    const b = new LocalCloudBackend()
    const iterate = async () => {
      for await (const _chunk of b.aiProxy({ messages: [] })) {
        void _chunk // unreachable — aiProxy throws before yielding
      }
    }
    await expect(iterate()).rejects.toBeInstanceOf(CloudUnavailableError)
  })
})

describe('registry injection point', () => {
  it('defaults to the local backend', () => {
    expect(getCloudBackend().mode).toBe('local')
    expect(isCloudEnabled()).toBe(false)
  })

  it('registerCloudBackend installs a hosted backend and reports enabled', () => {
    const fake: CloudBackend = {
      ...new LocalCloudBackend(),
      mode: 'cloud',
      getAuthState: () => ({ mode: 'cloud', user: null, org: null }),
    } as CloudBackend

    registerCloudBackend(fake)
    expect(getCloudBackend()).toBe(fake)
    expect(isCloudEnabled()).toBe(true)

    resetCloudBackend()
    expect(getCloudBackend().mode).toBe('local')
    expect(isCloudEnabled()).toBe(false)
  })
})
