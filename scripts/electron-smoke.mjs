import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const input = process.argv[2]
if (!input) throw new Error('Usage: pnpm test:electron <path-to-sample.doc>')
await mkdir('test-output', { recursive: true })
const fixture = path.resolve('test-output', 'MOT - eLoanAgreement (Regulated).doc')
const output = path.resolve('test-output', 'electron-edited.doc')
await copyFile(input, fixture)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NEBULA_DEV_URL
const packaged = process.env.NEBULA_TEST_EXECUTABLE
const app = await electron.launch({ executablePath: packaged || electronPath, args: packaged ? [] : ['.'], env, timeout: 60000 })
let page
try {
  page = await app.firstWindow()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.getByText('Pick up where you left off.').waitFor()
  await page.screenshot({ path: 'test-output/welcome.png' })
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.fixture] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, { fixture, output })
  await page.getByRole('button', { name: 'Open document', exact: true }).click()
  await page.locator('.paper').waitFor({ timeout: 120000 })
  await page.locator('.busy-overlay').waitFor({ state: 'hidden', timeout: 120000 })
  assert.equal(await page.locator('.tiptap p[data-block-id]').count(), 255)
  assert.equal(await page.locator('.bookmark-item').count(), 33)
  await page.screenshot({ path: 'test-output/editor.png' })
  const signature = page.locator('.tiptap p').filter({ hasText: 'Signature Code:' })
  assert.equal(await signature.count(), 1)
  assert.notEqual(await signature.getAttribute('contenteditable'), 'false', 'Signature label must be editable')
  await page.locator('.tiptap').focus()
  await signature.evaluate(element => {
    element.scrollIntoView({ block: 'center' })
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.type(' QA-1234')
  assert.ok((await signature.innerText()).includes('Signature Code: QA-1234'))
  await page.getByRole('button', { name: 'CustomerName', exact: true }).click()
  // TipTap's focus command restores DOM focus on the next animation frame.
  // Wait for that restoration before sending keystrokes, including under load.
  await page.waitForFunction(() => {
    const anchor = window.getSelection()?.anchorNode
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
    return document.activeElement === document.querySelector('.tiptap') && element?.closest('[data-block-id]')?.getAttribute('data-block-id') === 'p9'
  })
  await page.keyboard.type('Alex Morgan')
  assert.ok((await page.locator('[data-block-id=p9]').innerText()).includes('Alex Morgan'))
  await page.keyboard.down('Shift')
  for (let index = 0; index < 'Alex Morgan'.length; index++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('Shift')
  const settleFocus = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await settleFocus()
  await page.getByRole('combobox', { name: 'Font family' }).selectOption('Georgia')
  await settleFocus()
  assert.ok(await page.locator('[data-block-id=p9] span[style*="Georgia"]').count(), 'Font family should apply before saving')
  await page.getByRole('combobox', { name: 'Font size', exact: true }).selectOption('14')
  await settleFocus()
  assert.ok(await page.locator('[data-block-id=p9] span[style*="Georgia"]').count(), 'Font size must retain the selected family')
  await page.getByRole('button', { name: 'bold', exact: true }).click()
  await settleFocus()
  await page.locator('.tiptap').press('End')
  await page.waitForFunction(() => window.getSelection()?.isCollapsed)
  await page.locator('.tiptap').press('Enter')
  await page.keyboard.type('Second line')
  assert.ok((await page.locator('[data-block-id=p9]').innerText()).includes('Alex Morgan'))
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).click()
  await page.getByLabel('Bookmark name', { exact: true }).fill('NewCustomerBookmark')
  await page.locator('.modal').getByRole('button', { name: 'Add bookmark', exact: true }).click()
  assert.equal(await page.locator('.bookmark-item').count(), 34)
  await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
  await page.getByText('Saved as Word 97–2003 .doc', { exact: true }).waitFor({ timeout: 120000 })
  assert.equal(await page.locator('[role=alert]').count(), 0)
  assert.equal((await readFile(output)).subarray(0,8).toString('hex'), 'd0cf11e0a1b11ae1')
  // Reopen the saved file through the real main-process bridge.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, output)
  await page.getByRole('button', { name: 'Open document', exact: true }).click()
  await page.locator('.busy-overlay').waitFor({ state: 'hidden', timeout: 120000 })
  await page.getByRole('heading', { name: 'electron-edited.doc', exact: true }).waitFor({ timeout: 120000 })
  assert.ok((await page.locator('[data-block-id=p9]').innerText()).includes('Alex Morgan'))
  assert.ok(await page.locator('[data-block-id=p9] span[style*="Georgia"]').count())
  assert.ok(await page.locator('[data-block-id=p9] strong').count())
  assert.equal(await page.locator('.bookmark-item').count(), 34)
  assert.ok((await page.locator('.tiptap p').filter({ hasText: 'Signature Code:' }).innerText()).includes('Signature Code: QA-1234'))
  // Rename and delete are renderer transactions persisted through native .doc save.
  await page.getByRole('button', { name: 'NewCustomerBookmark', exact: true }).click()
  await page.getByRole('button', { name: 'Rename NewCustomerBookmark', exact: true }).click()
  await page.getByLabel('Bookmark name', { exact: true }).fill('RenamedCustomerBookmark')
  await page.locator('.modal').getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('button', { name: 'Delete RenamedCustomerBookmark', exact: true }).click()
  assert.equal(await page.locator('.bookmark-item').count(), 33)
  await page.getByRole('button', { name: 'Save .doc', exact: true }).click()
  await page.getByText('Saved as Word 97–2003 .doc', { exact: true }).waitFor({ timeout: 120000 })
  await page.screenshot({ path: 'test-output/editor-edited.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: Electron launch, sample open, signature-line editing, 255 paragraphs, 33 body bookmarks, native edit/save/reopen, bookmark add/rename/delete, no renderer errors.')
} catch (error) {
  if (page) { await page.screenshot({ path: 'test-output/electron-failure.png' }).catch(() => {}); await writeFile('test-output/electron-failure.txt', await page.locator('body').innerText().catch(() => '')) }
  throw error
} finally { await app.close() }
