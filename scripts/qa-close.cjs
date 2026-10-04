// Exercise the user's window-close path, including the owned backend process.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const version = require('../package.json').version;
  const executablePath = process.env.TR_INSTALLED_EXE ||
    path.resolve('release', version, 'win-unpacked/Open-LLM-VTuber-TR.exe');
  const application = await electron.launch({executablePath, timeout:120000});
  let exited = false;
  application.process().once('exit', () => { exited = true; });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => Boolean(window.electron), null, {timeout:120000});
    const health = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request', '/tr/health'));
    assert.equal(health.ready, true);
    const userData = await application.evaluate(({app}) => app.getPath('userData'));
    const {pid} = JSON.parse(await fs.readFile(path.join(userData, 'runtime-state.json'), 'utf8'));
    await page.evaluate(() => window.electron.ipcRenderer.send('window-close'));
    const deadline = Date.now() + 20000;
    while (!exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(exited, true, 'Closing the window must terminate Electron');
    let backendExited = false;
    try { process.kill(pid, 0); } catch { backendExited = true; }
    assert.equal(backendExited, true, 'Closing the window must terminate the owned backend');
    await fs.mkdir('.qa', {recursive:true});
    const report = {windowClose:'PASS', electronExited:exited, backendExited};
    await fs.writeFile('.qa/close-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (!exited) await application.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
