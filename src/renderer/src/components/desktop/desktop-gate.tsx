/* eslint-disable no-nested-ternary -- Wizard navigation labels depend on first/last step. */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './desktop-gate.css';

const invoke = (channel: string, ...args: unknown[]) => {
  if (!window.electron) return Promise.reject(new Error('Desktop runtime unavailable'));
  return window.electron.ipcRenderer.invoke(channel, ...args);
};
const request = (path: string, method = 'GET') => invoke('tr:request', path, method);
type Settings = { baseUrl?: string; model?: string; voice?: string; completed?: boolean };
type Provider = { name: string; baseUrl: string; models: string[] };

export default function DesktopGate({ children }: { children: ReactNode }): ReactNode {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [key, setKey] = useState<string | undefined>(undefined);
  const [hardware, setHardware] = useState<any>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphone, setMicrophone] = useState(localStorage.getItem('tr-microphone') || '');
  const [level, setLevel] = useState(0);
  const [asr, setAsr] = useState<any>({});
  const [providers, setProviders] = useState<Provider[]>([]);
  const [result, setResult] = useState('');
  const [updates, setUpdates] = useState<any>(null);
  const [downloaded, setDownloaded] = useState<any>(null);
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const isDesktop = Boolean(window.api);

  useEffect(() => { window.electron?.ipcRenderer.send('tr:language', i18n.language); }, [i18n.language]);

  function applyEndpoint(endpoint: string) {
    localStorage.setItem('wsUrl', JSON.stringify(`${endpoint.replace('http:', 'ws:')}/client-ws`));
    localStorage.setItem('baseUrl', JSON.stringify(endpoint));
    // Backend ports change across launches; retain the selected background path.
    try {
      const stored = JSON.parse(localStorage.getItem('backgroundUrl') || 'null');
      if (typeof stored === 'string') {
        const url = new URL(stored);
        if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/bg/')) {
          localStorage.setItem('backgroundUrl', JSON.stringify(endpoint + url.pathname));
        }
      }
    } catch { /* Invalid optional background preference falls back in its provider. */ }
  }
  function stopMicrophone() {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    meter.current?.close();
    meter.current = null;
  }
  useEffect(() => {
    if (!isDesktop) return;
    invoke('tr:status').then((value) => {
      setStatus(value); setSettings(value.settings); setError(value.error);
      if (value.endpoint) applyEndpoint(value.endpoint);
      setOpen(!value.settings.completed || Boolean(value.error));
    }).catch((err) => setError(String(err)));
    const reopen = () => { setStep(0); setOpen(true); };
    window.addEventListener('tr-settings-open', reopen);
    return () => { stopMicrophone(); window.removeEventListener('tr-settings-open', reopen); };
  }, []);
  useEffect(() => {
    if (!open) return;
    setResult(''); setError(status?.error || '');
    if (step === 1) invoke('tr:hardware').then(setHardware).catch((err) => setError(String(err)));
    if (step === 2 || step === 3) navigator.mediaDevices.enumerateDevices().then(setDevices).catch((err) => setError(String(err)));
    if (step !== 2) stopMicrophone();
    if (step === 5) request('/tr/providers').then(setProviders).catch((err) => setError(String(err)));
    if (step !== 4) return;
    const poll = () => request('/tr/asr/status').then(setAsr).catch((err) => setError(String(err)));
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [step, open]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(String(err)); } finally { setBusy(false); }
  }
  async function startMicrophone() {
    stopMicrophone();
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: microphone ? { exact: microphone } : undefined, echoCancellation: true, noiseSuppression: true,
      } });
      setDevices(await navigator.mediaDevices.enumerateDevices());
      meter.current = new AudioContext();
      const analyser = meter.current.createAnalyser();
      analyser.fftSize = 256;
      meter.current.createMediaStreamSource(stream.current).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, n) => sum + (n - 128) ** 2, 0) / samples.length);
        setLevel(Math.min(100, rms * 5));
        raf.current = requestAnimationFrame(tick);
      };
      tick(); setResult(t('desktop.micReady'));
    } catch { throw new Error(t('desktop.micError')); }
  }
  async function save(completed = false) {
    const saved = await invoke('tr:save', { ...settings, apiKey: key, completed });
    applyEndpoint(saved.endpoint);
    setStatus({ ...status, endpoint: saved.endpoint, error: '' });
    if (completed) { setSettings({ ...settings, completed: true }); setOpen(false); }
  }
  function testSpeaker() {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.08; oscillator.frequency.value = 440;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.5);
    oscillator.onended = () => context.close();
    setResult(t('desktop.speakerPlayed'));
  }
  if (!isDesktop) return children;
  if (status && !open) return children;
  const steps = ['welcome', 'system', 'microphone', 'speaker', 'asr', 'llm', 'voice', 'ready'];
  return (
    <div className="tr-gate">
      <header className="tr-bar">
        <strong>Open-LLM-VTuber TR</strong>
        <div>
          <select aria-label={t('settings.general.language')} value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
            <option value="tr-TR">Türkçe</option>
            <option value="en">English</option>
          </select>
          <button type="button" onClick={() => window.electron?.ipcRenderer.send('window-close')} aria-label={t('common.close')}>×</button>
        </div>
      </header>
      <main className="tr-card">
        <nav aria-label={t('desktop.setup')}>
          <span>{t('desktop.setup')}</span>
          <span>
            {step + 1}
            {' '}
            / 8
          </span>
        </nav>
        <div className="tr-progress"><div style={{ width: `${((step + 1) / 8) * 100}%` }} /></div>
        <h1>{t(`desktop.${steps[step]}`)}</h1>
        {!status && <p role="status">{t('desktop.starting')}</p>}
        {error && (
        <div className="tr-error" role="alert">
          <strong>{t('desktop.operationFailed')}</strong>
          <details>
            <summary>{t('desktop.details')}</summary>
            {error}
          </details>
          <button type="button" onClick={() => invoke('tr:logs')}>{t('desktop.logs')}</button>
        </div>
        )}
        {step === 0 && (
        <>
          <p className="tr-lead">{t('desktop.welcomeText')}</p>
          <p>{t('settings.about.community')}</p>
          <p>{t('desktop.privacy')}</p>
          <p><a href="https://github.com/petrofi/Open-LLM-VTuber-TR/blob/main/NOTICE-TR.md" target="_blank" rel="noreferrer">{t('settings.about.viewLicense')}</a></p>
          <div className="tr-actions">
            <button type="button" onClick={() => invoke('tr:logs')}>{t('desktop.logs')}</button>
            <button type="button" onClick={() => run(async () => setUpdates(await invoke('tr:updates')))}>{t('desktop.updates')}</button>
          </div>
          {updates && (
          <p>
            {updates.latest && updates.latest !== `v${updates.current}` ? `${t('desktop.newVersion')} ${updates.latest}` : t('desktop.noUpdate')}
            <button type="button" onClick={() => invoke('tr:open', 'releases')}>{t('desktop.viewRelease')}</button>
            {updates.latest && <button type="button" disabled={busy} onClick={() => run(async () => setDownloaded(await invoke('tr:download-update', updates.latest)))}>{t('desktop.downloadUpdate')}</button>}
            {downloaded && (
            <>
              <span>
                {t('desktop.checksumVerified')}
                {' '}
                ·
                {' '}
                {downloaded.sha256}
              </span>
              <button type="button" onClick={() => run(async () => { await invoke('tr:install-update'); })}>{t('desktop.installUpdate')}</button>
            </>
            )}
            <button type="button" onClick={() => { setUpdates(null); setDownloaded(null); }}>{t('desktop.later')}</button>
          </p>
          )}
        </>
        )}
        {step === 1 && (
        <>
          {hardware ? (
            <dl>
              <dt>{t('desktop.os')}</dt>
              <dd>
                {hardware.os}
                {' '}
                ·
                {' '}
                {hardware.architecture}
              </dd>
              <dt>CPU</dt>
              <dd>{hardware.cpu}</dd>
              <dt>RAM</dt>
              <dd>
                {hardware.ramGB}
                {' '}
                GB
              </dd>
              <dt>GPU</dt>
              <dd>{hardware.extra?.GPU?.join(', ') || t('desktop.unavailable')}</dd>
              <dt>{t('desktop.disk')}</dt>
              <dd>
                {hardware.extra?.FreeGB ?? '—'}
                {' '}
                GB
              </dd>
            </dl>
          ) : <p>{t('desktop.checking')}</p>}
          <p>{t('desktop.cpuDefault')}</p>
        </>
        )}
        {step === 2 && (
        <>
          <label>
            {t('desktop.microphone')}
            <select
              value={microphone}
              onChange={(e) => {
                setMicrophone(e.target.value); localStorage.setItem('tr-microphone', e.target.value); stopMicrophone();
              }}
            >
              <option value="">{t('desktop.defaultDevice')}</option>
              {devices.filter((d) => d.kind === 'audioinput').map((d, n) => <option key={d.deviceId || n} value={d.deviceId}>{d.label || `${t('desktop.device')} ${n + 1}`}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => run(startMicrophone)}>{t('desktop.testMic')}</button>
          <label>
            {t('desktop.inputLevel')}
            <meter aria-label={t('desktop.inputLevel')} min="0" max="100" value={level} />
          </label>
          <p>{t('desktop.micHint')}</p>
        </>
        )}
        {step === 3 && (
        <>
          <p>{devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')?.label || t('desktop.defaultDevice')}</p>
          <button type="button" onClick={testSpeaker}>{t('desktop.testSpeaker')}</button>
          <p>{t('desktop.speakerHint')}</p>
        </>
        )}
        {step === 4 && (
        <>
          <p>{t('desktop.asrDescription')}</p>
          <p>{asr.ready ? t('desktop.asrReady') : t('desktop.asrMissing')}</p>
          <button type="button" disabled={busy || asr.state === 'downloading' || asr.ready} onClick={() => run(async () => { await request('/tr/asr/download', 'POST'); setAsr({ state: 'downloading' }); })}>
            {asr.state === 'downloading' ? t('desktop.downloading') : t('desktop.downloadAsr')}
          </button>
          {asr.message && <p role="status">{asr.message}</p>}
          <p>{t('desktop.asrSize')}</p>
        </>
        )}
        {step === 5 && (
        <>
          <p>{t('desktop.llmDescription')}</p>
          {providers.map((p) => (
            <button type="button" key={p.baseUrl} onClick={() => setSettings({ ...settings, baseUrl: p.baseUrl, model: p.models[0] || '' })}>
              {p.name}
              {' '}
              ·
              {' '}
              {p.models.length}
              {' '}
              {t('desktop.models')}
            </button>
          ))}
          {!providers.length && <p>{t('desktop.noProvider')}</p>}
          <div className="tr-actions">
            <button type="button" onClick={() => invoke('tr:open', 'ollama')}>{t('desktop.installLocal')}</button>
            <button type="button" onClick={() => setSettings({ ...settings, baseUrl: 'https://api.openai.com/v1', model: '' })}>{t('desktop.useApi')}</button>
          </div>
          <label>
            {t('desktop.apiUrl')}
            <input value={settings.baseUrl || 'http://127.0.0.1:11434/v1'} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} />
          </label>
          <label>
            {t('desktop.model')}
            <input list="tr-models" value={settings.model || ''} onChange={(e) => setSettings({ ...settings, model: e.target.value })} />
          </label>
          <datalist id="tr-models">{providers.flatMap((p) => p.models).map((m) => <option value={m} key={m}>{m}</option>)}</datalist>
          <label>
            {t('desktop.apiKey')}
            <input type="password" autoComplete="off" value={key || ''} placeholder={status?.hasKey ? t('desktop.keySaved') : ''} onChange={(e) => setKey(e.target.value)} />
          </label>
          <button type="button" disabled={busy || !settings.model} onClick={() => run(async () => { await save(); const value = await request('/tr/llm/test', 'POST'); setResult(value.text); })}>{t('desktop.testLlm')}</button>
        </>
        )}
        {step === 6 && (
        <>
          <p>{t('desktop.voiceDescription')}</p>
          <label>
            {t('desktop.voice')}
            <select value={settings.voice || 'tr-TR-EmelNeural'} onChange={(e) => setSettings({ ...settings, voice: e.target.value })}>
              <option value="tr-TR-EmelNeural">Emel · Türkçe</option>
              <option value="tr-TR-AhmetNeural">Ahmet · Türkçe</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => run(async () => { await save(); const value = await request('/tr/tts/test', 'POST'); await new Audio(`data:audio/mpeg;base64,${value.audio}`).play(); setResult(t('desktop.ttsPlayed')); })}>{t('desktop.testVoice')}</button>
        </>
        )}
        {step === 7 && (
        <>
          <p>{settings.model ? t('desktop.readyText') : t('desktop.providerRequired')}</p>
          <p>{t('desktop.settingsHint')}</p>
          <button type="button" onClick={() => setStep(5)}>{t('desktop.advanced')}</button>
        </>
        )}
        {result && <p className="tr-success" role="status">{result}</p>}
        <footer>
          <button type="button" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>{t('desktop.back')}</button>
          <button
            type="button"
            className="tr-primary"
            disabled={!status || busy || Boolean(status.error)}
            onClick={() => {
              if (step === 7) run(async () => { stopMicrophone(); await save(true); }); else setStep(step + 1);
            }}
          >
            {busy ? t('desktop.working') : step === 0 ? t('desktop.begin') : step === 7 ? t('desktop.startChat') : t('desktop.next')}
          </button>
        </footer>
      </main>
    </div>
  );
}
