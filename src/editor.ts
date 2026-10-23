import { Extension, Node, mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import ParagraphExtension from '@tiptap/extension-paragraph'
import { Plugin } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Anchor, Block, Bookmark, LegacyDocument, Run, SavePayload } from './types'

export const LegacyParagraph = ParagraphExtension.extend({
  addAttributes() { return { ...this.parent?.(), blockId: { default: null, renderHTML: a => ({ 'data-block-id': a.blockId }) }, locked: { default: false, renderHTML: a => a.locked ? { 'data-locked': 'true', contenteditable: 'false' } : {} } } },
  addKeyboardShortcuts() { return { Enter: () => this.editor.commands.setHardBreak() } },
})
export const BookmarkNode = Node.create({
  name: 'bookmark', group: 'inline', inline: true, atom: true, selectable: false,
  addAttributes() { return { name: { default: '' }, edge: { default: 'point' } } },
  parseHTML() { return [{ tag: 'span[data-bookmark]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-bookmark': node.attrs.name, 'data-edge': node.attrs.edge, class: 'bookmark-anchor', contenteditable: 'false', title: `${node.attrs.name} · ${node.attrs.edge}` }), node.attrs.edge === 'end' ? '⌟' : '⌜'] },
})
export const PreserveStructure = Extension.create({
  name: 'preserveStructure',
  addProseMirrorPlugins() { return [new Plugin({ filterTransaction(tr, state) {
    if (!tr.docChanged || tr.getMeta('replaceDocument')) return true
    const paragraphs = (doc: PMNode) => { const rows: PMNode[] = []; doc.descendants(n => { if (n.type.name === 'paragraph') rows.push(n) }); return rows }
    const before = paragraphs(state.doc), after = paragraphs(tr.doc)
    if (!before.some(n => n.attrs.blockId)) return true
    return before.length === after.length && before.every((n, i) => n.attrs.blockId === after[i].attrs.blockId && (!n.attrs.locked || n.eq(after[i])))
  } })] },
})
function marks(run: Run) {
  const result: NonNullable<JSONContent['marks']> = [{ type: 'textStyle', attrs: { fontFamily: run.font, fontSize: `${run.size}pt`, color: run.color } }]
  if (run.bold) result.push({ type: 'bold' })
  if (run.italic) result.push({ type: 'italic' })
  if (run.underline) result.push({ type: 'underline' })
  return result
}
export function toEditor(document: LegacyDocument): JSONContent {
  const anchors = new Map<string, { offset: number; name: string; edge: string }[]>()
  for (const b of document.bookmarks) {
    const collapsed = b.start.blockId === b.end.blockId && b.start.offset === b.end.offset
    for (const [edge, anchor] of (collapsed ? [['point', b.start]] : [['start', b.start], ['end', b.end]]) as [string, Anchor][]) {
      const list = anchors.get(anchor.blockId) ?? []; list.push({ offset: anchor.offset, name: b.name, edge }); anchors.set(anchor.blockId, list)
    }
  }
  const convert = (blocks: Block[]): JSONContent[] => blocks.map(block => {
    if (block.type === 'table') {
      const columns = Math.max(1, ...block.rows.map(row => row.cells.length))
      return { type: 'table', content: block.rows.map(row => ({ type: 'tableRow', content: row.cells.map((cell, index) => ({ type: 'tableCell', attrs: { colspan: cell.colspan ?? Math.floor((index + 1) * columns / row.cells.length) - Math.floor(index * columns / row.cells.length) }, content: convert(cell.blocks) })) })) }
    }
    const points = [...(anchors.get(block.id) ?? [])].sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
    const content: JSONContent[] = []
    let offset = 0
    const insertAnchors = () => { while (points[0]?.offset === offset) { const p = points.shift()!; content.push({ type: 'bookmark', attrs: { name: p.name, edge: p.edge } }) } }
    for (const run of block.runs) {
      for (const text of run.text.split(/(\n)/)) {
        insertAnchors()
        if (text === '\n') { content.push({ type: 'hardBreak', marks: marks(run) }); offset++; continue }
        let position = 0
        while (position < text.length) {
          insertAnchors()
          const end = points[0] ? Math.min(text.length, position + points[0].offset - offset) : text.length
          if (end <= position) { points.shift(); continue }
          content.push({ type: 'text', text: text.slice(position, end), marks: marks(run) })
          offset += end - position; position = end
        }
      }
    }
    insertAnchors()
    return { type: 'paragraph', attrs: { blockId: block.id, locked: block.readOnly, textAlign: block.align }, content }
  })
  return { type: 'doc', content: convert(document.blocks) }
}
export function fromEditor(doc: PMNode): SavePayload {
  const paragraphs: SavePayload['paragraphs'] = []
  const bookmarks = new Map<string, Partial<Bookmark>>()
  doc.descendants(node => {
    if (node.type.name !== 'paragraph') return
    const runs: Run[] = []; let offset = 0
    node.forEach(child => {
      if (child.type.name === 'bookmark') {
        const b: Partial<Bookmark> = bookmarks.get(child.attrs.name) ?? { name: child.attrs.name }; const anchor = { blockId: node.attrs.blockId, offset }
        if (child.attrs.edge === 'point') { b.start = anchor; b.end = anchor } else if (child.attrs.edge === 'start') b.start = anchor; else b.end = anchor
        bookmarks.set(child.attrs.name, b); return
      }
      const text = child.type.name === 'hardBreak' ? '\n' : child.text ?? ''
      const style = child.marks.find(m => m.type.name === 'textStyle')?.attrs ?? {}
      const run = { text, font: style.fontFamily ?? 'Arial', size: parseFloat(style.fontSize ?? '11'), color: style.color ?? '#20242b', bold: child.marks.some(m => m.type.name === 'bold'), italic: child.marks.some(m => m.type.name === 'italic'), underline: child.marks.some(m => m.type.name === 'underline') }
      const last = runs.at(-1)
      if (last && ['font', 'size', 'color', 'bold', 'italic', 'underline'].every(key => last[key as keyof Run] === run[key as keyof Run])) last.text += text
      else runs.push(run)
      offset += text.length
    })
    paragraphs.push({ id: node.attrs.blockId, runs })
  })
  const valid: Bookmark[] = []
  for (const b of bookmarks.values()) if (b.start || b.end) valid.push({ name: b.name!, start: b.start ?? b.end!, end: b.end ?? b.start! })
  return { paragraphs, bookmarks: valid }
}
