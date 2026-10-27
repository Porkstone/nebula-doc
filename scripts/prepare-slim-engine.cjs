const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { exclusionReason } = require('./slim-package-policy.cjs')

async function filesIn(root, directory = '') {
  const files = []
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in engine resources: ${relative}`)
    if (entry.isDirectory()) files.push(...await filesIn(root, relative))
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`Unsupported engine resource: ${relative}`)
  }
  return files.sort()
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function prepare(projectRoot = path.resolve(__dirname, '..')) {
  const cache = path.resolve(projectRoot, '.cache')
  const source = path.join(cache, 'libreoffice')
  const target = path.join(cache, 'libreoffice-slim')
  // The only recursive removal is this exact generated staging directory.
  if (path.dirname(target) !== cache || path.basename(target) !== 'libreoffice-slim' || target === source) throw new Error('Unsafe staging directory.')
  for (const required of ['program/soffice.exe', 'program/soffice.com', 'program/python.exe', 'program/mswordlo.dll', 'license.txt', 'LICENSE.html', 'NOTICE']) {
    await fs.access(path.join(source, required)).catch(() => { throw new Error(`Missing ${required}. Run pnpm setup:engine first.`) })
  }
  // Refuse to follow a substituted directory/junction before removing staging.
  const existing = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (existing?.isSymbolicLink()) throw new Error('Staging directory must not be a link or junction.')
  if ((await fs.realpath(cache)).toLowerCase() !== cache.toLowerCase()) throw new Error('Cache directory must not be redirected by a link or junction.')

  const files = await filesIn(source)
  const selected = files.map(file => ({ path: file, reason: exclusionReason(file) }))
  const unexpectedlyRemoved = selected.filter(file => file.reason && (/\.(?:exe|dll|ttf|otf|ttc)$/i.test(file.path) || file.path.startsWith('Fonts/')))
  if (unexpectedlyRemoved.length) throw new Error(`Resource policy tried to remove native code or fonts: ${unexpectedlyRemoved.map(f => f.path).join(', ')}`)
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  const retained = [], removed = [], categories = {}
  for (const file of selected) {
    const sourceFile = path.join(source, file.path)
    if (file.reason) {
      const bytes = (await fs.stat(sourceFile)).size
      removed.push({ path: file.path, bytes, reason: file.reason })
      const group = categories[file.reason] ??= { files: 0, bytes: 0 }
      group.files++; group.bytes += bytes
    } else {
      const bytes = await fs.readFile(sourceFile)
      const destination = path.join(target, file.path)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, bytes)
      retained.push({ path: file.path, bytes: bytes.length, sha256: sha256(bytes) })
    }
  }
  const sum = rows => rows.reduce((total, row) => total + row.bytes, 0)
  const summary = {
    schemaVersion: 1, experiment: 'resource-reduced LibreOffice 26.8.1.1',
    policySha256: sha256(await fs.readFile(path.join(__dirname, 'slim-package-policy.cjs'))),
    retained: { files: retained.length, bytes: sum(retained) },
    removed: { files: removed.length, bytes: sum(removed), categories },
    retainedResources: ['All native executable and DLL files', 'All bundled fonts', 'English UI resources and dictionary bundle', 'Core registry and all document filters', 'Colibre light/dark, raster/SVG icon themes', 'Original notices for retained components'],
    limits: ['Only English UI translations and dictionary bundle are included.', 'Native code and startup/profile behavior are unchanged.', 'The application continues to reject .docx.'],
  }
  await fs.writeFile(path.join(cache, 'slim-package-audit.json'), JSON.stringify({ summary, retained, removed }, null, 2))
  await fs.writeFile(path.join(cache, 'slim-package-summary.json'), JSON.stringify(summary, null, 2))
  console.log(`Slim engine: ${(sum(retained) / 1048576).toFixed(1)} MiB in ${retained.length} files; excluded ${(sum(removed) / 1048576).toFixed(1)} MiB in ${removed.length} files.`)
  return summary
}

module.exports = async context => prepare(context?.packager?.projectDir)
module.exports.prepare = prepare
module.exports.filesIn = filesIn
if (require.main === module) prepare().catch(error => { console.error(error); process.exitCode = 1 })
