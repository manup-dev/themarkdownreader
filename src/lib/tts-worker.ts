/**
 * Web Worker for Kokoro TTS synthesis.
 * Runs ONNX inference off the main thread so UI never freezes.
 *
 * Message protocol:
 *   Main → Worker: { type: 'init', id, device?, dtype? }
 *   Main → Worker: { type: 'synthesize', id, text, voice }
 *   Worker → Main: { type: 'ready', id }
 *   Worker → Main: { type: 'progress', id, pct, text }
 *   Worker → Main: { type: 'pcm', id, audio: Float32Array, sampleRate }
 *   Worker → Main: { type: 'error', id, message }
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null

self.onmessage = async (e: MessageEvent) => {
  const { type, id, ...payload } = e.data

  try {
    switch (type) {
      case 'init': {
        const { KokoroTTS } = await import('kokoro-js')
        const device = payload.device ?? 'wasm'
        const dtype = payload.dtype ?? 'q8'

        tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype,
          device,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          progress_callback: (p: any) => {
            if (p.progress != null) {
              self.postMessage({ type: 'progress', id, pct: p.progress, text: `Loading voice model (${device})...` })
            }
          },
        })

        self.postMessage({ type: 'ready', id })
        break
      }

      case 'synthesize': {
        if (!tts) {
          self.postMessage({ type: 'error', id, message: 'TTS not initialized' })
          return
        }
        const result = await tts.generate(payload.text, { voice: payload.voice ?? 'af_heart' })
        const pcm: Float32Array = result.audio
        const sampleRate: number = result.sampling_rate

        // Transfer the buffer zero-copy (no clone)
        self.postMessage(
          { type: 'pcm', id, audio: pcm, sampleRate },
          { transfer: [pcm.buffer] }
        )
        break
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
