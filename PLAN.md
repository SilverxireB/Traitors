# Vampir Köylü — Web Tabanlı Oyun & Tur Yönetim Aracı

**Hedef:** Yılbaşı gecesi 6–12 kişilik bir arkadaş grubunun, telefon/laptop tarayıcısından, hiçbir uygulama indirmeden, **moderatör de oynayabilecek** şekilde oynayacağı, atmosferik ve profesyonel görünümlü, otomatik refresh'li bir Vampir Köylü aracı.

Bu doküman; bir Oyun Tasarımcısı, bir UX/Frontend mimarı, bir Backend/Realtime mimarı ve bir DevOps uzmanından oluşan dört ajanlı tartışmanın çıktılarını sentezler. Çelişkili noktalar (örneğin SvelteKit vs Next.js, SSE vs Socket.IO) tek bir karara bağlanmıştır; gerekçesi her bölümün altındadır.

---

## 0. Yönetici Özeti (TL;DR)

| Karar | Seçim | Neden |
|---|---|---|
| Frontend framework | **SvelteKit** (Svelte 5 + runes) + Tailwind | Yerleşik animasyonlar, küçük bundle (mobil zayıf 4G), `adapter-node` ile tek süreç |
| Realtime transport | **Socket.IO** (WS + polling fallback) | Native room/private-event/ack — rol gizliliği için kritik |
| Backend dili | **TypeScript / Node.js** (SvelteKit'in `+server.ts` ile entegre özel `server.ts`) | Frontend ile tip paylaşımı; tek runtime |
| State storage | **In-memory `Map<RoomId, Room>`** + 30 sn'de bir disk snapshot | 12 oyuncu × birkaç oda → DB lüksü gereksiz |
| Mimari | **pnpm monorepo, tek container** (`apps/web` + `packages/shared`, custom `server.ts`) | Tek deploy, tek URL, tek port |
| Deploy | **Fly.io** (Frankfurt, `shared-cpu-1x`, 256 MB) | WS native, HTTPS otomatik, free tier'da $0 |
| Moderasyon | **Tam otomatik bot** (host'ta sadece "duraklat / oyuncu çıkar / iptal" istisna butonları, audit log'lu) | Host da hilesizce oynar |
| MVP rol seti | Köylü, Vampir, Doktor, Gözcü, Avcı | "Türk usulü" minimum eğlenceli set |
| Oylama | Açık + 1 kez tie-break | Klasik meta-oyun keyfi |
| Mobil gizlilik | Long-press ile rol göster, 5 sn idle auto-kapan, fullscreen API | Telefonu komşuya kaptırmadan oyna |
| Yılbaşı maliyeti | **$0** | Fly.io free tier + scale-to-zero |

---

## 1. Tartışmadaki Dört Ajan ve Pozisyonları

| Ajan | Birincil pozisyon | Çelişki yarattığı noktalar |
|---|---|---|
| **Oyun Tasarımcısı** | 5 rollü "Türk usulü" set, tam otomatik bot moderasyon, açık oylama, mezarlık modu | — (saf domain önerileri) |
| **UX / Frontend** | SvelteKit + SSE + Tailwind, mobile-first PWA, server-driven state, optimistic update yok | Stack: SvelteKit ↔ Backend ajanı Next.js önerdi. Transport: SSE ↔ Backend Socket.IO önerdi. |
| **Backend / Realtime** | Next.js + Socket.IO, ayrı süreçler, in-memory + Redis opsiyonel, Strategy/Registry rol mimarisi | Tek-süreç ↔ DevOps ajanı tek container önerdi. Stack: Next.js ↔ UX SvelteKit önerdi. |
| **DevOps** | Fly.io tek container, in-memory yeter, $0 maliyet, Vercel'i WS yokluğundan ele | "Tek container" ↔ Backend ajanı ayrı süreçler önerdi |

### Çatışmaların Çözümü (sentez kararları)

#### Çatışma 1: SvelteKit mi, Next.js mi?
**Karar: SvelteKit.**

- UX ajanının argümanları (yerleşik `transition:`, küçük bundle, mobilde hız) yılbaşı gecesi telefon-ağırlıklı kullanım için somut değer üretir.
- Backend ajanının Next.js önerisinin temel motivasyonu "frontend-backend tip paylaşımı" idi — bu **monorepo `packages/shared`** ile her iki framework'te de elde edilir.
- DevOps ajanı Vercel'i WebSocket yokluğundan zaten elemiş; Next.js'in ana ekosistem avantajı (Vercel) bu projede yok.
- SvelteKit `adapter-node` ile çıkan tek bir Node süreci hem UI'yi hem Socket.IO'yu hosts edebilir → DevOps'un istediği "tek container, tek deploy" mimarisi doğal kuruluyor.

#### Çatışma 2: SSE mi, Socket.IO mu?
**Karar: Socket.IO.**

- UX ajanının SSE argümanı geçerli ama **çift yönlü trafik var**: vampir hedef seçimi, oy verme, gece aksiyonları, lobi chat'i. SSE tek yönlü olduğu için "client → server" için ek bir REST katmanı gerekiyor.
- Daha kritiği: rol gizliliği için **per-socket private emit** lazım. Socket.IO'nun `io.to(socketId).emit(...)` ve dinamik room (vampir kanalı) primitives'i tam olarak bu ihtiyaç için var. SSE ile aynısını yapmak el-yazımı user→stream eşlemesi gerektiriyor.
- Socket.IO'nun **ack callback** mekanizması her client aksiyonunun başarı/hata durumunu deterministik döndürüyor — "Oyumu kilitle" gibi geri alınamaz aksiyonlarda kritik.
- Socket.IO dahili olarak WebSocket → long-polling fallback yapıyor; UX'in "kurumsal proxy / Cloudflare" itirazı bu sayede karşılanıyor.
- UX ajanının `Last-Event-ID` ile reconnect endişesi → Socket.IO `connection_recovery` özelliği aynı işi görüyor.

#### Çatışma 3: Tek süreç mi, ayrı süreçler mi?
**Karar: Tek süreç (custom `server.ts` ile SvelteKit + Socket.IO aynı Node process'inde).**

- Backend ajanının "Next.js dev HMR Socket.IO ile kavga eder" itirazı doğru ama **SvelteKit için durum farklı**: SvelteKit'in custom server pattern'i resmi olarak destekleniyor (`server.ts` Vite middleware'i sarar) ve HMR oyun state'ini sıfırlamıyor — çünkü oyun state'i SvelteKit modüllerinden ayrı bir modülde tutulur (`apps/web/src/lib/server/game/`).
- Tek süreç = tek container = tek `fly deploy` = tek URL, sticky-session derdi yok.
- Yatay ölçek **gerekmiyor**: yılbaşı için tek odadan 3 odaya kadar çıkacak.

#### Çatışma 4: Persistence stratejisi
**Karar: In-memory + 30 sn'de bir `./data/snapshot.json` (atomik write), Redis YOK.**

- Backend ajanının "Redis snapshot" önerisi MVP için gereksiz karmaşıklık.
- DevOps ajanının "yılbaşı gecesi deploy yapma, crash kabul" tavsiyesi pragmatik ama "snapshot dosyası" **ekleme maliyeti ~30 satır kod**, restart'tan kurtarıyor. Bu kadarını yapalım.
- Snapshot dosyasını chmod 600, oyun bitince sil (rolleri içerir).

---

## 2. Birleşik Mimari

```
┌───────────────────────────────────────────────────────────────────┐
│  Tek Node.js Process (Fly.io: shared-cpu-1x, 256 MB, fra region)  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  custom server.ts                                           │  │
│  │  ├─ HTTP: SvelteKit handler (UI + +server.ts REST)          │  │
│  │  └─ WebSocket: Socket.IO (rol-gizli, ack'li realtime)       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│            │                                  │                   │
│            ▼                                  ▼                   │
│  ┌──────────────────┐              ┌──────────────────┐           │
│  │ Lib (UI components│              │ Game Engine     │           │
│  │ + client stores)  │              │ (in src/lib/    │           │
│  │                   │              │  server/game/)  │           │
│  └──────────────────┘              ├──────────────────┤           │
│                                    │ RoomService     │           │
│                                    │ SessionService  │           │
│                                    │ StateMachine    │           │
│                                    │ NightResolver   │           │
│                                    │ RoleRegistry    │           │
│                                    │ Projection      │           │
│                                    └──────────────────┘           │
│                                              │                    │
│                                              ▼                    │
│                                    ┌──────────────────┐           │
│                                    │ In-memory:       │           │
│                                    │ Map<roomId,Room> │           │
│                                    │ + 30s snapshot   │           │
│                                    │   to /data       │           │
│                                    └──────────────────┘           │
└───────────────────────────────────────────────────────────────────┘
                          │
                          ▼
                  Fly.io HTTPS edge
                          │
                          ▼
        Telefon tarayıcı (PWA manifest, mobile-first)
```

### Repo yapısı

```
vampir-koylu/
├─ apps/
│  └─ web/                       # SvelteKit (UI + REST + Socket.IO host)
│     ├─ src/
│     │  ├─ routes/              # /, /create, /join, /room/[code]/...
│     │  ├─ lib/
│     │  │  ├─ components/       # ui/, game/, atmosphere/
│     │  │  ├─ stores/           # game.svelte.ts, session.svelte.ts
│     │  │  ├─ realtime/         # socket-client.ts
│     │  │  └─ server/
│     │  │     └─ game/          # engine, roles, projection (server-only)
│     │  ├─ app.html
│     │  └─ hooks.server.ts
│     ├─ server.ts               # custom Node entry: SvelteKit + Socket.IO
│     ├─ svelte.config.js        # adapter-node
│     ├─ vite.config.ts
│     └─ tailwind.config.ts
├─ packages/
│  └─ shared/                    # tipler, zod schemas, sabitler, event isimleri
│     └─ src/
│        ├─ domain.ts            # Role, Phase, Player, GameState
│        ├─ events.ts            # Socket event isim + payload zod schemaları
│        └─ rules.ts             # rol dağıtım tablosu, faz süreleri
├─ Dockerfile                    # multi-stage, alpine, ~80 MB image
├─ fly.toml
├─ pnpm-workspace.yaml
├─ package.json
└─ README.md
```

---

## 3. Oyun Tasarımı (Birleşik)

### 3.1 Roller (MVP)

| Rol | Takım | Aksiyon | Gece Sırası |
|---|---|---|---|
| Köylü | Köy | Yok (sadece gündüz oy) | — |
| Vampir | Vampir | Geceleri ortak hedef seçer | 1 |
| Doktor | Köy | Geceleri bir kişiyi korur (kendini değil) | 2 |
| Gözcü | Köy | Bir kişinin takımını öğrenir | 3 |
| Avcı | Köy | Öldüğünde bir kişiyi yanında götürür | — (pasif tetik) |

### 3.2 Oyuncu sayısına göre rol dağılımı (default, host override edebilir)

| N | Vampir | Doktor | Gözcü | Avcı | Köylü |
|--:|--:|--:|--:|--:|--:|
| 5 | 1 | 1 | 1 | 0 | 2 |
| 6 | 1 | 1 | 1 | 1 | 2 |
| 7 | 2 | 1 | 1 | 0 | 3 |
| 8 | 2 | 1 | 1 | 1 | 3 |
| 9 | 2 | 1 | 1 | 1 | 4 |
| 10 | 3 | 1 | 1 | 1 | 4 |
| 11 | 3 | 1 | 1 | 1 | 5 |
| 12 | 3 | 1 | 1 | 1 | 6 |

Genel kural: vampir ≈ `floor(N/4)`, en az 1, en fazla `floor(N/3)−1`.

### 3.3 Faz akışı (state machine)

```
LOBBY → ROLE_REVEAL → NIGHT → DAWN → DAY → VOTE → EXECUTION → 
  → (kazanan? GAME_OVER : NIGHT, dayNumber++)
```

| Faz | Default süre | UI ne gösterir |
|---|---|---|
| LOBBY | sınırsız | Oda kodu + QR + oyuncu listesi + hazır toggle + rol preset |
| ROLE_REVEAL | 10 sn | Long-press ile rol kartı (sadece kendi) |
| NIGHT | 60 sn | Role-bazlı: vampir kurban seç, doktor koru, gözcü sorgula, köylü/avcı "uyu" ay animasyonu |
| DAWN | 8 sn | Sinematik gün doğumu + "X öldü, rolü Y'ydi" anonsu |
| DAY | 180 sn (ayar) | Yaşayan grid + olay günlüğü + "oylamaya geç" butonu |
| VOTE | 60 sn | Yaşayan kart grid + oy + kilit (1 sn delay) |
| EXECUTION | 8 sn | Linç anonsu + rol açıklaması + Avcı tetiklenirse hedef seç |
| GAME_OVER | sınırsız | Kazanan tarafa göre tema, tüm rol reveal, oyun günlüğü, "tekrar oyna" |

Server tek faz otoritesidir; client `phaseEndsAt` epoch ms'i sadece görsel timer için kullanır, faz değişikliği server'dan gelen `phase:changed` event'iyle olur.

### 3.4 Moderatör = Oyuncu sorununun çözümü

Tam otomatik bot moderasyon (zero rol-bilgili host yetkisi) **+** sadece rol-bilgisi gerektirmeyen istisna butonları:

- **Host yapamaz**: rol görüntüleme, kim vampir öğrenme, faz öncesi oyun-içi karara müdahale.
- **Host yapabilir** (audit log'lu, oyun sonunda herkese gösterilir):
  - Oyunu duraklat / devam ettir
  - Faz timer'ını uzat / kısalt
  - Bağlantısı kopan oyuncuyu acil çıkar (oyun dengesi kalsın diye normalde otomatik AFK kuralı çalışır)
  - Oyunu iptal et / yeniden başlat
- Tüm bu host aksiyonları `auditLog: HostAction[]` listesine yazılır, `GAME_OVER` ekranında "Moderatör Müdahaleleri" sekmesi olarak gösterilir.

### 3.5 Edge case kararları

| Durum | Kural |
|---|---|
| Oyuncu bağlantı kopması (<30 sn) | "Bağlantısı zayıf" rozeti, faz devam eder |
| Oyuncu bağlantı kopması (>30 sn) | Aksiyonu "pas" sayılır, oy "çekimser", host'a "çıkar" butonu |
| 2+ vampir farklı hedef seçer | Müzakere fazı; eşitse "lider vampir" (rastgele atanmış) belirler |
| Oylama berabere | 1 kez tie-break (sadece eşit kalanlar arasında); hâlâ berabere ise kimse linç edilmez |
| Doktor kendini koruyabilir mi? | **Hayır** (klasik); v1.1'de host konfigi |
| Aynı kişiyi üst üste koruma | Yasak |
| Gözcü vampir lideri sorgular | "Vampir" gözükür (tek vampir lideri yok MVP'de zaten) |
| Avcı linç ve gece ölümleri | İkisinde de tetiklenir; ölmeden önce hedef seçer |
| Aşıklar ölünce | (post-MVP) |
| Tüm köylüler hayatta vampirler ölürse | Köy hemen kazanır |

### 3.6 Kazanma koşulları

- **Köy kazanır**: Tüm vampirler ölü.
- **Vampir kazanır**: Vampir sayısı >= vampir-olmayan canlı sayısı.
- Her faz sonunda otomatik kontrol; `GAME_OVER`'a geçer.

---

## 4. Backend Detayı

### 4.1 Domain tipleri (`packages/shared/src/domain.ts`)

```ts
export type RoleId = "VILLAGER" | "WEREWOLF" | "SEER" | "DOCTOR" | "HUNTER";
export type Team   = "VILLAGE" | "WEREWOLF";
export type Phase  =
  | "LOBBY" | "ROLE_REVEAL" | "NIGHT" | "DAWN"
  | "DAY"   | "VOTE"        | "EXECUTION" | "GAME_OVER";

export interface PlayerPublic {
  id: string; name: string; avatar: string;
  alive: boolean; connected: boolean;
  isHost: boolean; hasActedThisPhase: boolean;
}

export interface PlayerPrivate extends PlayerPublic {
  role: RoleId;
  knownAllies: string[];     // sadece vampirler dolu
  notes: string[];           // ör. gözcü sorgu sonuçları
}

export interface RoomPublic {
  code: string; phase: Phase; dayNumber: number;
  phaseEndsAt: number | null;     // epoch ms
  players: PlayerPublic[];
  events: PublicEvent[];          // ölüm anonsları, oy tally'leri
  voteTally?: { targetId: string; count: number }[];
  result?: { winningTeam: Team; reveal: { id: string; role: RoleId }[] };
  config: RoomConfig;
}

export interface ClientStateView {
  room: RoomPublic;
  me: PlayerPrivate;
  pendingAction?: { kind: "PICK_TARGET"|"VOTE"|"NONE"; candidates: string[]; expiresAt: number };
  isHost: boolean;
}
```

### 4.2 Olay sözleşmesi

#### REST (yalnız lifecycle)
```
POST /api/rooms                  → { code, playerId, sessionToken }
POST /api/rooms/:code/join       → { playerId, sessionToken }
POST /api/rooms/:code/resume     → { ok }
GET  /api/rooms/:code/exists     → { exists, phase, playerCount }
```

#### Socket.IO (ack'li)
```
client → server (hepsi ack'li, hata kodları enum):
  room:joinSocket          { code }                              → { state }
  lobby:setReady           { ready }                             → ok
  lobby:updateConfig       { partial config }                    → ok|err   (host)
  lobby:startGame          {}                                    → ok|err   (host)
  night:action             { kind, targetId? }                   → ok|err
  vote:cast                { targetId | "SKIP" }                 → ok
  vote:lock                {}                                    → ok
  day:chat                 { text }                              → ok
  mod:phase                { action: pause|resume|extend|next }  → ok|err   (host)
  mod:forceKick            { targetId }                          → ok|err   (host)
  meta:ping                {}                                    → { serverTime }

server → client:
  state:full               ClientStateView
  phase:changed            { phase, endsAt, dayNumber }
  role:private             PlayerPrivate                  (sadece sahibine)
  prompt:action            PendingActionPrompt            (sadece sahibine)
  death:announced          { playerId, cause }
  vote:update              { tally, totalVoters }
  player:joined|left|reconnected
  game:over                { winningTeam, reveal[], hostAuditLog[] }
  error                    { code, message }
```

Hata kodları: `WRONG_PHASE`, `NOT_ALLOWED_FOR_ROLE`, `TARGET_DEAD`, `ALREADY_ACTED`, `RATE_LIMITED`, `NOT_HOST`.

### 4.3 Rol gizliliği — kod review kuralı

> **Kural**: Raw `Room` objesini bir socket emit'ine geçirmek YASAKTIR. Tüm dış payload'lar `projectFor(room, viewerId)` projeksiyonundan geçer.

```ts
function projectFor(room: Room, viewer: PlayerServer): ClientStateView {
  return {
    room: toPublicRoom(room),     // rolsüz, anonim oyuncu listesi
    me:   toPrivatePlayer(room, viewer), // viewer'ın rolü + knownAllies
    pendingAction: computePrompt(room, viewer),
    isHost: room.hostId === viewer.id,
  };
}
```

Vampirler için: `viewer.role === "WEREWOLF"` ise `knownAllies = [diğer vampir id'leri]`. Diğerlerine boş.

Doktor seçimi **asla** event'e dönüşmez; sadece DAWN hesabında kullanılır.

### 4.4 Concurrency

Her odanın `serialQueue: Promise<void>` alanı var; tüm event handler'ları:
```ts
room.serialQueue = room.serialQueue.then(() => handler());
```
Bu, iki vampirin aynı anda farklı target göndermesini sıraya sokar; race condition olmaz.

### 4.5 Rol mimarisi (Strategy + Registry)

```ts
interface RoleStrategy {
  id: RoleId;
  team: Team;
  nightOrder: number | null;
  promptFor?(player, room): PendingActionPrompt | null;
  applyNight?(action, room, ctx: NightCtx): void;
  onDeath?(player, room): void;
  // winCondition global olarak köy/vampir parite kontrolünde
}
const RoleRegistry = new Map<RoleId, RoleStrategy>();
```

Yeni rol (post-MVP: Aşık, Cadı, Soytarı): yeni `RoleStrategy` dosyası + registry kaydı. Engine'e dokunmadan eklenebilir.

### 4.6 Persistence

```ts
setInterval(() => {
  const snapshot = JSON.stringify({ rooms: serialize(roomMap), sessions: ... });
  fs.writeFileSync('/data/snapshot.json.tmp', snapshot, { mode: 0o600 });
  fs.renameSync('/data/snapshot.json.tmp', '/data/snapshot.json'); // atomik
}, 30_000);
```

Boot'ta `/data/snapshot.json` varsa load et, timer'ları `phaseEndsAt - now` farkıyla yeniden kur. `phaseEndsAt < now` ise hemen `transition()`.

`GAME_OVER`'dan 1 dk sonra oda silinir, snapshot'tan da düşer.

---

## 5. Frontend Detayı

### 5.1 Ekran haritası

| Route | Amaç |
|---|---|
| `/` | Hero + Oluştur / Katıl / Nasıl oynanır |
| `/create` | Host adı + preset seç |
| `/join` | Kod + ad + avatar emoji |
| `/room/[code]/lobby` | Kod, QR, oyuncu listesi, hazır, host'a rol set sliderı, "Başlat" |
| `/room/[code]/role` | **Long-press** rol kartı reveal, fullscreen API, 5 sn auto-kapan |
| `/room/[code]/night` | Role-bazlı sub-view (vampir hedef seçim ortak, doktor koru, gözcü sorgula, köylü uyu) |
| `/room/[code]/announcement` | Sinematik geçiş + ölüm anonsu |
| `/room/[code]/day` | Yaşayan grid + olay günlüğü + "oylamaya geç" |
| `/room/[code]/vote` | Kart grid + 1 sn delay'li kilit |
| `/room/[code]/graveyard` | Ölü için pasif spectator (mum animasyonu, mezar grid) |
| `/room/[code]/end` | Kazanan teması, rol reveal kart-flip, audit log, "tekrar oyna" |

### 5.2 Tema

- Renk: `night.deep #0B0B14`, `night.indigo #131329`, `blood.crimson #8B0010`, `moon.silver #D4D4E5`, `moon.gold #C9A65E`, `candle.flame #F2A65A`.
- Font: **Cinzel** (başlık, gotik serif), **Inter** (body), `IM Fell English` (anons satırları).
- Animasyon: `transition:fly`, `crossfade`, kan damlası SVG `@keyframes drip`, sis `noise.svg` overlay translate3d, mum titreşimi `flicker`, ay yükselişi gece fazında.
- Ses: opsiyonel `howler.js`, default **mute**, lobide ilk tıkla autoplay unlock.

### 5.3 Mobil kritik noktalar

- **Long-press rol reveal** + fullscreen API + 5 sn auto-kapan.
- Tap target ≥ 56×56 px, kart aralığı 12 px.
- `navigator.vibrate(15)` haptic.
- `visibilitychange === 'visible'` event'inde **zorla** Socket.IO reconnect → server `state:full` yollar.
- `navigator.wakeLock.request('screen')` — gece ekranında opsiyonel toggle.
- Notification API (PWA) — sekme arka plandayken faz başlangıcı bildirimi.
- `viewport-fit=cover` + `env(safe-area-inset-*)` iPhone notch için.
- `touch-action: manipulation` 300 ms tap delay yok.
- `user-select: none` rol kartında.

### 5.4 State

- Tek doğruluk kaynağı: server'dan gelen `ClientStateView`.
- Svelte 5 runes (`$state`, `$derived`) — Redux/Zustand YOK.
- **Optimistic update YOK** (lobi "hazırım" toggle hariç). Oylama, gece aksiyonu için server ack beklenir, "kilitleniyor…" spinner gösterilir.
- Local sayım: `endsAt - now` interval; faz değişimi server'dan gelir, lokal asla kendi başına faz değiştirmez.
- `playerId` + `sessionToken` httpOnly cookie + localStorage'da (refresh güvenli).

### 5.5 Reconnect

- Socket.IO `connection_recovery` etkin → tarayıcı kısa kopmalarda kaldığı yerden devam eder.
- Uzun kopmada client `state:full` ile resync olur.
- Telefon ekran kilidi sonrası `visibilitychange` ile zorla yeniden bağlan.

---

## 6. Deployment

### 6.1 Platform: Fly.io (Frankfurt)

`fly.toml`:
```toml
app = "vampir-koylu"
primary_region = "fra"

[build]

[env]
  NODE_ENV = "production"
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0   # yılbaşı gecesi 1 yapılır

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256

[mounts]
  source = "vampir_data"
  destination = "/data"      # snapshot.json için 1 GB volume
```

### 6.2 Dockerfile

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter shared build && pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/build ./build
COPY --from=build /app/apps/web/server.ts ./server.ts
COPY --from=build /app/apps/web/package.json ./
EXPOSE 8080
CMD ["node", "server.js"]
```

### 6.3 Yılbaşı gecesi check-list

1. 31 Aralık öğleden önce son `fly deploy`.
2. `fly volumes create vampir_data --size 1 --region fra` (bir kez).
3. `fly secrets set SESSION_SECRET=$(openssl rand -hex 32) ADMIN_TOKEN=$(openssl rand -hex 16)`.
4. `fly scale count 1` ve `fly machine update <id> --autostop=false`.
5. WhatsApp grubuna `https://vampir-koylu.fly.dev` linkini at.
6. `fly logs -f` açık tut.
7. Oyundan sonra `fly scale count 0` → ay sonu $0.

### 6.4 Maliyet

| Senaryo | Maliyet |
|---|---|
| Yılbaşı gecesi (4–6 saat) | **$0** (free tier) |
| 24/7 ayakta | $0–$2/ay (auto-stop ile) |
| 50+ oyuncu, 5–10 oda | $5–10/ay (1 GB RAM upgrade) |

### 6.5 Yedek plan

Fly.io ile sorun çıkarsa: aynı `Dockerfile` ile **Railway**'e geç. GitHub repo bağla, env'leri kopyala, `*.up.railway.app` URL'sini paylaş. Trial credit yılbaşı için yeter.

### 6.6 Local geliştirme

Root `package.json`:
```json
{
  "scripts": {
    "dev": "pnpm --filter web dev",
    "build": "pnpm -r build",
    "start": "pnpm --filter web start"
  }
}
```

`apps/web/server.ts` Vite middleware'i sarar; `pnpm dev` tek komutla hem UI hem Socket.IO'yu http://localhost:5173'te ayağa kaldırır. WebSocket aynı port'tan upgrade olur.

---

## 7. MVP Kapsam Tanımı (Acceptance Criteria)

### Yapılacaklar (MVP)
1. Lobi: oda kodu üretme/katılma, QR, hazır toggle, host'a preset seçimi.
2. 5 rol (Köylü, Vampir, Doktor, Gözcü, Avcı) çalışan engine.
3. Tam state machine: `LOBBY → ROLE_REVEAL → NIGHT → DAWN → DAY → VOTE → EXECUTION → loop|GAME_OVER`.
4. Tam otomatik bot moderasyon + host'un istisna butonları (audit log'lu).
5. Rol gizliliği (server projeksiyonu, kod review kuralı).
6. Vampir koordinasyonu (müzakere + lider tie-break).
7. Açık oylama + 1 kez tie-break.
8. Mezarlık modu (pasif spectator).
9. Reconnect + AFK pas-tercihi.
10. Snapshot ile restart sağkalımı.
11. Oyun sonu özet (kazanan + tüm roller + oyun günlüğü + audit log).
12. Vampire teması (Cinzel + koyu palet + sis/kan damlası animasyonları).
13. Mobile-first, long-press rol reveal, fullscreen API.
14. PWA manifest (install prompt yok, sadece "ana ekrana ekle" çalışır).
15. Tek container Fly.io deploy.

### MVP Dışı (post-MVP / v1.1+)
- Aşık (Cupid), Cadı, Soytarı, Muhafız, Vampir Lideri rolleri.
- Anonim oylama seçeneği.
- Spectator chat (mezarlıkta ölüler arası).
- Ses efektleri.
- Reaction emojileri.
- Sesli görüşme entegrasyonu.
- i18n (sadece TR).
- İstatistik / oyun geçmişi.
- Wake Lock + Notification opt-in.
- "Tekrar oyna" aynı odada role rotasyonu.

### Acceptance kriterleri
- [ ] 6 oyunculu bir el, host dahil, başından sonuna **hilesiz** oynanabilir.
- [ ] Hiçbir oyuncu kendi rolü dışında bilgiyi DevTools/Network/console üzerinden göremez (manual security test).
- [ ] Bir oyuncu ortada bağlantıyı kaybederse oyun donmaz, faz timer'ı doğru ilerler.
- [ ] Telefon kilitlenip ekran açılınca state otomatik resync olur (refresh yok).
- [ ] Long-press rol kartı yan kullanıcı tarafından okunamayacak hızda kapanır.
- [ ] Oyun sonunda tüm roller, ölüm sebepleri, host müdahale logu doğru gösterilir.
- [ ] Fly.io'ya `fly deploy` ile tek komut deploy başarılı olur.

---

## 8. Uygulama Sırası (önerilen sprint planı, takvimsiz)

1. **Iskele**: Monorepo, SvelteKit + Tailwind + Socket.IO + custom server.ts, `packages/shared` ile zod schemaları, "hello world" Socket.IO bağlantısı.
2. **Domain & Engine**: `Room`, `Player`, `RoleStrategy`, state machine `transition()`, `projectFor()`, `RoleRegistry`'ye 5 rol kaydı, NightResolver.
3. **Lobby**: oda oluştur/katıl REST + Socket.IO, oyuncu listesi, hazır toggle, host preset seçimi, "Başlat" → ROLE_REVEAL.
4. **Gece + Gündüz + Oylama UI'leri**: role-bazlı sub-view'lar, long-press rol kartı, vampir koordinasyonu UI'si, doktor/gözcü prompt'ları, oylama kart grid + kilit.
5. **Anons & End ekranları**: sinematik faz geçişleri, ölüm anonsu, oyun sonu reveal, audit log.
6. **Reconnect + Snapshot**: visibility-aware reconnect, /data snapshot, restart load.
7. **Tema cilası**: Cinzel/Inter font load, palet, sis/kan damlası/mum animasyonları, mobil tap targets, fullscreen API.
8. **Deploy**: Dockerfile + fly.toml + secret'lar + smoke test (tarayıcıdan 6 sekmeyle bir el).
9. **Manuel test takımı**: 5–6 arkadaşla bir genel prova; bulunan hataları düzelt.
10. **Yılbaşı çalıştırma**: scale=1, autostop=off, link paylaş, `fly logs -f`.

Risk ve azaltıcılar:
- **Risk**: Socket.IO reconnect davranışı iOS Safari'de beklendiği gibi olmayabilir → mitigasyon: `visibilitychange` ile manual reconnect handler.
- **Risk**: Long-press rol kartı UI'sinde "ekran görüntüsü" alınması engellenemez → mitigasyon: kullanıcıya "yan kullanıcı görmeden bak" sosyal kuralı + fullscreen + 5 sn auto-kapan.
- **Risk**: Snapshot/restore sırasında Socket.IO instance'ları gitmiş olur, clientlar reconnect olmalı → mitigasyon: client'ta `connect_error` ve `disconnect` listener'ı ile otomatik retry.
- **Risk**: Fly.io free tier'da volume kotası → mitigasyon: 1 GB volume + snapshot dosyası 1 MB altında, sorun yok.
- **Risk**: Ev WiFi'sinde NAT + IPv6 sorunu → mitigasyon: Socket.IO long-polling fallback'i otomatik.

---

## 9. Sonuç

Dört ajanlı tartışmanın sonucunda, **SvelteKit + Socket.IO + tek-Node-süreç + Fly.io** üzerine kurulu bir mimari seçildi. Oyun tarafında **tam otomatik bot moderasyon + 5 rollü "Türk usulü" set + açık oylama** kararlaştırıldı. Tüm gizli bilgilerin server tarafında `projectFor()` projeksiyonundan geçmesi anti-cheat'in tek noktası olarak konumlandırıldı. Mobil deneyim için **long-press rol reveal + visibility-aware reconnect + PWA manifest** birinci sınıf vatandaş.

Tasarım, yılbaşı gecesi tek bir komutla ($0 maliyetle) yayında olabilecek; iş ileride büyürse **Cloudflare Durable Objects** veya **Redis adapter** ile sancısızca ölçeklenebilecek şekilde modüler bırakıldı. MVP yukarıda tanımlı 15 maddeyle sınırlı; geri kalan tüm "güzel olur" özellikler v1.1+ roadmap'ine itildi.

İmplementasyona geçme kararı verirsen iskeletten başlayıp sırayla kurabiliriz.
