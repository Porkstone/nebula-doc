import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { EditorState } from '@tiptap/pm/state'
import { ArrowDownToLine, ArrowUpRight, Bookmark as BookmarkIcon, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, FileText, FolderOpen, LoaderCircle, Minus, Plus, Search, ShieldCheck, Sparkles, X, Bold, Italic, Underline, Undo2, Redo2, Pencil, Trash2, Copy, PanelLeftClose } from 'lucide-react'
import { BookmarkNode, fromEditor, LegacyParagraph, PreserveStructure, toEditor } from './editor'
import type { EngineStatus, LegacyDocument } from './types'

const fonts = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']
const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
export default function App() {
  const [document, setDocument] = useState<LegacyDocument | null>(null)
  const [status, setStatus] = useState<EngineStatus>({ available: false, message: 'Checking local engine…' })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(100)
  const [, setRevision] = useState(0)
  const [bookmarkName, setBookmarkName] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [activeBookmark, setActiveBookmark] = useState('')
  const loading = useRef(false)
  const editor = useEditor({
    extensions: [StarterKit.configure({ paragraph: false, heading: false, blockquote: false, codeBlock: false, horizontalRule: false, bulletList: false, orderedList: false, listItem: false, link: false, strike: false, code: false }), LegacyParagraph, TextStyleKit, Table.configure({ resizable: false }), TableRow, TableCell, TableHeader, TextAlign.configure({ types: ['paragraph'] }), BookmarkNode, PreserveStructure],
    content: '<p></p>', editable: false,
    editorProps: { attributes: { 'aria-label': 'Document text editor', spellcheck: 'true' }, handleDrop: () => true },
    onUpdate: () => { if (!loading.current) { setRevision(r => r + 1); setDirty(true); window.nebula?.setDirty(true) } },
  })
  const selection = useEditorState({ editor, selector: ({ editor: e }) => ({ bold: e?.isActive('bold') ?? false, italic: e?.isActive('italic') ?? false, underline: e?.isActive('underline') ?? false, fontFamily: e?.getAttributes('textStyle').fontFamily as string | undefined, fontSize: e?.getAttributes('textStyle').fontSize as string | undefined, color: e?.getAttributes('textStyle').color as string | undefined }) })
  const payload = editor && document ? fromEditor(editor.state.doc) : null
  const bookmarks = payload?.bookmarks ?? []
  const words = payload?.paragraphs.map(p => p.runs.map(r => r.text).join('')).join(' ').match(/\S+/g)?.length ?? 0
  useEffect(() => { if (window.nebula) window.nebula.status().then(setStatus).catch(e => setError(e.message)); else setStatus({ available: false, message: 'Browser preview · open the Electron app to edit .doc files' }) }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer) }, [notice])
  const openDocument = useCallback(async () => {
    if (!window.nebula || !editor) return
    setBusy('Opening document'); setError('')
    try {
      const result = await window.nebula.open()
      if (!result) return
      loading.current = true
      editor.view.updateState(EditorState.create({ doc: editor.schema.nodeFromJSON(toEditor(result)), plugins: editor.state.plugins }))
      editor.setEditable(true)
      setDocument(result); setDirty(false); setActiveBookmark(''); setRevision(0)
      setNotice(`Opened ${result.name}`)
    } catch (e) { setError((e as Error).message) }
    finally { loading.current = false; setBusy('') }
  }, [editor])
  const saveDocument = useCallback(async (saveAs = false) => {
    if (!window.nebula || !editor || !document) return
    setBusy('Saving .doc'); setError(''); editor.setEditable(false)
    try {
      const result = await window.nebula.save(fromEditor(editor.state.doc), saveAs)
      if (result) { setDocument({ ...document, ...result }); setDirty(false); window.nebula.setDirty(false); setNotice('Saved as Word 97–2003 .doc') }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(''); editor.setEditable(true) }
  }, [editor, document])
  useEffect(() => window.nebula?.onMenu(action => { if (action === 'open') void openDocument(); if (action === 'save') void saveDocument(); if (action === 'saveAs') void saveDocument(true) }), [openDocument, saveDocument])
  function goToBookmark(name: string) {
    if (!editor) return
    let position = -1
    editor.state.doc.descendants((node, pos) => { if (position === -1 && node.type.name === 'bookmark' && node.attrs.name === name) position = pos })
    if (position >= 0) { editor.chain().focus().setTextSelection(position + 1).scrollIntoView().run(); setActiveBookmark(name) }
  }
  function removeBookmark(name: string) {
    if (!editor) return
    const transaction = editor.state.tr, positions: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'bookmark' && node.attrs.name === name) positions.push(pos) })
    for (const pos of positions.reverse()) transaction.delete(pos, pos + 1)
    editor.view.dispatch(transaction); setActiveBookmark('')
  }
  function commitBookmark() {
    if (!editor || bookmarkName === null) return
    const name = bookmarkName.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) { setError('Use a letter first, then letters, numbers or underscores. Maximum 40 characters.'); return }
    if (bookmarks.some(b => b.name === name && b.name !== renaming)) { setError('A bookmark with this name already exists.'); return }
    const tr = editor.state.tr
    if (renaming) editor.state.doc.descendants((node, pos) => { if (node.type.name === 'bookmark' && node.attrs.name === renaming) tr.setNodeMarkup(pos, undefined, { ...node.attrs, name }) })
    else {
      const { from, to, $from, $to } = editor.state.selection
      if ($from.parent.attrs.locked || $to.parent.attrs.locked) { setError('Bookmarks cannot be added inside preserved field paragraphs.'); return }
      if ($from.parent !== $to.parent) { setError('Select text within one paragraph to create a bookmark.'); return }
      if (from === to) tr.insert(from, editor.schema.nodes.bookmark.create({ name, edge: 'point' }))
      else { tr.insert(to, editor.schema.nodes.bookmark.create({ name, edge: 'end' })); tr.insert(from, editor.schema.nodes.bookmark.create({ name, edge: 'start' })) }
    }
    editor.view.dispatch(tr); setBookmarkName(null); setRenaming(null); setActiveBookmark(name); setError('')
  }
  const disabled = !document || !!busy
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><BookOpen size={21} /></div><span>nebula<span className="brand-light"> / doc</span></span></div><div className="topbar-center"><span className="tiny-dot" /> A little space for old documents.</div><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} /> Help & shortcuts</button></header>
    <div className="document-bar"><div className="document-name"><div className="file-icon"><FileText size={22} /></div><div><div className="title-line"><h1>{document?.name ?? 'Your next chapter starts here'}</h1>{document && <span className="format-tag">.DOC</span>}</div><div className="document-subtitle">{document ? <><span className={`save-dot ${dirty ? 'unsaved' : ''}`} />{dirty ? 'Unsaved changes' : 'All changes saved'}<span className="dot-divider">·</span>Word 97–2003</> : 'A focused editor for classic Word documents'}</div></div></div><div className="file-actions"><button className="button secondary" onClick={openDocument} disabled={!!busy || !window.nebula}><FolderOpen size={16} />Open document</button><button className="button primary" onClick={() => saveDocument()} disabled={disabled}><ArrowDownToLine size={16} />Save .doc</button><button className="icon-button more-save" title="Save a copy (Ctrl+Shift+S)" aria-label="Save a copy" onClick={() => saveDocument(true)} disabled={disabled}><Copy size={17} /></button></div></div>
    <div className="toolbar"><div className="toolbar-group"><button title="Undo (Ctrl+Z)" aria-label="Undo" className="icon-button" onClick={() => editor?.chain().focus().undo().run()} disabled={disabled || !editor?.can().undo()}><Undo2 size={17} /></button><button title="Redo (Ctrl+Y)" aria-label="Redo" className="icon-button" onClick={() => editor?.chain().focus().redo().run()} disabled={disabled || !editor?.can().redo()}><Redo2 size={17} /></button></div><span className="toolbar-divider" /><div className="toolbar-group"><select aria-label="Font family" className="font-select" value={selection?.fontFamily ?? 'Arial'} disabled={disabled} onChange={e => editor?.chain().focus().setFontFamily(e.target.value).run()}>{[...new Set([selection?.fontFamily ?? 'Arial', ...fonts])].map(f => <option key={f}>{f}</option>)}</select><select aria-label="Font size" className="size-select" value={parseFloat(selection?.fontSize ?? '11')} disabled={disabled} onChange={e => editor?.chain().focus().setFontSize(`${e.target.value}pt`).run()}>{[...new Set([parseFloat(selection?.fontSize ?? '11'), ...sizes])].sort((a, b) => a - b).map(size => <option key={size}>{size}</option>)}</select></div><span className="toolbar-divider" /><div className="toolbar-group">{([{ key: 'bold', Icon: Bold, action: () => editor?.chain().focus().toggleBold().run() }, { key: 'italic', Icon: Italic, action: () => editor?.chain().focus().toggleItalic().run() }, { key: 'underline', Icon: Underline, action: () => editor?.chain().focus().toggleUnderline().run() }] as const).map(({ key, Icon, action }) => <button key={key} className={`icon-button ${selection?.[key] ? 'active' : ''}`} title={key} aria-label={key} aria-pressed={selection?.[key] ?? false} disabled={disabled} onClick={action}><Icon size={17} /></button>)}<label className={`color-control ${disabled ? 'disabled' : ''}`} title="Text color"><span>A</span><input aria-label="Text color" type="color" value={selection?.color ?? '#20242b'} disabled={disabled} onChange={e => editor?.chain().focus().setColor(e.target.value).run()} /></label></div><span className="toolbar-divider" /><button className="text-button" disabled={disabled} onClick={() => { setRenaming(null); setBookmarkName('') }}><BookmarkIcon size={16} />Add bookmark</button><div className="toolbar-end"><ShieldCheck size={15} /><span>Local & private</span></div></div>
    {error && <div role="alert" className="error-banner"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    <main className="workspace">
      {sidebar && <aside className="sidebar"><div className="sidebar-heading"><div><span className="eyebrow">DOCUMENT TOOLS</span><h2>Bookmarks <span>{bookmarks.length}</span></h2></div><button className="icon-button" title="Hide bookmarks" aria-label="Hide bookmarks" onClick={() => setSidebar(false)}><PanelLeftClose size={17} /></button></div><div className="search-field"><Search size={15} /><input aria-label="Search bookmarks" placeholder="Find a bookmark…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌕</kbd></div><div className="bookmark-list">{bookmarks.length ? bookmarks.filter(b => b.name.toLowerCase().includes(search.toLowerCase())).map(b => <div key={b.name} className={`bookmark-item ${activeBookmark === b.name ? 'selected' : ''}`}><button className="bookmark-go" onClick={() => goToBookmark(b.name)}><BookmarkIcon size={15} /><span>{b.name}</span><ChevronRight size={14} /></button><div className="bookmark-actions"><button title={`Rename ${b.name}`} aria-label={`Rename ${b.name}`} onClick={() => { setRenaming(b.name); setBookmarkName(b.name) }}><Pencil size={13} /></button><button title={`Delete ${b.name}`} aria-label={`Delete ${b.name}`} onClick={() => removeBookmark(b.name)}><Trash2 size={13} /></button></div></div>) : <div className="bookmarks-empty"><div className="empty-bookmark-icon"><BookmarkIcon size={23} strokeWidth={1.3} /></div><h3>{document ? 'Mark the important bits' : 'A place for your bookmarks'}</h3><p>{document ? 'Select text or place your cursor, then add a named bookmark.' : 'Open a document to see its bookmarks and jump to any section.'}</p>{document && <button className="text-button" onClick={() => setBookmarkName('')}><Plus size={14} />Add a bookmark</button>}</div>}</div><div className="sidebar-bottom"><div className="tip-icon"><Sparkles size={16} /></div><h3>Old format. Fresh perspective.</h3><p>Your documents stay on this computer. Just you and your words.</p><span className="legacy-chip"><span /> BUILT FOR .DOC</span></div></aside>}
      <section className={`editor-space ${document ? 'has-document' : ''}`}><div className="canvas-heading"><div>{!sidebar && <button className="icon-button" aria-label="Show bookmarks" onClick={() => setSidebar(true)}><BookmarkIcon size={16} /></button>}<span>{document ? 'DOCUMENT' : 'WELCOME TO NEBULA'}</span>{document && <><ChevronRight size={12} /><span>Continuous view</span></>}</div><button className="view-help" onClick={() => setHelp(true)}>Word 97–2003 <ChevronDown size={12} /></button></div>
        {document ? <div className="paper-scroll"><div className="paper" style={{ zoom: zoom / 100 }}><EditorContent editor={editor} /></div><p className="canvas-note">Editing view · original page settings are retained in the saved document</p></div> : <div className="welcome"><div className="welcome-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-note back-note"><span /><span /><span /></div><div className="art-note front-note"><div className="art-doc-label">W<span>97 — 03</span></div><div className="art-lines"><span /><span /><span /><span /></div><div className="art-bookmark"><BookmarkIcon size={28} fill="currentColor" strokeWidth={1} /></div><span className="art-extension">.doc</span></div><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">+</span></div><span className="eyebrow purple">GOOD DOCUMENTS DESERVE A SECOND CHAPTER</span><h2>Pick up where you left off.</h2><p>Bring your classic Word documents into a calmer workspace.<br />Edit text, refine fonts, and keep every bookmark in reach.</p><button className="button primary welcome-open" disabled={!!busy || !window.nebula || !status.available} onClick={openDocument}><FolderOpen size={18} />Open a .doc document<ArrowUpRight size={16} /></button><span className="welcome-formats">Word 97–2003 binary files only <span>·</span> .docx is not supported</span><div className="feature-row"><div><span><FileText size={18} /></span><h3>Familiar words</h3><p>Edit text and font styles</p></div><div><span><BookmarkIcon size={18} /></span><h3>Every detail in place</h3><p>Find and edit bookmarks</p></div><div><span><ShieldCheck size={18} /></span><h3>Entirely on your device</h3><p>No uploads. No account.</p></div></div></div>}
      </section>
      {document && <aside className="inspector"><span className="eyebrow">FILE DETAILS</span><div className="inspector-doc"><FileText size={28} /><span>DOC</span></div><h3>Classic, by design.</h3><p>A Word 97–2003 document, edited with a local LibreOffice engine.</p><dl><dt>Format</dt><dd>Binary .doc</dd><dt>Source pages</dt><dd>{document.pages}</dd><dt>Words</dt><dd>{words.toLocaleString()}</dd><dt>Bookmarks</dt><dd>{bookmarks.length}</dd></dl><div className="preservation-note"><ShieldCheck size={18} /><h4>Care for the original</h4><p>Tables, headers and page settings stay in the underlying document. A .bak copy is made before the first overwrite.</p></div>{document.bookmarkCount > document.bookmarks.length && <p className="minor-note">{document.bookmarkCount - document.bookmarks.length} bookmark(s) outside the editable body are preserved.</p>}<p className="minor-note">Fields and embedded object paragraphs are read only. Layout may vary between Word and LibreOffice.</p></aside>}
    </main>
    <footer className="statusbar"><div><span className={`engine-dot ${status.available ? 'ready' : ''}`} /><span title={status.message}>{busy || status.message}</span>{busy && <LoaderCircle className="spin" size={13} />}</div><div>{document && <><span>{words.toLocaleString()} words</span><span className="status-separator" /><button aria-label="Zoom out" disabled={zoom <= 60} onClick={() => setZoom(z => z - 10)}><Minus size={13} /></button><span>{zoom}%</span><button aria-label="Zoom in" disabled={zoom >= 150} onClick={() => setZoom(z => z + 10)}><Plus size={13} /></button><span className="status-separator" /></>}<span className="version">NEBULA DOC <span>v0.1</span></span></div></footer>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {busy && <div className="busy-overlay"><LoaderCircle className="spin" size={26} /><h3>{busy}…</h3><p>Your document is being processed on this computer.</p></div>}
    {bookmarkName !== null && <div className="modal-backdrop"><form className="modal" onSubmit={e => { e.preventDefault(); commitBookmark() }}><button type="button" className="modal-close icon-button" aria-label="Close bookmark dialog" onClick={() => { setBookmarkName(null); setRenaming(null) }}><X size={18} /></button><div className="modal-symbol"><BookmarkIcon size={24} /></div><h2>{renaming ? 'Rename bookmark' : 'Add a bookmark'}</h2><p>Give this place in your document a useful name.</p><label htmlFor="bookmark-name">Bookmark name</label><input id="bookmark-name" autoFocus value={bookmarkName} onChange={e => setBookmarkName(e.target.value)} placeholder="e.g. BorrowerName" maxLength={40} /><small>Start with a letter. Use letters, numbers and underscores.</small><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setBookmarkName(null)}>Cancel</button><button className="button primary" type="submit">{renaming ? 'Rename' : 'Add bookmark'}</button></div></form></div>}
    {help && <div className="modal-backdrop"><div className="modal help-modal"><button className="modal-close icon-button" aria-label="Close help" onClick={() => setHelp(false)}><X size={18} /></button><div className="modal-symbol"><BookOpen size={24} /></div><h2>A small guide to Nebula</h2><p>Open and save binary Word 97–2003 .doc files. The app rejects .docx and other formats.</p><div className="shortcut-list"><span>Open document</span><kbd>Ctrl O</kbd><span>Save document</span><kbd>Ctrl S</kbd><span>Save a copy</span><kbd>Ctrl Shift S</kbd><span>Bold / italic / underline</span><kbd>Ctrl B / I / U</kbd><span>Undo / redo</span><kbd>Ctrl Z / Y</kbd></div><p>Select text to change its font, size, color or style. Add bookmarks to selected text or the cursor position. Rename or remove them in the sidebar.</p><p className="help-detail">Enter inserts a line break within the current paragraph. Existing paragraphs and table structure are retained. Native fields, embedded objects, headers and footers are preserved; they are not editable here. The continuous editing view does not reproduce exact pagination. Check critical document layouts in Word after saving.</p><button className="button primary" onClick={() => setHelp(false)}>Got it</button></div></div>}
  </div>
}
