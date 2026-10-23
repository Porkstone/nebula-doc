import { DocumentEngine, locateEngine } from '../electron/engine.mjs'
import path from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
const root = process.cwd()
const engine = new DocumentEngine(locateEngine(root), path.join(root, 'engine/worker.py'))
try {
  await engine.start()
  const document = await engine.request('open', { path: process.argv[2] })
  await mkdir('test-output', { recursive: true })
  await writeFile('test-output/sample.json', JSON.stringify(document, null, 2))
  const flatten = blocks => blocks.flatMap(b => b.type === 'paragraph' ? [b] : b.rows.flatMap(r => r.cells.flatMap(c => flatten(c.blocks))))
  console.log(JSON.stringify({ name: document.name, pages: document.pages, paragraphs: flatten(document.blocks).length, bookmarkCount: document.bookmarkCount, editableBookmarks: document.bookmarks.length, firstBookmarks: document.bookmarks.slice(0, 6), text: flatten(document.blocks).map(p => p.runs.map(r => r.text).join('')).join('\n').slice(0, 2500) }, null, 2))
} finally { await engine.close() }
