import test from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Table, TableRow, TableHeader } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { BookmarkNode, LegacyParagraph, LegacyTableCell, PreserveStructure, toEditor, fromEditor } from '../src/editor.ts'
const schema = getSchema([StarterKit.configure({ paragraph: false }), LegacyParagraph, TextStyleKit, Table, TableRow, LegacyTableCell, TableHeader, TextAlign.configure({ types: ['paragraph'] }), BookmarkNode, PreserveStructure])
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
test('cell shading is displayed so light text on a shaded cell stays visible, and stays out of the save payload', () => {
  const white = run('Disclaimer', { color: '#ffffff' })
  const cell = (id, text, extra = {}) => ({ ...extra, blocks: [{ type: 'paragraph', id, align: 'left', readOnly: false, runs: [text] }] })
  const document = { blocks: [{ type: 'table', rows: [{ cells: [cell('p0', white, { background: '#2562c2' }), cell('p1', run('Injected'), { background: 'red; position: fixed' }), cell('p2', run('Unshaded'))] }] }], bookmarks: [] }
  const doc = schema.nodeFromJSON(toEditor(document))
  const cells = []; doc.descendants(node => { if (node.type.name === 'tableCell') cells.push(node) })
  assert.deepEqual(cells.map(c => c.attrs.background), ['#2562c2', null, null])
  const styles = cells.map(c => schema.nodes.tableCell.spec.toDOM(c)[1].style)
  assert.deepEqual(styles, ['background-color: #2562c2', undefined, undefined])
  assert.deepEqual(fromEditor(doc).paragraphs.map(p => p.runs), [[white], [run('Injected')], [run('Unshaded')]])
})
