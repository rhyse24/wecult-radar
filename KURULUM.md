# SENİN YAPACAKLARIN — sırayla (~20 dk)

> Kod hazır ve gerçek veriyle test edildi. Aşağıdaki adımlar bitince radar
> kendi kendine çalışır: 30 dk'da bir tarar, fırsatları Telegram'a atar.

## 1. Telegram botu (3 dk)
1. Telegram'da **@BotFather**'a yaz: `/newbot` → isim ver (örn. `WeCult Radar`),
   kullanıcı adı ver (örn. `wecult_radar_bot`).
2. Verdiği **token**'ı kopyala (örn. `1234567:AA...`).
3. Botuna Telegram'dan herhangi bir mesaj at (örn. "merhaba").
4. Tarayıcıda aç: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   → çıktıdaki `"chat":{"id": 123456789` sayısı senin **chat_id**'n.

## 2. GitHub reposu (3 dk)
1. github.com → New repository → isim: **wecult-radar** → **Public** → boş
   oluştur (README ekleme).
2. Bu klasörde push (ya da Claude'a "repo açıldı" de, o push'lar):
   ```
   git remote add origin https://github.com/rhyse24/wecult-radar.git
   git push -u origin main
   ```

## 3. Supabase tablosu (2 dk)
Supabase Dashboard → SQL Editor → `docs/RADAR_TABLES.sql` içeriğini yapıştır,
çalıştır. (Tablolara sadece service_role erişir; RLS açık, policy yok.)

## 4. Secrets (5 dk)
GitHub → wecult-radar → Settings → Secrets and variables → Actions:

**Secrets** (New repository secret):
| İsim | Değer |
|---|---|
| `GROQ_API_KEY` | wecult-web'dekiyle aynı anahtar |
| `SUPABASE_URL` | `https://<proje>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role key |
| `TELEGRAM_BOT_TOKEN` | Adım 1'deki token |
| `TELEGRAM_CHAT_ID` | Adım 1'deki chat_id |

**Variables** sekmesi (New repository variable):
| İsim | Değer |
|---|---|
| `RADAR_ENABLED` | `true` |

## 5. İlk çalıştırma (2 dk)
Actions sekmesi → **radar** workflow → **Run workflow** (job: `scan`).
1-3 dk içinde Telegram'a ilk mesajlar düşmeli. Düşmezse run log'unu Claude'a
göster.

## 6. Kapatmak istersen
Variables → `RADAR_ENABLED` → `false` yap; cron'lar boş döner.

---

## Hatırlatma — radar SANA getirir, SEN gönderirsin
- Taslaklar iskelet: kendi cümlelerinle kişiselleştir, kopyala-yapıştır yapma.
- Günde en fazla 3 link'li yorum; aynı subreddit'e haftada en fazla 2.
- Her üründen bahsedişte "geliştiricisiyim / I'm building WeCult" de.
- 25 Temmuz'dan sonra `.github/workflows/radar.yml` içindeki ilk cron satırını
  `17 */2 * * *` yap (kalıcı tempo) — Claude'a söylemen yeterli.

## Kod beklemeyen işler (kampanya için kritik, henüz yapılmadıysa)
1. **AlternativeTo**: alternativeto.net → "Add application" → WeCult'u ekle;
   sonra TV Time sayfasında alternatif olarak öner. (Metin lazımsa Claude yazar.)
2. **SaaSHub + Product Hunt** kayıtları.
3. **Google Alerts**: alerts.google.com → "TV Time alternative", "dizi takip
   uygulaması" vb. → teslimat: RSS → URL'leri Claude'a ver, radar'a eklensin.
