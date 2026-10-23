import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
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
  constructor(program, worker) { this.program = program; this.worker = worker; this.pending = new Map(); this.nextId = 0 }
  async start() {
    if (this.child) return
    this.profile = await mkdtemp(path.join(tmpdir(), 'nebula-doc-'))
    const pipe = `nebula_${randomUUID().replaceAll('-', '')}`
    this.office = spawn(path.join(this.program, 'soffice.com'), [
      `-env:UserInstallation=${pathToFileURL(this.profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore',
      `--accept=pipe,name=${pipe};urp;StarOffice.ServiceManager`,
    ], { windowsHide: true, stdio: 'ignore' })
    this.office.on('error', error => this.fail(error))
    this.child = spawn(path.join(this.program, 'python.exe'), ['-u', this.worker, pipe], {
      windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let diagnostics = ''
    this.child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000) })
    this.child.on('error', error => this.fail(error))
    this.child.on('exit', () => { this.child = null; this.fail(new Error(`Document engine stopped. ${diagnostics}`)) })
    createInterface({ input: this.child.stdout }).on('line', line => {
      try { const message = JSON.parse(line); const item = this.pending.get(message.id); if (!item) return
        this.pending.delete(message.id); clearTimeout(item.timer)
        if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result)
      } catch { /* LibreOffice may emit diagnostic text before the JSON protocol. */ }
    })
    await this.request('ping')
  }
  fail(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error) }; this.pending.clear() }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The document engine timed out. Close and reopen the application before retrying.')) }, 120000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error) } })
    })
  }
  async close() {
    if (this.child) { await this.request('close').catch(() => {}); this.child?.kill() }
    this.office?.kill()
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {})
  }
}
