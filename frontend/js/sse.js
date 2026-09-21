import { createParser } from './vendor/eventsource-parser/index.js'

export async function* readSSE(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const events = []
  const parser = createParser({ onEvent: (event) => events.push(event), maxBufferSize: 4 * 1024 * 1024 })
  try {
    while (true) {
      const { done, value } = await reader.read()
      parser.feed(done ? decoder.decode() : decoder.decode(value, { stream: true }))
      for (const event of events.splice(0)) yield event
      if (done) break
    }
  } finally {
    try { await reader.cancel() } catch { /* A failed or aborted stream is already closed. */ }
    reader.releaseLock()
  }
}
