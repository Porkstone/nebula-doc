import {_electron as electron} from 'playwright'
import electronPath from 'electron'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

if (!process.argv[2]) throw new Error('Usage: node scripts/performance-smoke.mjs <sample.doc>')
const fixture = path.resolve(process.argv[2])
const executable = process.env.NEBULA_TEST_EXECUTABLE
await mkdir('test-output', {recursive: true})
const profile = await mkdtemp(path.resolve('test-output', 'performance-profile-'))
const rows = []
const env = {...process.env, NEBULA_ENGINE_DIAGNOSTICS: '1', PYTHONDONTWRITEBYTECODE: '1'}
delete env.ELECTRON_RUN_AS_NODE; delete env.NEBULA_DEV_URL
if (executable) delete env.NEBULA_LIBREOFFICE

for (const mode of ['first-launch-immediate', 'relaunch-immediate', 'engine-ready', 'engine-ready']) {
  const started = performance.now()
  const app = await electron.launch({executablePath: executable || electronPath, args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], env, timeout: 60000})
  try {
    const page = await app.firstWindow()
    await page.getByText('Pick up where you left off.').waitFor()
    const welcomeMs = performance.now() - started
    await app.evaluate(({dialog, ipcMain}, file) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [file]})
      dialog.showMessageBox = async () => ({response: 1})
      globalThis.__openingTimes = []
      const original = ipcMain._invokeHandlers.get('document:open')
      ipcMain.removeHandler('document:open')
      ipcMain.handle('document:open', async (...args) => {
        const start = performance.now()
        try { return await original(...args) } finally { globalThis.__openingTimes.push(performance.now() - start) }
      })
    }, fixture)
    if (mode === 'engine-ready') await page.getByTitle('Local document engine ready', {exact: true}).waitFor({timeout: 60000})
    const beforeOpenMs = performance.now() - started
    const opens = []
    for (let index = 0; index < 2; index++) {
      const result = await page.evaluate(() => new Promise((resolve, reject) => {
        let sawBusy = false, finished = false
        const start = performance.now()
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Document did not become editable.')) }, 90000)
        const observer = new MutationObserver(() => {
          if (document.querySelector('.busy-overlay')) sawBusy = true
          if (sawBusy && !finished && !document.querySelector('.busy-overlay') && document.querySelector('.paper .tiptap')) {
            finished = true; observer.disconnect(); clearTimeout(timeout)
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              ms: performance.now() - start,
              paragraphs: document.querySelectorAll('.tiptap p[data-block-id]').length,
              bookmarks: document.querySelectorAll('.bookmark-item').length,
            })))
          }
        })
        observer.observe(document.body, {childList: true, subtree: true, attributes: true})
        document.querySelector('.file-actions button').click()
      }))
      result.bridgeMs = await app.evaluate(() => globalThis.__openingTimes.at(-1))
      result.engine = await page.evaluate(() => window.nebula.status())
      assert.equal(result.paragraphs, 255); assert.equal(result.bookmarks, 33)
      // The first opening may include initialization. Every subsequent opening,
      // and the first when initialization has completed, has the user's budget.
      const budgetApplies = index > 0 || mode === 'engine-ready'
      result.budgetApplies = budgetApplies
      opens.push(result)
      if (budgetApplies) assert.ok(result.ms < 3000, `Document opening exceeded 3 seconds: ${result.ms.toFixed(0)} ms`)
    }
    const row = {mode, welcomeMs, beforeOpenMs, opens}
    rows.push(row); console.log(JSON.stringify(row))
    await writeFile('test-output/document-open-performance.json', JSON.stringify(rows, null, 2))
  } finally { await app.close() }
}
console.log('PASS: sample editable within 3 seconds after initialization; immediate first openings reported separately.')
