# Traitors — Mimari Sentez ve Uygulama Planı

> 4 uzman ajanın (Backend, Frontend/UI, Oyun Mantığı, DevOps) tartışma ve analizlerinin sentezi.
> Versiyon 1.0 · Nihai Plan

---

## Yönetici Özeti

**Traitors**, web tabanlı bir Vampir Köylü (Werewolf/Mafia) oyun yönetim aracıdır. Arkadaş gruplarının tarayıcıdan katılıp oynayabileceği, moderatörün aynı zamanda oyuncu olduğu, gerçek zamanlı tur yönetimi yapan profesyonel bir araçtır.

### Uzman Ajanların Vardığı Ortak Sonuçlar

| Karar | Sonuç | Gerekçe |
|---|---|---|
| **Backend dili** | Go | Tek binary, goroutine-per-room actor modeli, `embed.FS` ile frontend gömme, ~15MB Docker image |
| **Frontend framework** | Preact + Signals | 3KB gzipped, React API uyumlu, fine-grained reactivity WebSocket güncellemeleri için ideal |
| **Gerçek zamanlı iletişim** | WebSocket (birincil) + REST (ikincil) | Çift yönlü, düşük gecikme, 30-90 dakikalık oyun oturumları için zorunlu |
| **Veritabanı** | SQLite (gömülü) + bellek içi oyun durumu | Sıfır operasyonel karmaşıklık, tek dosya yedekleme, Litestream ile sürekli replikasyon |
| **CSS/Stil** | Tailwind CSS v4 | Sıfır runtime maliyeti, mobile-first, kolay tema yönetimi |
| **Deploy** | Fly.io (birincil) / Docker+VPS (ikincil) | ~$3.34/ay, WebSocket desteği, kalıcı volume, otomatik TLS |
| **Mimari desen** | Actor-per-room (goroutine + channel) | Kilit gerektirmez, eş zamanlılık hataları önlenir, temiz kapanış |

---

## 1. Sistem Mimarisi

### 1.1 Genel Bakış

```
┌────────────────────────────────────────────────────────────────┐
│                      Tek Go Binary (~15MB)                     │
│                                                                │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐  │
│  │  REST API     │  │  WebSocket    │  │  Gömülü SPA        │  │
│  │  /api/*       │  │  /ws          │  │  (Preact, statik)  │  │
│  └──────┬───────┘  └──────┬────────┘  └──────┬─────────────┘  │
│         │                 │                   │                │
│         └────────┬────────┘                   │                │
│                  │                     Go embed.FS             │
│         ┌────────▼────────┐                                    │
│         │   Room Manager   │                                   │
│         │ ┌──────────────┐│                                    │
│         │ │ Room 1 (gor) ││ ← her oda bir goroutine           │
│         │ │ Room 2 (gor) ││                                    │
│         │ │ Room N (gor) ││                                    │
│         │ └──────────────┘│                                    │
│         └────────┬────────┘                                    │
│                  │                                             │
│         ┌────────▼────────┐                                    │
│         │    SQLite        │ ← checkpoint + audit log          │
│         │  (tek dosya)     │                                   │
│         └─────────────────┘                                    │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 Teknoloji Yığını Özeti

| Katman | Teknoloji | Neden |
|---|---|---|
| **Dil** | Go 1.22+ | Tek binary, goroutine, channel, `embed` |
| **HTTP** | `net/http` (stdlib) | ~6 REST endpoint için framework gereksiz |
| **WebSocket** | `nhooyr.io/websocket` | Temiz API, context-aware, production-grade |
| **Veritabanı** | SQLite via `modernc.org/sqlite` | Pure Go sürücü, CGO gerektirmez, binary'ye gömülür |
| **Kimlik doğrulama** | JWT (HMAC-SHA256) | Durumsuz, sıfır sürtünme, geçici |
| **Frontend** | Preact 10 + Signals | 3KB, React uyumlu, fine-grained reactivity |
| **Build** | Vite 5 | Sub-second HMR, optimized production builds |
| **Stil** | Tailwind CSS v4 + CSS custom properties | Sıfır runtime, mobile-first, faz temalı |
| **Yönlendirme** | Preact-Router | 1.6KB, hafif |
| **İkonlar** | Lucide Icons | Tree-shakeable, tutarlı, MIT |
| **Avatarlar** | DiceBear | İstemci tarafı deterministik üretim |
| **Fontlar** | Inter + Cinzel + JetBrains Mono | Okunabilirlik + atmosfer + monospace |
| **Deploy** | Fly.io / Docker / Raw Binary | ~$3.34/ay, tek komutla deploy |
| **CI/CD** | GitHub Actions | Lint, test, build, release, auto-deploy |
| **Yedekleme** | Litestream | SQLite sürekli replikasyon |

---

## 2. Backend Mimarisi

### 2.1 Veri Modeli

```
┌─────────────┐       ┌─────────────────┐       ┌──────────────┐
│    Room      │1─────*│   GameSession    │1─────*│    Player    │
├─────────────┤       ├─────────────────┤       ├──────────────┤
│ id (ULID)   │       │ id (ULID)       │       │ id (ULID)    │
│ code (6chr) │       │ room_id (FK)    │       │ session_id   │
│ created_by  │       │ status (enum)   │       │ display_name │
│ settings    │       │ phase           │       │ role (enum)  │
│ created_at  │       │ round_number    │       │ is_alive     │
│ expires_at  │       │ state_snapshot  │       │ is_moderator │
└─────────────┘       │ started_at      │       │ joined_at    │
                      │ ended_at        │       │ auth_token   │
                      │ winner (enum)   │       └──────────────┘
                      └─────────────────┘
                              │1
                              *
                      ┌───────────────┐
                      │   GameEvent    │ ← append-only audit log
                      ├───────────────┤
                      │ id            │
                      │ session_id    │
                      │ event_type    │
                      │ phase, round  │
                      │ actor_id      │
                      │ target_id     │
                      │ payload (JSON)│
                      │ created_at    │
                      └───────────────┘
