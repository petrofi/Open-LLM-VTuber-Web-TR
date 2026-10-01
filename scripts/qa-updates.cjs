// Test the real Electron update handlers without downloading or running an installer.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const app = await electron.launch({args:['.'], env:{...process.env,TR_QA_DATA:path.resolve('.qa/update-data')}, timeout:120000});
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.electron));
    const tag = 'v1.2.1-tr.999999';
    const bytes = 'test fixture - never executable';
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    await app.evaluate((_electron, fixture) => {
      globalThis.trOriginalFetch = globalThis.fetch;
      globalThis.trValidChecksum = false;
      globalThis.fetch = async (input, options) => {
        if (String(input).startsWith('https://github.com/petrofi/Open-LLM-VTuber-TR/releases/download/')) {
          return new Response(String(input).endsWith('SHA256SUMS.txt')
            ? `${globalThis.trValidChecksum ? fixture.sha256 : '0'.repeat(64)}  Open-LLM-VTuber-TR-${fixture.tag}-Setup.exe\n`
            : fixture.bytes);
        }
        return globalThis.trOriginalFetch(input, options);
      };
    },{tag,bytes,sha256});
    const invokeDownload = () => page.evaluate(tag => window.electron.ipcRenderer.invoke('tr:download-update',tag),tag);
    await assert.rejects(invokeDownload, /SHA-256/);
    await assert.rejects(() => page.evaluate(() => window.electron.ipcRenderer.invoke('tr:install-update')), /doğrulayın/);
    await app.evaluate(() => { globalThis.trValidChecksum = true; });
    const result = await invokeDownload();
    assert.equal(result.sha256,sha256);
    const data = await app.evaluate(({app}) => app.getPath('userData'));
    const file = path.join(data,'updates',result.name);
    assert.equal(await fs.readFile(file,'utf8'),bytes);
    await fs.unlink(file); // Remove only the fixture created by this test.
    await assert.rejects(() => page.evaluate(() => window.electron.ipcRenderer.invoke('tr:download-update','../../bad')), /geçersiz/);
    console.log('update checksum, rejection and path validation: PASS');
  } finally {
    await app.evaluate(() => { if(globalThis.trOriginalFetch) globalThis.fetch=globalThis.trOriginalFetch; });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
