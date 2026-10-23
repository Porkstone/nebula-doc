import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
await mkdir('test-output', { recursive: true })
const renamed = path.resolve('test-output', 'renamed-zip.doc')
await writeFile(renamed, Buffer.from('504b030400000000', 'hex'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NEBULA_DEV_URL
const executable = process.env.NEBULA_TEST_EXECUTABLE
const app = await electron.launch({ executablePath: executable || electronPath, args: executable ? [] : ['.'], env, timeout: 60000 })
try {
  const page = await app.firstWindow()
  await page.getByText('Pick up where you left off.').waitFor()
  const reject = async file => {
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, file)
    await page.getByRole('button', { name: 'Open document', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.ok(await page.getByRole('button', { name: 'Save .doc', exact: true }).isDisabled())
    return page.getByRole('alert').innerText()
  }
  assert.match(await reject(path.resolve('test-output', 'unsupported.docx')), /\.docx files cannot be opened/)
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  assert.match(await reject(renamed), /not a binary Word \.doc file/)
  assert.equal(await page.locator('.paper').count(), 0)
  console.log('PASS: packaged Electron rejects .docx and ZIP content renamed to .doc before opening the document engine.')
} finally { await app.close() }
