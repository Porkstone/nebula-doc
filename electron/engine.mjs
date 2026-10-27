import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

export function locateEngine(root, resourcesPath) {
  const candidates = [process.env.NEBULA_LIBREOFFICE, resourcesPath && path.join(resourcesPath, 'libreoffice'), path.join(root, '.cache', 'libreoffice'),
    path.join(root, '.cache', 'libreoffice', 'LibreOffice'), path.join(root, '.cache', 'libreoffice', 'Program Files', 'LibreOffice'),
    'C:\\Program Files\\LibreOffice', 'C:\\Program Files (x86)\\LibreOffice'].filter(Boolean)
  for (const base of candidates) {
    const program = path.basename(base).toLowerCase() === 'program' ? base : path.join(base, 'program')
    if (existsSync(path.join(program, 'soffice.exe')) && existsSync(path.join(program, 'python.exe'))) return program
  }
  return null
}

export class DocumentEngine {
  constructor(program, worker, { profileDirectory } = {}) {
    this.program = program; this.worker = worker; this.profileDirectory = profileDirectory
    this.pending = new Map(); this.nextId = 0
  }
  start() {
    if (this.closing) return Promise.reject(new Error('The document engine is closing.'))
    return this.starting ??= this.launch()
  }
  async launch() {
    this.profile = this.profileDirectory ?? await mkdtemp(path.join(tmpdir(), 'nebula-doc-'))
    this.temporaryProfile = !this.profileDirectory
    await mkdir(this.profile, { recursive: true })
    if (this.closing) {
      if (this.temporaryProfile) await rm(this.profile, { recursive: true, force: true }).catch(() => {})
      throw new Error('The document engine was closed during startup.')
    }
    const pipe = `nebula_${randomUUID().replaceAll('-', '')}`
    this.office = spawn(path.join(this.program, 'soffice.com'), [
      `-env:UserInstallation=${pathToFileURL(this.profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore',
      `--accept=pipe,name=${pipe};urp;StarOffice.ServiceManager`,
    ], { windowsHide: true, stdio: 'ignore' })
    this.office.on('error', error => this.fail(error))
    this.child = spawn(path.join(this.program, 'python.exe'), ['-u', this.worker, pipe], {
      windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let diagnostics = ''
    this.child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000) })
    this.child.on('error', error => this.fail(error))
    this.child.on('exit', () => { this.child = null; this.fail(new Error(`Document engine stopped. ${diagnostics}`)) })
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { const message = JSON.parse(line); const item = this.pending.get(message.id); if (!item) return
        if (message.timings) this.lastTimings = message.timings
        this.pending.delete(message.id); clearTimeout(item.timer)
        if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result)
      } catch { /* LibreOffice may emit diagnostic text before the JSON protocol. */ }
    })
    await this.request('ping')
  }
  fail(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error) }; this.pending.clear() }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin.writable) { reject(new Error('The document engine is not running.')); return }
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The document engine timed out. Close and reopen the application before retrying.')) }, 120000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error) } })
    })
  }
  close() { return this.closingPromise ??= this.shutdown() }
  async shutdown() {
    this.closing = true
    let deadline
    if (this.child) await Promise.race([
      this.request('close').catch(() => {}),
      new Promise(resolve => { deadline = setTimeout(resolve, 3000) }),
    ]).finally(() => clearTimeout(deadline))
    // Both Windows launchers have child processes. Stop only our owned trees,
    // including when the user closes the app during asynchronous warm-up.
    await Promise.all([this.child, this.office].filter(child => child && child.exitCode === null).map(child => new Promise(resolve => {
      if (process.platform !== 'win32') { child.kill(); resolve(); return }
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', resolve); killer.on('exit', resolve)
    })))
    this.fail(new Error('The document engine was closed.'))
    if (this.temporaryProfile && this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {})
  }
}
