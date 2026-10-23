import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from 'node:fs/promises'
import { DocumentEngine, locateEngine } from './engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let win, engine, currentPath, dirty = false, busy = false, quitting = false
const trusted = event => { if (event.sender !== win?.webContents || event.senderFrame !== win?.webContents.mainFrame) throw new Error('Untrusted request') }
async function checkDoc(file) {
  if (path.extname(file).toLowerCase() !== '.doc') throw new Error('Only Word 97–2003 .doc files are supported. .docx files cannot be opened.')
  const handle = await open(file, 'r')
  try { const bytes = Buffer.alloc(8); await handle.read(bytes, 0, 8, 0)
    if (bytes.toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('This is not a binary Word .doc file. Renamed .docx, RTF and HTML files are not supported.')
  } finally { await handle.close() }
}
async function getEngine() {
  if (!engine) {
    const program = locateEngine(root, process.resourcesPath)
    if (!program) throw new Error('LibreOffice is required. Run pnpm setup:engine, then restart the app.')
    engine = new DocumentEngine(program, path.join(app.isPackaged ? process.resourcesPath : root, 'engine', 'worker.py'))
    try { await engine.start() } catch (error) { await engine.close(); engine = null; throw error }
  }
  return engine
}
async function discard() {
  if (!dirty) return true
  const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0, message: 'Discard unsaved changes?', detail: 'Save your document before continuing if you want to keep your edits.' })
  return response === 1
}
async function exclusive(fn) { if (busy) throw new Error('Another document operation is in progress.'); busy = true; try { return await fn() } finally { busy = false } }
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1500, height: 980, minWidth: 1050, minHeight: 700, backgroundColor: '#f4f3ef', title: 'Nebula · Legacy Word editor',
    webPreferences: { preload: path.join(root, 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const action = value => win.webContents.send('menu:action', value)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Open .doc…', accelerator: 'CmdOrCtrl+O', click: () => action('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => action('save') }, { label: 'Save a copy…', accelerator: 'CmdOrCtrl+Shift+S', click: () => action('saveAs') }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  ]))
  win.on('close', event => {
    if (quitting) return
    event.preventDefault()
    if (busy) return
    discard().then(async approved => { if (approved) { quitting = true; await engine?.close(); win.destroy(); app.quit() } })
  })
  ipcMain.handle('engine:status', event => { trusted(event); const available = !!locateEngine(root, process.resourcesPath); return { available, message: available ? 'Local document engine ready' : 'LibreOffice is required. Run pnpm setup:engine and restart.' } })
  ipcMain.handle('document:open', (event) => { trusted(event); return exclusive(async () => {
    if (!await discard()) return null
    const result = await dialog.showOpenDialog(win, { title: 'Open a legacy Word document', properties: ['openFile'], filters: [{ name: 'Word 97–2003 document', extensions: ['doc'] }] })
    if (result.canceled) return null
    const file = result.filePaths[0]; await checkDoc(file)
    const document = await (await getEngine()).request('open', { path: file })
    currentPath = file; dirty = false; return document
  }) })
  ipcMain.handle('document:save', (event, payload, saveAs) => { trusted(event); return exclusive(async () => {
    if (!currentPath) throw new Error('Open a document first.')
    let target = currentPath
    if (saveAs) { const result = await dialog.showSaveDialog(win, { defaultPath: currentPath.replace(/\.doc$/i, ' - edited.doc'), filters: [{ name: 'Word 97–2003 document', extensions: ['doc'] }] }); if (result.canceled) return null; target = result.filePath }
    if (path.extname(target).toLowerCase() !== '.doc') throw new Error('Documents must be saved with the .doc extension.')
    await (await getEngine()).request('save', { ...payload, path: target })
    currentPath = target; dirty = false; return { path: target, name: path.basename(target) }
  }) })
  ipcMain.on('document:dirty', (event, value) => { trusted(event); dirty = value === true; win.setDocumentEdited(dirty) })
  if (process.env.NEBULA_DEV_URL) win.loadURL(process.env.NEBULA_DEV_URL)
  else win.loadFile(path.join(root, 'dist', 'index.html'))
})
app.on('window-all-closed', () => app.quit())