```

### 2.2 Depolama Stratejisi (Hibrit)

| Katman | Depolama | İçerik |
|---|---|---|
| **Sıcak durum** | Bellek içi (Go struct) | Aktif oyun: fazlar, oylar, hayatta/ölü, rol atamaları |
| **Ilık durum** | SQLite | Oda metadatası, oyuncu profilleri, faz geçiş checkpoint'leri |
| **Soğuk durum** | SQLite | Tamamlanmış oyun istatistikleri, kazanma/kaybetme kayıtları |

Her faz geçişinde oyun durumu SQLite'a JSON blob olarak checkpoint'lenir. Çökme kurtarma: deserialize et ve `GameState` struct'ını yeniden oluştur.

### 2.3 API Mimarisi

**REST Endpoint'leri (oda/oturum yaşam döngüsü):**

```
POST   /api/rooms                    → Oda oluştur (oda kodu + moderatör token döner)
GET    /api/rooms/:code              → Oda bilgisi (genel: oyuncu sayısı, durum)
POST   /api/rooms/:code/join         → Odaya katıl (oyuncu token döner)
POST   /api/rooms/:code/game/start   → Oyunu başlat (sadece moderatör)
GET    /api/rooms/:code/game/history  → Tamamlanmış oyun olayları
GET    /healthz                      → Sağlık kontrolü
GET    /readyz                       → Hazırlık kontrolü
```

**WebSocket Bağlantısı:**

```
GET /ws?token=<player_jwt>           → WebSocket'e yükselt
```

**WebSocket Mesaj Protokolü (JSON, `type` alan ayrımcısı):**

İstemci → Sunucu: `vote`, `night_action`, `end_phase`, `chat`, `ping`, `rejoin`
Sunucu → İstemci: `phase_changed`, `player_joined`, `player_eliminated`, `vote_cast`, `vote_result`, `role_assigned`, `night_result`, `game_over`, `state_sync`, `error`, `pong`

### 2.4 Eşzamanlılık Modeli: Actor-Per-Room

```go
func (room *Room) Run(ctx context.Context) {
    for {
        select {
        case action := <-room.actionCh:     // oyuncu aksiyonu alındı
            room.handleAction(action)
        case <-room.timer.C:                // faz zamanlayıcı doldu
            room.advancePhase()
        case <-ctx.Done():                  // oda kapanışı
            room.checkpoint()               // SQLite'a kaydet
            return
        }
    }
}
```

Her oda izole bir aktördür. Mutex gerekmez. Goroutine stack ~8KB — ihmal edilebilir bellek kullanımı.

### 2.5 Kimlik Doğrulama: Sıfır Sürtünme

1. Moderatör oda oluşturur → JWT token alır
2. Oyuncular 6 karakterlik oda koduyla katılır → JWT token alır
3. JWT'de: `player_id`, `room_id`, `name`, `mod` flag, 24 saat expiry
4. Yeniden bağlanma: aynı token ile → sunucu tam durum senkronizasyonu gönderir

---

## 3. Frontend Mimarisi

### 3.1 Ekran Akışı

```
Home → Lobby → Game (Night/Day/Vote/Result alt fazları) → Results → Play Again → Lobby
```

### 3.2 6 Ana Ekran

| Ekran | URL | Amaç |
|---|---|---|
| **Home** | `/` | Oyun oluştur veya katıl. Kurt silüetli logo, sis animasyonu. |
| **Lobby** | `/game/:id` | Bekleme odası. Oyuncular katılır, moderatör rolleri yapılandırır. |
| **Game (Gece)** | `/game/:id` | Kurt adam hedef seçer, Kahin araştırır, Doktor korur. Köylüler karanlık ekran görür. |
| **Game (Gündüz)** | `/game/:id` | Tartışma, suçlama, savunma konuşması. |
| **Game (Oylama)** | `/game/:id` | Suçlu/Masum oylaması, oy ilerleme çubuğu, dramatik sonuç açıklaması. |
| **Results** | `/game/:id/results` | Kazanan duyurusu, tüm roller açığa çıkar, oyun zaman çizelgesi. |

### 3.3 Moderatör Çift Görünüm

- **FAB (Floating Action Button)**: Altın/kehribar rengi (`#D97706`), moderatör paneli açar
- **Slide-up Panel**: Tüm roller, gece aksiyonları, faz kontrolleri, oyun logu
- **Oyuncu görünümü altta kalır** (dim %20 overlay)
- Moderatör önce kendi rolü olarak hareket eder, sonra faz yönetimi yapar

