// CI smoke test uses the actual packaged runtime; no microphone or provider required.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const version = require('../package.json').version;
  const executablePath = process.env.TR_INSTALLED_EXE ||
    path.resolve('release', version, 'win-unpacked/Open-LLM-VTuber-TR.exe');
  const app = await electron.launch({ executablePath, timeout: 120000 });
  const pids = new Set();
  const report = { errors: [] };
  let stateFile;
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.electron), null, {timeout:120000});
    const status = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:status'));
    assert.equal(status.error, '');
    assert.equal(status.version, version);
    stateFile = path.join(await app.evaluate(({app}) => app.getPath('userData')), 'runtime-state.json');
    pids.add(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid);
    report.health = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request', '/tr/health'));
    assert.equal(report.health.ready, true);
    // CI has fresh user data. Preserve existing user settings in local installed tests.
    if (!status.settings.completed) {
      const saved = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:save', {completed:true}));
      assert.ok(saved.endpoint.startsWith('http://127.0.0.1:'));
      pids.add(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid);
      await page.reload();
    }
    await page.waitForFunction(() => document.body.innerText.includes('Bağlı'), null, {timeout:60000});
    await page.waitForFunction(() => window.getLAppAdapter?.().getModel()?._state === 22, null, {timeout:60000});
    report.connected = true;
    report.live2dTexturesReady = true;
    assert.deepEqual(report.errors, []);
  } finally {
    if (stateFile) pids.add(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid);
    await app.close();
    report.backendExited = [...pids].every(pid => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    });
    await fs.mkdir('.qa', {recursive:true});
    await fs.writeFile('.qa/packaged-report.json', JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    assert.equal(report.backendExited, true);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
