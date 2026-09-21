# chatgpt-system companion (Chrome uzantısı)

ChatGPT sayfasında yerel çalışma durumunu gösterir: proje bağlamı,
daraltma brifi ve terminal/iş akışı. Komut çalıştırmaz, dosyaya dokunmaz,
yetki değiştirmez. Tek yönlü okuma + Daralt ile composer doldurma.

## Kurulum (sırayla)

1. Derle: `npm run build`
2. Köprü sunucusunu kur (bir kez):
   `npm run setup:extension-bridge -- install --root <proje-yolun>`
   Komut token üretir, LaunchAgent olarak sunucuyu başlatır ve tokenı
   ekrana yazdırır.
3. `chrome://extensions` açılır, Developer mode etkinleştirilir.
4. Load unpacked ile bu `extension/` klasörü seçilir.
5. Araç çubuğundaki chatgpt-system simgesine tıklanır, Eşleşme bölümüne
   yazdırılan `token` girilir. Proje seçimi varsayılan olarak **Otomatik**tir:
   panel, sohbette `project_register`/`project_resume`/`project_checkpoint`
   çağrılan projeyi izler. Belirli bir projeye sabitlemek istersen listeden
   seç; liste `project_list` kayıtlarından gelir.
Durum bakma: `npm run setup:extension-bridge -- status`
Kanıt: `npm run setup:extension-bridge -- verify --alias <alias>`
Kaldırma: `npm run setup:extension-bridge -- uninstall`

## İzin gerekçesi

- `storage`: eşleşme bilgileri ve hata günlüğü için.
- `alarms`: dakikada bir sağlık yoklaması için.
- `chatgpt.com`, `chat.openai.com`: panel ve Compact düğmesi için.
- `127.0.0.1`, `localhost`: yalnızca service worker köprüye erişir.
  Token content-script'e hiç verilmez; sayfa tokenı göremez.

CoS uzantısındaki `debugger`, `tabs`, `scripting` ve `http*` joker izinleri
bilerek alınmadı.

## Köprü uçları (hepsi loopback, hello hariç token ister)

- `GET /bridge/hello` — kimlik yoklaması, kimlik doğrulamasız.
- `GET /bridge/status?alias=&chat=` — proje/skill/worker/terminal sayaçları,
  kayıtlı proje listesi ve otomatik seçimdeki aktif alias.
- `GET /bridge/context?alias=&chat=` — kayıtlı bağlam + brif + plan.
  `alias` verilmezse sunucu sırayla: sohbet bağı → aktif proje ipucu → en
  güncel kayıt. `alias` açıkça verilirse o sohbet (`chat`) belirtilen
  projeye sabitlenir.
- `GET /bridge/activity?alias=&chat=&limit=` — kayıt satırları + terminal
  kuyrukları (MCP süreci ayrı çalıştığı için sınırlı disk aynasından okunur)
  + okunmamış worker mesajları.
- `POST /bridge/handoff/prepare {alias?, chat?, sessionId?}` — brif taslağı ve
  composer açılış metni. Alias verilmezse aynı çözüm uygulanır ve istek
  başarılıysa sohbet o projeye bağlanır. Kayıtlı brif varsa aynen taşınır,
  yoksa OpenCode Go ile yazdırılır; ikisi de yoksa fail-closed hata döner.

Tek eylem noktası panel başlığındaki ◐ Daralt düğmesidir; yazma
alanının içine ayrı simge konmaz.

## Birden çok sohbet

Paneldeki proje seçici varsayılan olarak **Otomatik**tir. Aynı anda birden
çok projede çalışırken her sohbette seçiciden ilgili projeyi seç: seçim o
sohbetin URL kimliğine bağlanır (`chat` parametresi), sunucuya ve yerel
depoya yazılır. Sonraki yoklamalar alias göndermese bile o sohbet seçili
projede kalır; diğer sohbetler etkilenmez. Daralt'a basmak da o anki
projeyi sohbete bağlar. Otomatiğe dönmek için seçiciden **Otomatik**'i seç.

## Kullanım (3 adım)

1. Panele bak: Bağlam projen, Bu sohbet o anki konuşmanın büyüklüğü.
2. Sohbet şişince **◐ Daralt**'a bas.
3. Paneldeki tek cümleyi oku: ya metin yazma alanına yazıldı
   (Gönder'e bas), ya panoya kopyalandı (yeni sohbette yapıştır).

## Sorun giderme

- Uçtan uca kanıt: `npm run setup:extension-bridge -- verify --alias <alias>`
  ajanı, hello ucunu, tokenı ve uzantı Origin'iyle status/handoff
  çağrılarını sınar. `SONUC: gecti` görürsen uzantı yolu sağlıklıdır.
- Hangi sürüm yüklü: panel başlığındaki `uzantı vX.Y.Z` etiketi ile popup
  altındaki sürüm aynı olmalı. Farklıysa `chrome://extensions` üzerinden ⟳
  ile yeniden yükle ve ChatGPT sekmesini yenile.
- `chrome://extensions` → Hatalar sayfası bir geçmiş listesidir; ⟳ eski
  kayıtları silmez. Düzeltme sonrası eski kayıtları çöp kutusu
  (Tümünü temizle) ile sil; yoksa "hâlâ hata var" yanılsaması sürer.
- Simgeye tıklayınca hiçbir şey olmuyorsa: `chrome://extensions`
  üzerinden uzantı devre dışı kalmış olabilir (manifest izni değişince
  Chrome kapatır). Önce etkinleştir, sonra ⟳ ile yeniden yükle, simgeyi
  araç çubuğuna sabitle. Uzantı dosyası her değiştiğinde ⟳ + sayfa
  yenileme gerekir; content-script sayfada, popup/service worker
  yeniden yüklemede güncellenir.
- "Köprü isteği reddedildi (eski sunucu)": sunucu eski sürümde çalışıyor
  demektir; `npm run build` + `npm run setup:extension-bridge -- install
  --root <yol>` ile sunucuyu güncelle, sonra `verify` çalıştır.
- "Eşleşme eksik": popup üzerinden token gir.
- "HTTP_401": token, HTTP sunucusundaki `--token` ile aynı olmalı.
- "alias_not_found": seçili proje kayıtta yok; popup'tan "Otomatik"e dön
  ya da `project_list` ile doğru alias doğrula.
- "Kayıtlı proje yok": henüz hiç `project_register` yapılmamış; sohbette
  bir kez register/resume çağrılınca panel o projeyi izlemeye başlar.
- Panel yoksa sayfa yenilenir; seçiciler ChatGPT değişiminde güvenli
  moda düşer (hiçbir şey gösterilmez, sayfa bozulmaz).
