import test from 'node:test'
import assert from 'node:assert/strict'
import { streamChat, setTransportOverride } from '../js/api.js'

const profile = { baseUrl: 'https://stream.test/v1', apiKey: 'test' }
function response(text, cut) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, cut))
    controller.enqueue(bytes.slice(cut))
    controller.close()
  } }))
}
async function collect() {
  const events = []
  for await (const event of streamChat(profile, { mode: 'chat_completions', model: 'test', messages: [] })) events.push(event)
  return events
}
for (const transport of ['direct', 'proxy']) {
  for (const newline of ['\n', '\r\n', '\r']) {
    test(`${transport}: ${JSON.stringify(newline)} and every byte boundary preserve Chinese UTF-8`, async (t) => {
      setTransportOverride(transport)
      t.after(() => setTransportOverride(''))
      const content = transport === 'direct'
        ? 'data: {"choices":[{"delta":{"content":"中文内容"}}]}'
        : 'event: content' + newline + 'data: {"text":"中文内容"}'
      const done = transport === 'direct' ? 'data: [DONE]' : 'event: done' + newline + 'data: {}'
      const stream = content + newline + newline + done + newline + newline
      for (let cut = 1; cut < new TextEncoder().encode(stream).length; cut++) {
        t.mock.method(globalThis, 'fetch', async () => response(stream, cut))
        const events = await collect()
        assert.equal(events.filter((e) => e.event === 'content').map((e) => e.data.text).join(''), '中文内容')
        assert.equal(events.at(-1).event, 'done')
      }
    })
  }
}
test('empty replies and prematurely closed streams never report success', async (t) => {
  setTransportOverride('direct'); t.after(() => setTransportOverride(''))
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n'))
  await assert.rejects(collect(), /没有返回任何内容/)
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
  await assert.rejects(collect(), /尚未完成/)
})