### 3.4 Responsive Tasarım

| Ekran | Düzen |
|---|---|
| **Mobil (0–639px)** | Sabit header + kaydırılabilir arena + bottom sheet (varsayılan hedef) |
| **Tablet (640–1023px)** | İki sütun: oyuncu çemberi + yan panel |
| **Masaüstü (1024px+)** | Üç sütun: oyuncu listesi + arena + yan panel |

### 3.5 Tema ve Atmosfer

- **Renk paleti**: Tailwind Stone griler (sıcak alt ton) + kan kırmızısı aksan
- **Faz renkleri**: Gece=indigo ay ışığı, Gündüz=kehribar güneş, Oylama=kırmızı gerilim
- **Tipografi**: Inter (ana), Cinzel (dramatik başlıklar), JetBrains Mono (kodlar/zamanlayıcılar)
- **Faz geçiş animasyonları**: Tam ekran overlay, ay doğuşu/batışı, yıldız parıltısı, daktilo efekti (~3 saniye)
- **WCAG 2.1 AA uyumlu**: Tüm metin 4.5:1+ kontrast oranı, renk tek başına bilgi taşımaz

---

## 4. Oyun Mantığı

### 4.1 Rol Sistemi (13 Rol, 3 Takım)

| Takım | Roller |
|---|---|
| **Köy** | Köylü, Kahin, Doktor, Avcı, Cadı, Koruyucu, Cupid, Yaşlı, Köy Delisi |
| **Kurt Adam** | Kurt Adam, Alfa Kurt Adam |
| **Tarafsız** | Tabakçı, Soytarı |

Her rolün gece yeteneği, aktivasyon fazı, çözülme önceliği ve etkileşim matrisi detaylı olarak belirlenmiştir.

### 4.2 Faz Sistemi (12 Faz)

