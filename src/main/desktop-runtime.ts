/* eslint-disable no-await-in-loop -- Readiness checks must run sequentially against a deadline. */
import { app, ipcMain, safeStorage, shell, session } from 'electron';
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, appendFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cpus, totalmem, arch, release } from 'node:os';

type Settings = { baseUrl?: string; model?: string; voice?: string; apiKey?: string; completed?: boolean };
const version = '1.2.1-tr.1';
const repo = 'https://github.com/petrofi/Open-LLM-VTuber-TR';
export class DesktopRuntime {
  private child?: ChildProcessWithoutNullStreams;

  private token = '';

  private endpoint = '';

  private pending?: Promise<void>;

  private settings: Settings = {};

  private error = '';

  private verifiedInstaller = '';

  private downloading = false;

  private data = join(app.getPath('userData'), 'backend');

  async load(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true });
    try {
      const stored = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'));
      this.settings = stored;
      if (stored.encryptedKey) {
        this.settings.apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64'));
      }
      delete (this.settings as any).encryptedKey;
    } catch (err: any) {
      if (err.code !== 'ENOENT') this.error = 'Kaydedilmiş ayarlar okunamadı. Yeniden yapılandırabilirsiniz.';
    }
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (this.endpoint && (details.url.startsWith(`${this.endpoint}/`) ||
          details.url.startsWith(`${this.endpoint.replace('http:', 'ws:')}/`))) {
        details.requestHeaders['x-tr-token'] = this.token;
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    this.register();
    this.pending = this.start().catch((err) => { this.error = err.message; });
  }

  private async start(): Promise<void> {
    this.error = '';
    this.token = randomBytes(32).toString('hex');
    const backend = app.isPackaged ? join(process.resourcesPath, 'backend')
      : join(app.getAppPath(), '../Open-LLM-VTuber-TR');
    const python = app.isPackaged ? join(process.resourcesPath, 'python/python.exe')
      : join(backend, '.venv/Scripts/python.exe');
    const child = spawn(python, [join(backend, 'scripts/desktop_server.py'), '--data-dir', this.data], {
      cwd: backend,
      windowsHide: true,
      stdio: 'pipe',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1' },
    });
    this.child = child;
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').replaceAll(this.settings.apiKey || 'NO_SECRET_CONFIGURED', '[REDACTED]');
      appendFile(join(app.getPath('userData'), 'startup.log'), message).catch(() => {});
    });
    child.stdin.write(`${JSON.stringify({ token: this.token, settings: this.settings })}\n`);
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend başlatılamadı: başlangıç zaman aşımı.')), 120000);
      const lines = createInterface({ input: child.stdout });
      child.once('error', () => { clearTimeout(timer); reject(new Error('Özel Python runtime başlatılamadı. Kurulumu yeniden çalıştırın.')); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Backend başlatılamadı (kod ${code}). Logları açarak ayrıntıları inceleyin.`)); });
      lines.on('line', (line) => {
        try {
          const state = JSON.parse(line);
          if (Number.isInteger(state.port) && state.port > 0 && state.port < 65536) {
            clearTimeout(timer); resolve(state.port); lines.close();
          }
        } catch { /* Ignore non-protocol output from third-party libraries. */ }
      });
    });
    this.endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Backend beklenmedik biçimde kapandı. Logları açın.');
      try {
        const response = await fetch(`${this.endpoint}/tr/health`, {
          headers: { 'x-tr-token': this.token }, signal: AbortSignal.timeout(1500),
        });
        if (response.ok && ((await response.json()) as { ready?: boolean }).ready) {
          await writeFile(
            join(app.getPath('userData'), 'runtime-state.json'),
            JSON.stringify({ version, pid: child.pid, endpoint: this.endpoint }),
            'utf8',
          );
          return;
        }
      } catch { /* Retry only until the readiness deadline. */ }
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    }
    await this.stop();
    throw new Error('Backend hazır duruma gelemedi. Logları açın.');
  }

  async stop(): Promise<void> {
    const { child } = this;
    if (!child || child.exitCode !== null) return;
    this.child = undefined;
    child.stdin.end(); // Python observes EOF and closes its owned services.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 8000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  private register(): void {
    ipcMain.handle('tr:status', async () => {
      await this.pending;
      const { apiKey, ...publicSettings } = this.settings;
      return { endpoint: this.endpoint, error: this.error, settings: publicSettings, hasKey: Boolean(apiKey), version };
    });
    ipcMain.handle('tr:request', async (_event, path: string, method: string = 'GET') => {
      const allowed: Record<string, string> = {
        '/tr/health': 'GET',
        '/tr/providers': 'GET',
        '/tr/asr/status': 'GET',
        '/tr/asr/download': 'POST',
        '/tr/tts/test': 'POST',
        '/tr/llm/test': 'POST',
      };
      if (allowed[path] !== method) throw new Error('Geçersiz istek.');
      await this.pending;
      const response = await fetch(this.endpoint + path, {
        method, headers: { 'x-tr-token': this.token }, signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(((await response.json()) as { detail?: string }).detail || 'İşlem tamamlanamadı.');
      if (path === '/tr/tts/test') return { audio: Buffer.from(await response.arrayBuffer()).toString('base64') };
      return response.json();
    });
    ipcMain.handle('tr:save', async (_event, input: Settings) => {
      if (typeof input !== 'object' || !input) throw new Error('Ayarlar geçersiz.');
      const url = new URL(input.baseUrl || 'http://127.0.0.1:11434/v1');
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash ||
          (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
        throw new Error('API için HTTPS veya yerel bir HTTP adresi kullanın.');
      }
      if (!['tr-TR-EmelNeural', 'tr-TR-AhmetNeural'].includes(input.voice || 'tr-TR-EmelNeural')) {
        throw new Error('Türkçe ses seçimi geçersiz.');
      }
      const updated: Settings = {
        baseUrl: url.href.replace(/\/$/, ''),
        model: String(input.model || '').slice(0, 256),
        voice: input.voice || 'tr-TR-EmelNeural',
        completed: input.completed === true,
        apiKey: input.apiKey === undefined ? this.settings.apiKey : input.apiKey,
      };
      const { apiKey, ...publicSettings } = updated;
      if (apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('Windows güvenli anahtar depolaması kullanılamıyor.');
      const persisted = { ...publicSettings, encryptedKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : '' };
      const file = join(app.getPath('userData'), 'settings.json');
      await writeFile(`${file}.tmp`, JSON.stringify(persisted), 'utf8');
      await rename(`${file}.tmp`, file);
      this.settings = updated;
      await this.stop();
      this.pending = this.start().catch((err) => { this.error = err.message; });
      await this.pending;
      if (this.error) throw new Error(this.error);
      return { endpoint: this.endpoint };
    });
    ipcMain.handle('tr:logs', () => shell.openPath(join(this.data, 'logs')));
    ipcMain.handle('tr:hardware', async () => ({
      os: `Windows ${release()}`,
      architecture: arch(),
      cpu: cpus()[0]?.model,
      ramGB: Math.round(totalmem() / 1024 ** 3),
      extra: await new Promise((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command',
            "$ErrorActionPreference='Stop'; [pscustomobject]@{GPU=@(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name); FreeGB=[math]::Round((Get-PSDrive -Name C).Free/1GB)} | ConvertTo-Json -Compress"],
          { windowsHide: true, timeout: 10000 },
          (err, stdout) => {
            if (err) { resolve({ unavailable: true }); return; }
            try { resolve(JSON.parse(stdout)); } catch { resolve({ unavailable: true }); }
          },
        );
      }),
    }));
    ipcMain.handle('tr:updates', async () => {
      const response = await fetch('https://api.github.com/repos/petrofi/Open-LLM-VTuber-TR/releases', {
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Sürüm bilgisi alınamadı.');
      const releases = await response.json() as Array<{draft: boolean; prerelease: boolean; tag_name: string; html_url: string}>;
      const latest = releases.filter((item) => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+-tr\.\d+$/.test(item.tag_name))
        .sort((a, b) => b.tag_name.localeCompare(a.tag_name, 'en', { numeric: true }))
        .find((item) => item.tag_name.localeCompare(`v${version}`, 'en', { numeric: true }) > 0);
      return { current: version, latest: latest?.tag_name || null, url: latest?.html_url || `${repo}/releases` };
    });
    ipcMain.handle('tr:download-update', async (_event, tag: string) => {
      if (this.downloading) throw new Error('İndirme zaten sürüyor.');
      if (!/^v\d+\.\d+\.\d+-tr\.\d+$/.test(tag) ||
          tag.localeCompare(`v${version}`, 'en', { numeric: true }) <= 0) throw new Error('Sürüm geçersiz.');
      this.downloading = true;
      this.verifiedInstaller = '';
      const name = `Open-LLM-VTuber-TR-${tag}-Setup.exe`;
      const directory = join(app.getPath('userData'), 'updates');
      const file = join(directory, name);
      const temporary = `${file}.partial`;
      try {
        const base = `${repo}/releases/download/${tag}`;
        const checksum = await fetch(`${base}/SHA256SUMS.txt`, { signal: AbortSignal.timeout(15000) });
        if (!checksum.ok) throw new Error('Sürüm sağlama toplamı alınamadı.');
        const lines = (await checksum.text()).split(/\r?\n/);
        const expected = lines.map((line) => line.trim().split(/\s+/))
          .find((parts) => parts[1] === name)?.[0];
        if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('SHA-256 kaydı geçersiz.');
        const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(1200000) });
        if (!response.ok || !response.body) throw new Error('Installer indirilemedi.');
        await mkdir(directory, { recursive: true });
        const output = await open(temporary, 'w');
        const hash = createHash('sha256');
        const reader = response.body.getReader();
        try {
          let chunk = await reader.read();
          while (!chunk.done) {
            hash.update(chunk.value);
            await output.writeFile(chunk.value);
            chunk = await reader.read();
          }
        } finally { reader.releaseLock(); await output.close(); }
        const digest = hash.digest('hex');
        if (digest !== expected.toLowerCase()) throw new Error('SHA-256 eşleşmedi. Dosya çalıştırılmayacak.');
        await rename(temporary, file);
        this.verifiedInstaller = file;
        return { name, sha256: digest };
      } finally {
        this.downloading = false;
        await rm(temporary, { force: true });
      }
    });
    ipcMain.handle('tr:install-update', async () => {
      if (!this.verifiedInstaller) throw new Error('Önce sürümü indirip doğrulayın.');
      const error = await shell.openPath(this.verifiedInstaller);
      if (error) throw new Error('Kurulum başlatılamadı.');
      app.quit();
    });
    ipcMain.handle('tr:open', (_event, target: string) => {
      const links: Record<string, string> = { releases: `${repo}/releases`, ollama: 'https://ollama.com/download/windows', docs: `${repo}/tree/main/docs/TR` };
      if (links[target]) return shell.openExternal(links[target]);
      throw new Error('Bağlantı izinli değil.');
    });
  }
}
