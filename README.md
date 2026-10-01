# Open-LLM-VTuber TR — Masaüstü arayüzü

Open-LLM-VTuber projesinin resmi olmayan Türkçe topluluk sürümüdür.

Son kullanıcı kurulumu: [Ana deponun Releases sayfasından](https://github.com/petrofi/Open-LLM-VTuber-TR/releases) tek Setup.exe indirin, kurun ve masaüstü simgesinden açın. Python, Node.js veya Git gerekmez.

Bu depo [Open-LLM-VTuber-Web](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web) projesinin `v1.2.1` / `7a2e214c3f266c294541127520dab7fce46787e7` tabanındaki frontend fork'udur. Ana backend: [Open-LLM-VTuber TR](https://github.com/petrofi/Open-LLM-VTuber-TR). TR sürümü: `1.2.1-tr.1`.

Türkçe varsayılandır; ayarlardan İngilizceye geçilebilir. React, mevcut i18next, Electron ve NSIS altyapısı korunur. Özel Python runtime ana depodaki build betiğinden sağlanır.

## Geliştirme

Node 24 ile `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` çalıştırın. Installer üretimi ve backend hazırlığı için [geliştirici rehberini](https://github.com/petrofi/Open-LLM-VTuber-TR/blob/main/docs/TR/GELISTIRICI.md) izleyin.

## Lisans

Orijinal copyright ve [Open-LLM-VTuber License 1.0](LICENSE) korunmuştur; bu lisans Apache 2.0 metnine ek ticari koşullar içerir. Live2D Core/Framework ve örnek modeller ayrıca kendi lisanslarına tabidir. Tüm bildirimler installer içinde `resources/licenses` konumunda bulunur. Bu ücretsiz topluluk sürümü resmi proje olarak sunulmaz.

[Upstream İngilizce README](README.EN.md)