```
Rol Açılışı → Gece → Şafak → Gündüz Tartışma → Aday Gösterme →
Savunma Konuşması → Gündüz Oylama → (Tur Atma Oylaması) →
Oy Sonucu → Alacakaranlık → [Gece'ye dön] veya Oyun Sonu
```

- **Zamanlayıcılar sunucu otoriteli** — istemci countdown gösterir
- **3 geçiş tetikleyicisi**: Zamanlayıcı dolması > Aksiyon tamamlanma > Moderatör ilerleme
- **Gece alt fazları** sıralı çalışır (Cupid→Kahin→Koruyucu→Doktor→Alfa→Kurtlar→Cadı)

### 4.3 Gece Çözülme Motoru

Deterministik öncelik kuyruğu (öncelik 5–110):

| Öncelik | Rol | Aksiyon |
|---|---|---|
| 5 | Cupid | İki oyuncuyu aşık yap (Gece 1) |
| 20 | Kahin | Hedefi araştır → "Köy" veya "Kurt" |
| 25 | Koruyucu | Hedefi koru (kendisi ölür) |
| 30 | Doktor | Hedefi koru (öldürme iptal) |
| 35 | Alfa Kurt | Dönüştür (oyun başına 1 kez) |
| 40 | Kurt sürüsü | Hedefi öldür |
| 50 | Cadı (iyileştir) | Kurt hedefini kurtar |
| 60 | Cadı (öldür) | Herhangi birini öldür |
| 90 | Avcı | Ölüm tetikleyici ateş |
| 95 | Aşıklar | Kalp kırıklığı ölümü |
| 100 | — | Son ölüm çözülmesi |
| 110 | — | Kazanma koşulu kontrolü |

### 4.4 Oylama Sistemi

- **Gizli oy** (varsayılan) veya açık oy
- **Tek aday**: Suçlu/Masum ikili oylama, basit çoğunluk
- **Çoklu aday**: Çoğulculuk oylaması
- **Berabere durumları**: Eleme yok (varsayılan) / Tur atma / Moderatör karar / Rastgele
- **Aday gösterme + ikinci kişi onayı** mekanizması

### 4.5 Kazanma Koşulları

| Koşul | Kazanan |
|---|---|
| Tüm kurtlar ölü | Köy |
| Kurtlar ≥ Köylüler | Kurt |
| Tabakçı oylamayla elenir | Tabakçı |
| Çapraz takım aşıklar son 2 | Aşıklar |

### 4.6 Denge Tabloları

6–15 oyuncu için önerilen rol dağılımları belirlenmiştir. Denge skoru formülü ile moderatör özel yapılandırmaların dengesini görebilir.

---

## 5. Deploy ve Altyapı

### 5.1 Önerilen 3 Deploy Yöntemi

| Sıra | Platform | Aylık Maliyet | En İyi Kullanım |
|---|---|---|---|
| 1 | **Fly.io** | ~$3.34 | Varsayılan öneri. En iyi basitlik/maliyet/yetenek dengesi. |
| 2 | **Docker + VPS** | ~$3.50 | En esnek. Docker olan her yerde çalışır. |
| 3 | **Raw Binary + VPS** | ~$3.50 | En basit. Binary indir, çalıştır. |

### 5.2 Tek Binary Deploy

```bash
curl -fsSL https://github.com/org/traitors/releases/latest/download/traitors-linux-amd64 -o traitors
chmod +x traitors
./traitors
# → http://localhost:8080 aç, hepsi bu.
```

### 5.3 CI/CD

GitHub Actions: Lint → Test → Docker Build (multi-platform) → Binary Release (5 platform) → Fly.io Auto-Deploy

### 5.4 Güvenlik

- TLS: Caddy/Fly.io otomatik Let's Encrypt
- Rate limiting: Token-bucket per IP
- CSP, CORS, WebSocket origin doğrulama
- JWT HMAC-SHA256 imzalı tokenlar
- Input doğrulama: Sunucu tarafı (asla istemciye güvenme)

---

## 6. Uygulama Planı

### Faz 1: Çekirdek Altyapı

