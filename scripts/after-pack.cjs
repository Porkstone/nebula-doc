const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const { filesIn } = require('./prepare-slim-engine.cjs')

module.exports = async ({ appOutDir }) => {
  const resources = path.join(appOutDir, 'resources')
  await fs.rm(path.join(resources, 'default_app.asar'), { force: true })
  const archive = path.join(resources, 'app.asar')
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  if (manifest.main !== 'electron/main.mjs') throw new Error('Packaged application entry point is invalid.')
  if (manifest.name !== 'nebula-doc-slim-experiment') throw new Error('Experiment must have a separate Electron application-data name.')
  if (manifest.license !== 'MIT') throw new Error('Packaged application must declare its MIT licence.')
  for (const [source, destination] of [['LICENSE', 'licenses/Nebula-Doc-MIT.txt'], ['THIRD_PARTY_NOTICES.txt', 'licenses/THIRD_PARTY_NOTICES.txt']]) {
    const expected = await fs.readFile(path.join(__dirname, '..', source))
    if (!(await fs.readFile(path.join(resources, destination))).equals(expected)) throw new Error(`Packaged licence notice does not match its source: ${source}`)
  }
  for (const notice of ['license.txt', 'LICENSE.html', 'NOTICE']) {
    const original = await fs.readFile(path.join(__dirname, '../.cache/libreoffice', notice))
    const packaged = await fs.readFile(path.join(resources, 'libreoffice', notice))
    if (!original.equals(packaged)) throw new Error(`Upstream LibreOffice notice was changed or omitted: ${notice}`)
  }
  const packagedMain = asar.extractFile(archive, manifest.main)
  const sourceMain = await fs.readFile(path.join(__dirname, '..', manifest.main))
  if (!packagedMain.equals(sourceMain)) throw new Error('Packaged main process does not match its source.')
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const sourceWorker = await fs.readFile(path.join(__dirname, '../engine/worker.py'))
  const packagedWorker = await fs.readFile(path.join(resources, 'engine/worker.py'))
  if (hash(sourceWorker) !== hash(packagedWorker)) throw new Error('Packaged document worker does not match its source.')
  if (asar.listPackage(archive).some(file => /[\\/](test-output|attachments)[\\/]/.test(file))) throw new Error('Test documents must not be packaged.')
  const audit = JSON.parse(await fs.readFile(path.join(__dirname, '../.cache/slim-package-audit.json'), 'utf8'))
  const engineRoot = path.join(resources, 'libreoffice')
  const packagedFiles = await filesIn(engineRoot)
  const expectedFiles = audit.retained.map(file => file.path).sort()
  if (JSON.stringify(packagedFiles) !== JSON.stringify(expectedFiles)) throw new Error('Packaged engine file list does not match the resource audit.')
  for (const file of audit.retained) {
    if (hash(await fs.readFile(path.join(engineRoot, file.path))) !== file.sha256) throw new Error(`Retained upstream resource was changed: ${file.path}`)
  }
  const summary = JSON.parse(await fs.readFile(path.join(resources, 'licenses/slim-package-summary.json'), 'utf8'))
  if (JSON.stringify(summary) !== JSON.stringify(audit.summary)) throw new Error('Packaged resource summary does not match its audit.')
  const locales = (await fs.readdir(path.join(appOutDir, 'locales'))).sort()
  if (JSON.stringify(locales) !== JSON.stringify(['en-GB.pak', 'en-US.pak'])) throw new Error(`Unexpected Electron locales: ${locales.join(', ')}`)
  console.log(`Verified packaged entry point, worker, notices, English locales and ${audit.retained.length} byte-identical upstream resources.`)
}
