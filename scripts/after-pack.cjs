const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')

module.exports = async ({ appOutDir }) => {
  const resources = path.join(appOutDir, 'resources')
  await fs.rm(path.join(resources, 'default_app.asar'), { force: true })
  const archive = path.join(resources, 'app.asar')
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  if (manifest.main !== 'electron/main.mjs') throw new Error('Packaged application entry point is invalid.')
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
  // The headless engine needs no dictionaries, UI translations, translated registry labels,
  // alternative icon themes or PDF import. Keep the shared resources, en-US labels and one theme.
  const office = path.join(resources, 'libreoffice')
  const exists = file => fs.access(path.join(office, file)).then(() => true, () => false)
  for (const trimmed of ['share/extensions', 'share/xpdfimport', 'program/xpdfimport.exe', 'program/resource/de', 'share/registry/res/registry_de.xcd', 'share/config/images_breeze.zip']) {
    if (await exists(trimmed)) throw new Error(`Unused LibreOffice resource was packaged: ${trimmed}`)
  }
  for (const kept of ['program/soffice.exe', 'program/python.exe', 'program/mswordlo.dll', 'program/resource/common', 'share/registry/main.xcd', 'share/registry/res/fcfg_langpack_en-US.xcd', 'share/config/images_colibre.zip', 'Fonts']) {
    if (!(await exists(kept))) throw new Error(`Required LibreOffice resource is missing: ${kept}`)
  }
  const packagedMain = asar.extractFile(archive, manifest.main)
  const sourceMain = await fs.readFile(path.join(__dirname, '..', manifest.main))
  if (!packagedMain.equals(sourceMain)) throw new Error('Packaged main process does not match its source.')
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const sourceWorker = await fs.readFile(path.join(__dirname, '../engine/worker.py'))
  const packagedWorker = await fs.readFile(path.join(resources, 'engine/worker.py'))
  if (hash(sourceWorker) !== hash(packagedWorker)) throw new Error('Packaged document worker does not match its source.')
  if (asar.listPackage(archive).some(file => /[\\/](test-output|attachments)[\\/]/.test(file))) throw new Error('Test documents must not be packaged.')
  console.log('Verified packaged entry point, worker, MIT licence, third-party notices, trimmed LibreOffice resources and exclusion of test documents.')
}