| # | Görev | Bileşenler |
|---|---|---|
| 1.1 | Go proje yapısı | `cmd/traitors/main.go`, `internal/` dizin yapısı |
| 1.2 | SQLite veritabanı katmanı | `modernc.org/sqlite`, göçler, bağlantı havuzu |
| 1.3 | HTTP sunucu + yönlendirme | `net/http`, REST endpoint'leri, middleware (CORS, rate limit, logging) |
| 1.4 | JWT kimlik doğrulama | Token oluşturma/doğrulama, oda kodu üretimi |
| 1.5 | WebSocket altyapısı | `nhooyr.io/websocket`, bağlantı yönetimi, heartbeat |
| 1.6 | Oda yöneticisi | Oda oluşturma, katılma, goroutine yaşam döngüsü |

### Faz 2: Oyun Motoru

| # | Görev | Bileşenler |
|---|---|---|
| 2.1 | Durum makinesi | Faz geçişleri, zamanlayıcı yönetimi |
| 2.2 | Rol sistemi | Rol arayüzü, 13 rol implementasyonu |
| 2.3 | Gece çözülme motoru | Öncelik kuyruğu, etkileşim matrisi, zincir ölümler |
| 2.4 | Oylama sistemi | Aday gösterme, ikili/çoğulculuk oylama, berabere kuralları |
| 2.5 | Kazanma koşulları | Kontrol algoritması, özel kazanma durumları |
| 2.6 | Görünürlük filtreleme | Rol bazlı bilgi gizleme, moderatör tam görünüm |

### Faz 3: Frontend

| # | Görev | Bileşenler |
|---|---|---|
| 3.1 | Proje kurulumu | Vite + Preact + TypeScript + Tailwind |
| 3.2 | WebSocket yöneticisi | Bağlantı yaşam döngüsü, yeniden bağlanma, durum senkronizasyonu |
| 3.3 | Home ekranı | Oda oluşturma/katılma, sis animasyonu |
| 3.4 | Lobby ekranı | Oyuncu grid, rol yapılandırma, QR kod, paylaşım |
| 3.5 | Game ekranı | Gece/gündüz/oylama alt fazları, oyuncu çemberi, aksiyon paneli |
| 3.6 | Moderatör paneli | FAB, slide-up overlay, tüm roller, faz kontrolleri |
| 3.7 | Results ekranı | Kazanan duyurusu, rol açılışı, zaman çizelgesi |
| 3.8 | Faz geçiş animasyonları | Ay/güneş, yıldızlar, daktilo efekti |
| 3.9 | Responsive tasarım | Mobil bottom sheet, tablet yan panel, masaüstü 3 sütun |

### Faz 4: Entegrasyon ve Parlatma

| # | Görev | Bileşenler |
|---|---|---|
| 4.1 | Frontend gömme | Go `embed.FS` ile SPA'yı binary'ye göm |
| 4.2 | Yeniden bağlanma | Token ile rejoin, tam durum senkronizasyonu |
| 4.3 | Kenar durumları | Bağlantı kopması, moderatör transferi, AFK yönetimi |
| 4.4 | Ses efektleri | Web Audio API, opsiyonel, varsayılan kapalı |
| 4.5 | Erişilebilirlik | ARIA, klavye navigasyon, azaltılmış hareket |
| 4.6 | Performans optimizasyonu | Route-based code splitting, asset optimizasyonu |

### Faz 5: Deploy ve Operasyon

| # | Görev | Bileşenler |
|---|---|---|
| 5.1 | Dockerfile | Multi-stage build, ~15-25MB final image |
| 5.2 | CI/CD pipeline | GitHub Actions (lint, test, build, release, deploy) |
| 5.3 | Fly.io deploy | `fly.toml`, volume, secrets, custom domain |
| 5.4 | Monitoring | Health check, structured logging, Prometheus metrics |
| 5.5 | Yedekleme | Litestream SQLite replikasyonu |

---

## 7. Proje Dizin Yapısı

