// Integration test of the real production renderer and its owned Python process.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = path.resolve('.qa');
  await fs.mkdir(output, { recursive: true });
  if (!process.env.TR_INSTALLED_EXE) {
    const settingsFile = path.join(output, 'user-data/settings.json');
    try { const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); settings.completed = false; await fs.writeFile(settingsFile, JSON.stringify(settings)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const executablePath = process.env.TR_INSTALLED_EXE || require('electron');
  const application = await electron.launch({ executablePath,
    args: process.env.TR_INSTALLED_EXE ? [] : ['.'],
    env: { ...process.env, TR_QA_DATA: path.join(output, 'user-data') }, timeout: 120000 });
  const pids = new Set();
  let stateFile;
  const report = { errors: [], failedRequests: [] };
  try {
    const page = await application.firstWindow();
    page.on('pageerror', (error) => report.errors.push(error.stack));
    page.on('requestfailed', (request) => report.failedRequests.push({ url: request.url().replace(/127\.0\.0\.1:\d+/g, 'LOCAL'), error: request.failure()?.errorText }));
    await page.waitForFunction(() => Boolean(window.electron), null, {timeout:120000});
    const initial = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:status'));
    if (initial.settings.completed) await page.evaluate(() => window.dispatchEvent(new Event('tr-settings-open')));
    await page.getByRole('button', { name: 'Başlayalım', exact: true }).waitFor({ timeout: 150000 });
    await page.getByRole('button', { name: 'Başlayalım', exact: true }).isEnabled();
    report.runtime = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request', '/tr/health'));
    const userData = await application.evaluate(({ app }) => app.getPath('userData'));
    stateFile = path.join(userData, 'runtime-state.json');
    const capture = async (name) => { const png = await application.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); await fs.writeFile(path.join(output,name),Buffer.from(png,'base64')); };
    pids.add(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid);
    for (const [width, height, zoom] of [[1366,768,1],[1366,768,1.25],[1920,1080,1],[1920,1080,1.25]]) {
      await application.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(size[0], size[1]); win.webContents.setZoomFactor(size[2]); }, [width,height,zoom]);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await capture(`welcome-${width}-${zoom}.png`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1366,768); win.webContents.setZoomFactor(1); });
    await page.getByRole('button', { name: 'Başlayalım', exact: true }).click();
    report.hardware = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:hardware'));
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    await page.getByRole('button', { name: 'Mikrofonu Dene', exact: true }).click();
    await page.getByRole('status').waitFor({ timeout: 15000 });
    report.microphone = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const input = stream.getAudioTracks()[0];
      const result = { label: input.label, state: input.readyState,
        devices: (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind !== 'videoinput').map(d => ({kind:d.kind,label:d.label,default:d.deviceId === 'default'})) };
      stream.getTracks().forEach(track => track.stop()); return result;
    });
    await capture('microphone.png');
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    await page.getByRole('button', { name: 'Test Sesi Çal', exact: true }).click();
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    report.asr = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request', '/tr/asr/status'));
    if (process.env.TR_ASR_TEST === '1') {
      if (!report.asr.ready) {
        await page.getByRole('button', {name:'Türkçe Konuşma Modelini İndir',exact:true}).click();
        const deadline=Date.now()+1200000;
        do {
          report.asr=await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request','/tr/asr/status'));
          if(report.asr.state==='error') throw new Error(report.asr.message);
          if(report.asr.ready) break;
          await new Promise(resolve=>setTimeout(resolve,2000));
        } while(Date.now()<deadline);
        assert.equal(report.asr.ready,true,'ASR download and initialization must finish before transcription');
      }
      const fixture = await fs.readFile(path.resolve(process.env.TR_QA_ASR_WAV || '../Open-LLM-VTuber-TR/.build/qa-data/turkce-asr.wav'));
      report.asrTranscript = await page.evaluate(async (base64) => {
        const status=await window.electron.ipcRenderer.invoke('tr:status');
        const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        const form=new FormData();form.append('file',new Blob([bytes],{type:'audio/wav'}),'turkce-test.wav');
        const response=await fetch(status.endpoint+'/asr',{method:'POST',body:form});
        if(!response.ok) throw new Error('Installed ASR failed: '+response.status+' '+await response.text());
        return response.json();
      },fixture.toString('base64'));
      assert.match(report.asrTranscript.text.toLocaleLowerCase('tr-TR'),/türkçe konuşma tanıma/);
    }
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    report.providers = await page.evaluate(() => window.electron.ipcRenderer.invoke('tr:request', '/tr/providers'));
    await capture('llm.png');
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    report.ttsPlayback = await page.evaluate(async () => {
      const result = await window.electron.ipcRenderer.invoke('tr:request', '/tr/tts/test', 'POST');
      const audio = new Audio(`data:audio/mpeg;base64,${result.audio}`);
      await audio.play();
      await new Promise((resolve,reject) => { audio.onended = resolve; audio.onerror = reject; });
      return { duration: audio.duration, ended: audio.ended };
    });
    await page.getByRole('button', { name: 'Devam', exact: true }).click();
    await page.getByRole('button', { name: 'Karakterimle Konuş', exact: true }).click();
    await page.locator('.tr-gate').waitFor({state:'hidden', timeout:150000});
    await page.locator('canvas').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('Bağlı'), null, { timeout: 30000 });
    report.connected = true;
    await page.waitForFunction(() => window.getLAppAdapter?.().getModel()?._state === 22, null, {timeout:60000});
    report.modelLoaded = true;
    report.live2d = await page.evaluate(async () => {
      const adapter = window.getLAppAdapter(); const model = adapter.getModel();
      const start = model._userTimeSeconds;
      await new Promise(resolve => { const tick=()=> model._userTimeSeconds > start + .2 ? resolve() : requestAnimationFrame(tick); tick(); });
      const expression = adapter.getExpressionName(0); adapter.setExpression(expression);
      return {state:model._state,textures:model._textureCount,idleAdvanced:model._userTimeSeconds>start,expression,expressions:adapter.getExpressionCount()};
    });
    const wav = await fs.readFile(path.resolve(process.env.TR_QA_WAV || '../Open-LLM-VTuber-TR/.build/qa-data/turkce-ses.wav'));
    report.lipSync = await page.evaluate(async (base64) => {
      const model = window.getLAppAdapter().getModel();
      const url = 'data:audio/wav;base64,'+base64;
      model._wavFileHandler.start(url);
      const audio = new Audio(url); let maxRms = 0;
      await audio.play();
      await new Promise((resolve,reject) => {
        const tick=()=> { maxRms=Math.max(maxRms,model._wavFileHandler._lastRms); if(!audio.ended) requestAnimationFrame(tick); };
        audio.onended=resolve;audio.onerror=reject;tick();
      });
      return {ended:audio.ended,maxRms};
    },wav.toString('base64'));
    assert.ok(report.lipSync.maxRms > 0);
    await page.getByRole('button', {name:'Mikrofonu Aç / Kapat',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('button[aria-label="Mikrofonu Aç / Kapat"]')?.getAttribute('aria-pressed') === 'true', null, {timeout:60000});
    report.vadStarted = true;
    await page.getByRole('button', {name:'Mikrofonu Aç / Kapat',exact:true}).click();
    assert.deepEqual(report.failedRequests, []);
    await capture('character.png');
    assert.deepEqual(report.errors, []);
  } finally {
    if (stateFile) pids.add(JSON.parse(await fs.readFile(stateFile, 'utf8')).pid);
    await application.close();
    report.backendExited = [...pids].every(pid => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    });
    assert.equal(report.backendExited, true);
    await fs.writeFile(path.join(output, 'electron-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
