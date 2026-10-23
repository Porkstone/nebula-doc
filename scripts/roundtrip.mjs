import { DocumentEngine, locateEngine } from '../electron/engine.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const input = process.argv[2]
if (!input) throw new Error('Usage: pnpm test:sample <path-to-sample.doc>')
const root = process.cwd(), output = path.join(root, 'test-output', 'roundtrip.doc')
const engine = new DocumentEngine(locateEngine(root), path.join(root, 'engine/worker.py'))
const flatten = blocks => blocks.flatMap(b => b.type === 'paragraph' ? [b] : b.rows.flatMap(r => r.cells.flatMap(c => flatten(c.blocks))))
try {
  await mkdir(path.dirname(output), { recursive: true })
  const originalBytes = await readFile(input)
  await engine.start()
  const original = await engine.request('open', { path: input })
  const paragraphs = flatten(original.blocks).map(p => ({ id: p.id, runs: structuredClone(p.runs) }))
  const bookmark = original.bookmarks.find(b => b.name === 'CustomerName')
  assert.ok(bookmark, 'sample has CustomerName bookmark')
  const para = paragraphs.find(p => p.id === bookmark.start.blockId)
  const text = para.runs.map(r => r.text).join('')
  assert.equal(bookmark.start.offset, text.length)
  para.runs.push({ text: 'Alex Morgan', font: 'Georgia', size: 14, bold: true, italic: true, underline: true, color: '#532a70' })
  bookmark.end.offset += 'Alex Morgan'.length
  const renamed = original.bookmarks.find(b => b.name === 'DealerName')
  renamed.name = 'SupplierName'
  const removed = original.bookmarks.pop()
  original.bookmarks.push({ name: 'RoundTripTest', start: { blockId: para.id, offset: 0 }, end: { blockId: para.id, offset: 4 } })
  await engine.request('save', { path: output, paragraphs, bookmarks: original.bookmarks })
  // Save twice against the same loaded document to exercise live UNO ranges.
  para.runs.at(-1).text = 'Alex Morgan Jr\nSecond line'
  bookmark.end.offset += 3 + '\nSecond line'.length
  await engine.request('save', { path: output, paragraphs, bookmarks: original.bookmarks })
  const reopened = await engine.request('open', { path: output })
  const edited = flatten(reopened.blocks).find(p => p.id === para.id)
  assert.equal(edited.runs.map(r => r.text).join(''), text + 'Alex Morgan Jr\nSecond line')
  const run = edited.runs.find(r => r.text.includes('Alex Morgan Jr'))
  assert.equal(run.font, 'Georgia'); assert.equal(run.size, 14); assert.equal(run.bold, true); assert.equal(run.italic, true); assert.equal(run.underline, true); assert.equal(run.color, '#532a70')
  assert.equal(reopened.bookmarkCount, original.bookmarkCount)
  assert.ok(reopened.bookmarks.some(b => b.name === 'SupplierName'))
  assert.ok(!reopened.bookmarks.some(b => b.name === 'DealerName'))
  assert.ok(reopened.bookmarks.some(b => b.name === 'RoundTripTest'))
  assert.ok(!reopened.bookmarks.some(b => b.name === removed.name))
  assert.equal(reopened.bookmarks.find(b => b.name === 'CustomerName').end.offset, bookmark.end.offset)
  assert.equal(flatten(reopened.blocks).length, paragraphs.length)
  assert.equal((await readFile(output)).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
  assert.deepEqual(await readFile(input), originalBytes, 'original sample is untouched')
  await assert.rejects(engine.request('open', { path: input.replace(/\.doc$/i, '.docx') }), /\.doc/)
  console.log(`PASS: text, font family/size/color/styles, bookmark range/create/rename/delete, ${reopened.bookmarkCount} retained bookmarks, repeated save, binary .doc signature, .docx rejection, original untouched.\nOutput: ${output}`)
} finally { await engine.close() }