```
traitors/
├── cmd/
│   └── traitors/
│       └── main.go                  # Giriş noktası
├── internal/
│   ├── server/
│   │   ├── server.go                # HTTP sunucu, yönlendirme
│   │   ├── middleware.go            # CORS, rate limit, logging
│   │   └── handlers.go             # REST endpoint handler'ları
│   ├── ws/
│   │   ├── hub.go                   # WebSocket hub (bağlantı registry)
│   │   ├── client.go                # WebSocket istemci temsili
│   │   └── messages.go              # Mesaj tipleri
│   ├── game/
│   │   ├── room.go                  # Oda yapısı, goroutine yaşam döngüsü
│   │   ├── state.go                 # GameState struct
│   │   ├── phase.go                 # Faz durum makinesi
│   │   ├── roles.go                 # Rol arayüzü + implementasyonlar
│   │   ├── night.go                 # Gece çözülme motoru
│   │   ├── voting.go                # Oylama sistemi
│   │   ├── win.go                   # Kazanma koşulları
│   │   ├── visibility.go            # Bilgi filtreleme
│   │   ├── config.go                # Oyun yapılandırması
│   │   └── balance.go               # Denge skoru hesaplama
│   ├── auth/
│   │   └── jwt.go                   # JWT oluşturma/doğrulama
│   ├── db/
│   │   ├── sqlite.go                # SQLite bağlantısı, göçler
│   │   └── queries.go               # Veritabanı sorguları
│   └── web/
│       ├── embed.go                 # go:embed frontend/dist
│       └── dist/                    # (build sırasında oluşturulur)
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app.tsx
│   │   ├── styles/
│   │   │   ├── tailwind.css
│   │   │   ├── theme.css
│   │   │   └── animations.css
│   │   ├── store/
│   │   │   ├── game.ts              # Oyun Signals
│   │   │   ├── connection.ts        # WebSocket bağlantı durumu
│   │   │   └── ui.ts                # Yerel UI durumu
│   │   ├── services/
│   │   │   ├── websocket.ts         # WebSocketManager
│   │   │   ├── audio.ts             # AudioManager
│   │   │   └── wakeLock.ts          # Ekran uyanık kalma
│   │   ├── types/
│   │   │   ├── game.ts
│   │   │   └── messages.ts
│   │   ├── components/
│   │   │   ├── common/              # Button, Modal, Timer, Avatar...
│   │   │   ├── home/                # HomeScreen, JoinForm...
│   │   │   ├── lobby/               # LobbyScreen, RoleConfig...
│   │   │   ├── game/                # GameScreen, PlayerCircle, VotePanel...
│   │   │   ├── moderator/           # ModeratorFAB, ModeratorPanel...
│   │   │   └── results/             # ResultsScreen, RoleReveal...
│   │   ├── hooks/
│   │   ├── utils/
│   │   └── constants/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── docs/
│   ├── ARCHITECTURE_PLAN.md         # Bu dosya
│   ├── FRONTEND_ARCHITECTURE.md     # Detaylı frontend spec
│   ├── GAME_LOGIC.md                # Detaylı oyun mantığı spec
│   └── DEPLOYMENT.md                # Detaylı deploy runbook
├── Dockerfile
├── fly.toml
├── docker-compose.yml
├── docker-compose.dev.yml
├── litestream.yml
├── railway.toml
├── .github/
│   ├── workflows/ci.yml
│   └── dependabot.yml
├── .dockerignore
├── go.mod
├── go.sum
├── LICENSE
└── README.md
```

---

## 8. Performans Hedefleri

