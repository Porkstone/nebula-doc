import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { BookmarkNode, LegacyParagraph, PreserveStructure, toEditor, fromEditor } from '../src/editor.ts'
const schema = getSchema([StarterKit.configure({ paragraph: false }), LegacyParagraph, TextStyleKit, Table, TableRow, TableCell, TableHeader, TextAlign.configure({ types: ['paragraph'] }), BookmarkNode, PreserveStructure])
const run = (text, style = {}) => ({ text, font: 'Georgia', size: 12, bold: false, italic: true, underline: false, color: '#112233', ...style })
test('bookmarks retain UTF-16 positions across styled text, emoji, hard breaks and table cells', () => {
  const document = { blocks: [{ type: 'paragraph', id: 'p0', align: 'left', readOnly: false, runs: [run('Hello 😀\n'), run('World', { bold: true })] }, { type: 'table', rows: [{ cells: [{ blocks: [{ type: 'paragraph', id: 'p1', align: 'left', readOnly: false, runs: [run('Cell')] }] }] }] }], bookmarks: [
    { name: 'Range', start: { blockId: 'p0', offset: 0 }, end: { blockId: 'p0', offset: 13 } },
    { name: 'Point', start: { blockId: 'p0', offset: 8 }, end: { blockId: 'p0', offset: 8 } },
    { name: 'Cell', start: { blockId: 'p1', offset: 0 }, end: { blockId: 'p1', offset: 4 } },
  ] }
  const result = fromEditor(schema.nodeFromJSON(toEditor(document)))
  assert.deepEqual(result.paragraphs.map(p => p.runs), [document.blocks[0].runs, document.blocks[1].rows[0].cells[0].blocks[0].runs])
  assert.deepEqual(result.bookmarks.sort((a,b) => a.name.localeCompare(b.name)), document.bookmarks.sort((a,b) => a.name.localeCompare(b.name)))
})
test('partially deleted range collapses to its remaining endpoint', () => {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'p0' }, content: [{ type: 'text', text: 'Hello' }, { type: 'bookmark', attrs: { name: 'Test', edge: 'end' } }] }] })
  const result = fromEditor(doc)
  assert.deepEqual(result.bookmarks, [{ name: 'Test', start: { blockId: 'p0', offset: 5 }, end: { blockId: 'p0', offset: 5 } }])
})
