// "common" contains shared assets, including an OpenSymbol font.
const uiLocales = new Set(['common', 'en_GB', 'en_US'])
const registryLocales = new Set(['en-GB', 'en-US'])

// Only optional resources are excluded. Native libraries, fonts, text encoding
// data, core registry configuration, and document filters are deliberately kept.
function exclusionReason(relativePath) {
  const file = relativePath.replaceAll('\\', '/')
  if (/\.msi$/i.test(file)) return 'Administrative installer'
  if (/(^|\/)__pycache__\//.test(file) || /\.py[co]$/i.test(file)) return 'Generated Python bytecode'
  if (file.startsWith('help/')) return 'Offline help'
  if (file.startsWith('share/gallery/')) return 'Gallery assets'
  if (file.startsWith('share/template/')) return 'Document templates'
  if (file.startsWith('share/wizards/')) return 'Document wizards'
  const extension = /^share\/extensions\/([^/]+)\//.exec(file)
  if (extension && extension[1] !== 'dict-en') return 'Non-English dictionaries and optional extensions'
  const resource = /^program\/resource\/([^/]+)\//.exec(file)
  if (resource && !uiLocales.has(resource[1])) return 'Non-English user-interface translations'
  const registry = /^share\/registry\/res\/(?:fcfg_langpack|registry)_(.+)\.xcd$/.exec(file)
  if (registry && !registryLocales.has(registry[1])) return 'Non-English translated registry labels'
  if (/^share\/config\/images_.+\.zip$/.test(file) && !/^share\/config\/images_(?:colibre(?:_dark)?(?:_svg)?|helpimg)\.zip$/.test(file)) return 'Alternative icon themes'
  return null
}

module.exports = { exclusionReason }