| Metrik | Hedef |
|---|---|
| İlk İçerik Boyama (FCP) | < 1.5s (3G'de) |
| Toplam JS bundle (gzip) | < 50 KB |
| Toplam CSS (gzip) | < 15 KB |
| Docker image boyutu | < 25 MB |
| WebSocket mesaj boyutu | < 1 KB ortalama |
| Bellek kullanımı (oda başı) | < 50 KB |
| Desteklenen eşzamanlı oda | 1000+ (tek sunucu) |
| Eşzamanlı WebSocket bağlantısı | 10,000+ (tek sunucu) |
| Lighthouse Performance skoru | > 90 |

---

## 9. Kritik Mimari Kararlar ve Gerekçeler

### Karar 1: Go vs Node.js vs Rust

**Seçim: Go.** Tek binary deploy (en kritik gereksinim), goroutine-per-room aktör modeli tam uyum, ~15MB Docker image, sıfır runtime bağımlılığı. Node.js npm dependency karmaşıklığı ve tek binary zorluğu nedeniyle reddedildi. Rust aşırı karmaşık (parti oyunu için gereksiz).

### Karar 2: SQLite vs PostgreSQL

**Seçim: SQLite.** Tek binary hedefini korur. Gömülü, sıfır yapılandırma. Oyun yazma yükü (dakikada düzinelerce yazma) için fazlasıyla yeterli. PostgreSQL ayrı bir veritabanı sunucusu gerektirir — basitlik ilkesini ihlal eder.

### Karar 3: WebSocket vs SSE vs Polling

**Seçim: WebSocket.** Çift yönlü iletişim zorunlu (oyuncular aksiyon gönderir + sunucudan güncellemeler alır). SSE tek yönlü. Polling gerçek zamanlı oyun için kabul edilemez gecikme.

### Karar 4: Preact vs React vs Svelte

**Seçim: Preact + Signals.** 3KB vs React'in 42KB'ı — mobil partide hücresel veri kullanan oyuncular için kritik. Signals fine-grained reactivity sağlar (WebSocket güncellemesi sadece ilgili bileşeni render eder). React ekosistem uyumluluğu `preact/compat` ile korunur.

### Karar 5: Frontend gömme vs ayrı deploy

**Seçim: Go `embed.FS` ile gömme.** Tek binary hem API hem SPA sunar. Ayrı deploy CORS, URL yönetimi, iki ayrı deploy pipeline karmaşıklığı ekler.

### Karar 6: Yatay ölçekleme

**Seçim: Yapmıyoruz.** Tek Go sunucu 10,000+ eşzamanlı WebSocket bağlantısı ve yüzlerce aktif oyun odasını rahatça yönetir. Hedef: 6-15 oyuncu/oda. 1,000 eşzamanlı oda (15,000 oyuncu) bile $20/ay VPS'te çalışır. Erken optimizasyon en zararlı mühendislik hatalarındandır.

---

## 10. Referans Dokümanlar

Bu sentez dokümanı, aşağıdaki detaylı spesifikasyonlardan beslenir:

| Doküman | İçerik | Satır Sayısı |
|---|---|---|
| [`docs/FRONTEND_ARCHITECTURE.md`](./FRONTEND_ARCHITECTURE.md) | Framework, CSS, state management, component tree, 6 ekran wireframe, moderatör UI, responsive tasarım, animasyonlar, erişilebilirlik, tema, renk paleti, tipografi | ~1400 |
| [`docs/GAME_LOGIC.md`](./GAME_LOGIC.md) | 13 rol detayı, 12 faz sistemi, gece çözülme motoru, etkileşim matrisi, oylama sistemi, kazanma koşulları, 17 kenar durumu, denge tabloları, 45+ yapılandırma, TypeScript tipleri | ~2100 |
| [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) | 10 platform değerlendirmesi, Top 3 deploy rehberi, Dockerfile, CI/CD pipeline, yapılandırma yönetimi, monitoring, güvenlik, tek tıkla deploy, maliyet analizi, yedekleme/kurtarma | ~2000 |

**Toplam spesifikasyon: ~5,500+ satır detaylı teknik doküman.**

---

## Sonuç

Bu plan, 4 farklı uzmanlık alanından gelen analizlerin sentezlenmesiyle oluşturulmuştur. Tüm uzmanlar şu temel ilkelerde hemfikirdir:

1. **Basitlik birinci önceliktir** — tek binary, tek süreç, tek veritabanı dosyası
2. **Gerçek zamanlı tepki** — bellek içi durum, WebSocket push, sunucu otoriteli zamanlayıcılar
3. **Doğruluk** — aktör izolasyonu, deterministik çözülme, append-only olay logu
4. **Profesyonel UI** — atmosferik karanlık tema, dramatik faz geçişleri, mobil-öncelikli tasarım
5. **Kolay deploy** — `./traitors` çalıştır veya `fly deploy` yap, ~$3.34/ay
