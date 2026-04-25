# Traitors — Frontend Architecture & UI/UX Design Specification

> A web-based Werewolf (Vampir Köylü / Mafia) game management tool.
> Version 1.0 · Design Spec

---

## Table of Contents

1. [Framework Choice](#1-framework-choice)
2. [CSS/Styling Strategy](#2-cssstyling-strategy)
3. [State Management](#3-state-management)
4. [Component Architecture](#4-component-architecture)
5. [Screen/View Design](#5-screenview-design)
6. [Moderator vs Player View](#6-moderator-vs-player-view)
7. [Mobile-First Responsive Design](#7-mobile-first-responsive-design)
8. [Animations and Polish](#8-animations-and-polish)
9. [Accessibility](#9-accessibility)
10. [Dark Theme / Atmospheric Design](#10-dark-theme--atmospheric-design)

---

## 1. Framework Choice

### Recommendation: **Preact + Preact Signals**

#### Why Preact over the alternatives

| Criterion | Preact | React | Vue | Svelte |
|---|---|---|---|---|
| Bundle size | **~3 KB** gzipped | ~42 KB | ~33 KB | ~2 KB (but grows with components) |
| React ecosystem compat | ✅ via `preact/compat` | Native | ❌ | ❌ |
| Learning curve for contributors | Low (React API) | Low | Medium | Medium |
| Mobile perf on low-end phones | Excellent | Good | Good | Excellent |
| SSR story | Adequate | Excellent | Excellent | Excellent |
| Real-time update efficiency | Excellent (Signals) | Good (needs optimization) | Good | Excellent |

**The decisive factors for this project:**

1. **Bundle size matters enormously.** Players are on phones, possibly on cellular data at a party. Every KB counts. Preact delivers the React mental model at 1/14th the size.

2. **Preact Signals** provide fine-grained reactivity without the boilerplate of Redux/Zustand or React's `useSyncExternalStore`. When a WebSocket message updates a single player's status, only the component rendering that player re-renders — no diffing the entire tree. This is critical for a real-time game where state changes are frequent and granular.

3. **React ecosystem compatibility** means we can use battle-tested libraries (Framer Motion via `preact/compat`, React Router, etc.) if needed, while maintaining the small footprint.

4. **Not Svelte** because while Svelte is excellent, the React/Preact ecosystem is larger, hiring/contribution is easier, and the compile-step magic of Svelte can produce surprising bundle growth in component-heavy apps.

5. **Not Vue** because Vue's reactivity system, while excellent, doesn't justify the bundle cost over Preact Signals, and the ecosystem split between Options API and Composition API creates unnecessary decision overhead.

#### Build Tool: **Vite**

- Sub-second HMR
- Native ESM dev server
- Optimized production builds with Rollup
- First-class Preact support via `@preact/preset-vite`

#### TypeScript: **Yes, strict mode**

Game state is complex (roles, phases, voting, targeting). Type safety prevents entire categories of bugs and serves as living documentation.

```
preact@10.x
@preact/signals@1.x
vite@5.x
typescript@5.x
```

---

## 2. CSS/Styling Strategy

### Recommendation: **Tailwind CSS v4 + CSS custom properties for theming**

#### Why Tailwind

1. **Mobile-first by default.** Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`) enforce mobile-first thinking. You write styles for mobile, then layer on larger screens.

2. **Rapid iteration.** In a game UI, you're constantly tweaking spacing, colors, and layout. Collocating styles in markup eliminates context-switching between files.

3. **Purging works perfectly.** Production CSS is tiny — typically 8–15 KB gzipped for an entire app.

4. **Consistency without effort.** The spacing scale, color palette, and typography scale enforce visual consistency automatically.

5. **No runtime cost.** Unlike styled-components or Emotion, there is zero JavaScript overhead for styling.

#### Why NOT CSS Modules or styled-components

- **CSS Modules**: Excellent for isolation, but no design system enforcement. You end up writing `padding: 12px` in one place and `padding: 16px` in another. Requires discipline that a utility system gives you for free.
- **styled-components/Emotion**: Runtime cost is unacceptable for a mobile-first, performance-sensitive app. CSS-in-JS libraries add 8–15 KB to the bundle and generate styles at runtime.

#### Custom Properties for Dynamic Theming

Tailwind handles the static design system. CSS custom properties handle the dynamic, atmospheric layer — phase-based theming (night vs day), role-specific color accents, and animation timing.

```css
:root {
  /* Phase-driven properties — toggled via data attributes */
  --phase-bg: var(--color-night-bg);
  --phase-text: var(--color-night-text);
  --phase-accent: var(--color-night-accent);
  --phase-glow: var(--color-night-glow);
}

[data-phase="day"] {
  --phase-bg: var(--color-day-bg);
  --phase-text: var(--color-day-text);
  --phase-accent: var(--color-day-accent);
  --phase-glow: var(--color-day-glow);
}
```

#### File Organization

```
src/
  styles/
    tailwind.css          # Tailwind directives + custom utilities
    theme.css             # CSS custom properties (full palette)
    animations.css        # @keyframes definitions
```

---

## 3. State Management

### Recommendation: **Preact Signals + a thin WebSocket sync layer**

#### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  WebSocket Server                │
│         (authoritative game state)               │
└──────────────────┬──────────────────────────────┘
                   │ JSON messages
                   ▼
┌─────────────────────────────────────────────────┐
│            WebSocketManager (singleton)          │
│  - Connection lifecycle                          │
│  - Reconnection with exponential backoff         │
│  - Message routing                               │
│  - Heartbeat / ping-pong                         │
└──────────────────┬──────────────────────────────┘
                   │ dispatches to
                   ▼
┌─────────────────────────────────────────────────┐
│              GameStore (Signals)                  │
│                                                  │
│  gamePhase: Signal<Phase>                        │
│  players: Signal<Player[]>                       │
│  myRole: Signal<Role | null>                     │
│  votes: Signal<Map<string, string>>              │
│  timer: Signal<number>                           │
│  nightActions: Signal<NightAction[]>  (mod only) │
│  chatMessages: Signal<ChatMessage[]>             │
│  isAlive: Signal<boolean>                        │
│  moderatorView: Signal<boolean>                  │
│  pendingAction: Signal<PendingAction | null>     │
└──────────────────┬──────────────────────────────┘
                   │ consumed by
                   ▼
┌─────────────────────────────────────────────────┐
│              Preact Components                   │
│  (auto-subscribe via .value access)              │
└─────────────────────────────────────────────────┘
```

#### Key Design Decisions

**1. Server is authoritative.** The client never mutates game state directly. All actions (vote, target, accuse) send a message to the server. The server validates and broadcasts the new state. The client applies the received state. This prevents cheating and ensures consistency.

**2. Optimistic UI for non-critical actions.** Chat messages appear instantly with a "pending" indicator. Votes show a local preview with a subtle loading state until server confirmation.

**3. Signals for fine-grained reactivity.** When the server sends `{ type: "PLAYER_ELIMINATED", playerId: "p3" }`, only the signal containing the players array updates, and only components reading that specific player re-render. No provider trees, no selector functions, no `memo()` wrappers.

**4. Computed signals for derived state.**

```typescript
const alivePlayerCount = computed(() =>
  players.value.filter(p => p.isAlive).length
);

const canVote = computed(() =>
  gamePhase.value === 'day-vote' && isAlive.value
);

const isMyTurn = computed(() => {
  if (gamePhase.value !== 'night') return false;
  const role = myRole.value;
  return nightActions.value.some(a => a.role === role && !a.completed);
});
```

**5. Reconnection strategy.**

```
Attempt 1: immediate
Attempt 2: 1s delay
Attempt 3: 2s delay
Attempt 4: 4s delay
Attempt 5+: 8s delay (cap)

On reconnect:
  → Send { type: "REJOIN", gameId, playerId, lastSeqNum }
  → Server responds with full state snapshot
  → Client replaces all signals atomically using batch()
```

#### WebSocket Message Protocol (Client-relevant subset)

```typescript
// Server → Client
type ServerMessage =
  | { type: 'STATE_SNAPSHOT'; state: FullGameState }
  | { type: 'PHASE_CHANGE'; phase: Phase; timer?: number }
  | { type: 'PLAYER_ELIMINATED'; playerId: string; role?: Role }
  | { type: 'VOTE_CAST'; voterId: string; targetId: string }
  | { type: 'VOTE_RESULT'; eliminatedId: string | null; tally: VoteTally }
  | { type: 'ROLE_ASSIGNED'; role: Role }
  | { type: 'NIGHT_ACTION_PROMPT'; action: NightActionType }
  | { type: 'NIGHT_RESULT'; result: NightResult }
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'TIMER_TICK'; remaining: number }
  | { type: 'GAME_OVER'; winner: Team; roles: PlayerRole[] }
  | { type: 'ERROR'; code: string; message: string };

// Client → Server
type ClientMessage =
  | { type: 'JOIN_GAME'; gameId: string; playerName: string }
  | { type: 'START_GAME' }  // moderator only
  | { type: 'CAST_VOTE'; targetId: string }
  | { type: 'NIGHT_ACTION'; targetId: string }
  | { type: 'SKIP_ACTION' }
  | { type: 'SEND_CHAT'; text: string }
  | { type: 'ADVANCE_PHASE' }  // moderator only
  | { type: 'REJOIN'; gameId: string; playerId: string; lastSeqNum: number };
```

#### Local-only UI State

Not everything goes through signals. Ephemeral UI state lives in component-local `useState`:

- Modal open/close states
- Tooltip visibility
- Animation trigger flags
- Form input values (pre-submit)
- Scroll positions

---

## 4. Component Architecture

### Component Tree

```
<App>
├── <ConnectionStatus />          # WebSocket connection indicator
├── <Router>
│   ├── <LobbyScreen />
│   │   ├── <GameCodeDisplay />
│   │   ├── <PlayerList />
│   │   │   └── <PlayerAvatar />  (×N)
│   │   ├── <RoleConfig />        (moderator only)
│   │   └── <StartButton />       (moderator only)
│   │
│   ├── <GameScreen />
│   │   ├── <PhaseHeader />
│   │   │   ├── <PhaseIndicator />
│   │   │   ├── <Timer />
│   │   │   └── <DayNightToggle /> (visual only)
│   │   │
│   │   ├── <PlayerCircle />       # circular arrangement of players
│   │   │   └── <PlayerCard />     (×N)
│   │   │       ├── <Avatar />
│   │   │       ├── <RoleBadge />  (conditional)
│   │   │       ├── <VoteIndicator />
│   │   │       └── <DeathMarker />
│   │   │
│   │   ├── <ActionPanel />        # bottom sheet on mobile
│   │   │   ├── <VotePanel />
│   │   │   ├── <NightActionPanel />
│   │   │   ├── <DiscussionPanel />
│   │   │   └── <SpectatorPanel />
│   │   │
│   │   ├── <ModeratorOverlay />   (moderator only)
│   │   │   ├── <AllRolesView />
│   │   │   ├── <NightActionQueue />
│   │   │   ├── <PhaseControls />
│   │   │   └── <GameLog />
│   │   │
│   │   ├── <ChatDrawer />
│   │   └── <EventToast />         # eliminations, reveals
│   │
│   ├── <ResultsScreen />
│   │   ├── <WinnerBanner />
│   │   ├── <RoleReveal />
│   │   │   └── <RevealCard />     (×N)
│   │   ├── <GameStats />
│   │   └── <PlayAgainButton />
│   │
│   └── <HomeScreen />
│       ├── <CreateGameButton />
│       ├── <JoinGameForm />
│       └── <RulesModal />
│
├── <PhaseTransitionOverlay />     # full-screen phase change animation
└── <AudioManager />               # ambient + SFX (mutable)
```

### Data Flow Principles

1. **Unidirectional.** Signals flow down. Actions flow up (via WebSocket sends).
2. **No prop drilling deeper than 2 levels.** If a deeply nested component needs game state, it reads the signal directly. Signals are module-scoped singletons, not passed through props.
3. **Props for configuration, signals for state.** A `<PlayerCard>` receives `playerId` as a prop and reads `players.value.find(p => p.id === playerId)` internally.
4. **Events bubble via callbacks for UI actions.** `<PlayerCard onClick={() => selectTarget(playerId)} />` — the parent handles the action logic.

### Key Type Definitions

```typescript
type Phase =
  | 'lobby'
  | 'night'
  | 'day-discussion'
  | 'day-vote'
  | 'vote-result'
  | 'game-over';

type Role =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'doctor'
  | 'hunter'
  | 'witch'
  | 'bodyguard'
  | 'cupid'
  | 'custom';

type Team = 'village' | 'werewolf';

interface Player {
  id: string;
  name: string;
  avatar: AvatarConfig;
  isAlive: boolean;
  isModerator: boolean;
  isConnected: boolean;
  role?: Role;           // only visible to self (or mod, or post-game)
  voteTarget?: string;   // during voting phase
  eliminated?: {
    phase: number;       // which round
    by: 'vote' | 'werewolf' | 'hunter' | 'witch';
  };
}

interface AvatarConfig {
  seed: string;          // for deterministic generation
  backgroundColor: string;
}
```

---

## 5. Screen/View Design

### Screen Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│   Home   │────▶│  Lobby   │────▶│   Game   │────▶│ Results  │
│  Screen  │     │  Screen  │     │  Screen  │     │  Screen  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                      │                                   │
                      ◀──────────────────────────────────┘
                              "Play Again"
```

---

### 5.1 Home Screen

**URL:** `/`

**Purpose:** Entry point. Create or join a game.

**What the user sees:**

A full-screen dark background with a subtle fog/mist animation drifting across the bottom third. The "Traitors" logo is centered in the upper third — stylized, with a wolf silhouette integrated into the typography. Below the logo, a tagline: *"Trust no one."*

Two primary actions are centered vertically:

```
┌─────────────────────────────────┐
│                                 │
│         🐺 TRAITORS             │
│        "Trust no one."          │
│                                 │
│   ┌───────────────────────┐     │
│   │    Create Game         │     │
│   └───────────────────────┘     │
│                                 │
│   ┌───────────────────────────┐ │
│   │  Enter game code...       │ │
│   │  [JOIN]                   │ │
│   └───────────────────────────┘ │
│                                 │
│        How to Play →            │
│                                 │
└─────────────────────────────────┘
```

**Interactive elements:**

- **"Create Game" button** — Full-width (mobile), max 360px (desktop). `bg-red-700 hover:bg-red-600`. Navigates to lobby as moderator.
- **Join form** — Game code input (6 uppercase characters, monospace font, letter-spaced). Auto-uppercases. The input has a `border-b-2 border-stone-600 focus:border-red-500` underline style — no box border.
- **"How to Play" link** — Opens a bottom sheet (mobile) or modal (desktop) with illustrated rules.

**Responsive behavior:**
- Mobile: Full-bleed, vertically centered content, 24px horizontal padding.
- Tablet+: Content card centered, max-width 480px, with a subtle `backdrop-blur` frosted glass effect.

---

### 5.2 Lobby Screen

**URL:** `/game/:gameId`

**Purpose:** Waiting room. Players join, moderator configures roles, everyone sees who's in.

**What the user sees:**

```
┌─────────────────────────────────────┐
│  ← Back            Game: XK7M2Q    │
│─────────────────────────────────────│
│                                     │
│  Players (5/12)                     │
│                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐          │
│  │ 😺  │ │ 🦊  │ │ 🐻  │          │
│  │Ali  │ │Berk │ │Can  │          │
│  │ ★   │ │     │ │     │          │
│  └─────┘ └─────┘ └─────┘          │
│  ┌─────┐ ┌─────┐ ┌ ─ ─ ┐          │
│  │ 🐰  │ │ 🦉  │ │     │          │
│  │Deniz│ │Ece  │ │ +   │          │
│  │     │ │     │ │     │          │
│  └─────┘ └─────┘ └ ─ ─ ┘          │
│                                     │
│──── Moderator Section ──────────── │
│  Role Setup:                        │
│  Werewolves: [2] [−][+]            │
│  Seer:       [✓]                   │
│  Doctor:     [✓]                   │
│  Hunter:     [✗]                   │
│  Witch:      [✗]                   │
│  Bodyguard:  [✗]                   │
│                                     │
│  ┌───────────────────────────┐     │
│  │    ▶ Start Game            │     │
│  └───────────────────────────┘     │
│                                     │
│  Share: [Copy Link] [QR Code]      │
└─────────────────────────────────────┘
```

**What each user sees:**

- **All players** see the player grid, game code, and share options.
- **Moderator** additionally sees the Role Setup section and Start Game button.
- **Non-moderator players** see a "Waiting for moderator to start..." message with a pulsing dot animation where the role setup would be.

**Interactive elements:**

- **Game code** — Tappable to copy. Shows a brief "Copied!" toast.
- **Player avatars** — Generated deterministically from player name using DiceBear Avatars (bottts or adventurer style). Each has a colored background ring.
- **Moderator star (★)** — Displayed below the moderator's avatar.
- **"+" placeholder** — Dashed border card indicating open slots. Shows a subtle pulse animation.
- **Role toggles** — Switch components for optional roles. Werewolf count is a stepper (min 1, max = players/3).
- **Start Game button** — Disabled until minimum player count (5) is reached. Disabled state: `opacity-40 cursor-not-allowed`. Enabled: `bg-red-700` with a subtle glow animation.
- **Share options** — "Copy Link" copies the join URL. "QR Code" displays a QR code in a modal for in-person games.

**Real-time updates:**

- When a new player joins, their avatar card animates in with a `scale(0) → scale(1)` spring animation and a soft chime sound.
- When a player disconnects, their avatar dims to 40% opacity with a wifi-off icon overlay.
- Player count updates instantly.

---

### 5.3 Game Screen — Night Phase

**URL:** `/game/:gameId` (same URL, different state)

**Purpose:** Werewolves choose a target. Special roles act.

**What the user sees (as a Villager):**

```
┌─────────────────────────────────────┐
│           🌙 Night                  │
│       "Close your eyes..."          │
│         ━━━━━━━━━━ 0:42             │
│─────────────────────────────────────│
│                                     │
│            (dark overlay)           │
│                                     │
│      The village sleeps.            │
│      Wait for dawn...              │
│                                     │
│        💤  💤  💤                    │
│                                     │
│─────────────────────────────────────│
│  [💬 Chat]                          │
└─────────────────────────────────────┘
```

Villagers see almost nothing during night — this is intentional. The screen goes very dark (near-black), with only the phase indicator, a thematic message, and sleeping emojis. Chat is disabled during night for non-werewolf roles (if using digital chat).

**What the user sees (as a Werewolf):**

```
┌─────────────────────────────────────┐
│           🌙 Night                  │
│    "Choose your victim..."          │
│         ━━━━━━━━━━ 0:42             │
│─────────────────────────────────────│
│                                     │
│      ┌───┐ ┌───┐ ┌───┐            │
│      │Ali│ │Can│ │Den│            │
│      │ ✓ │ │   │ │   │            │
│      └───┘ └───┘ └───┘            │
│      ┌───┐ ┌───┐                   │
│      │Ece│ │Far│                   │
│      │   │ │   │                   │
│      └───┘ └───┘                   │
│                                     │
│─────────────────────────── ─────── │
│  ┌─────────────────────────────┐   │
│  │    🐺 Confirm Kill           │   │
│  └─────────────────────────────┘   │
│                                     │
│  [🐺 Wolf Chat]                    │
└─────────────────────────────────────┘
```

Werewolves see only alive non-werewolf players. They can tap to select a target (red border highlight). The "Confirm Kill" button activates only after selection.

**What the user sees (as Seer):**

Similar to werewolf view, but prompt says "Choose someone to investigate..." and the action button says "🔮 Reveal Role". After selecting and confirming, a dramatic card-flip animation reveals the target's alignment (Village / Werewolf) — not the specific role.

**What the user sees (as Doctor):**

Prompt: "Choose someone to protect..." — can select any alive player including themselves (once per game for self). Action: "🛡️ Protect".

---

### 5.4 Game Screen — Day Discussion Phase

**URL:** `/game/:gameId`

**Purpose:** Players discuss, accuse, and argue.

**What the user sees:**

```
┌─────────────────────────────────────┐
│           ☀️ Day 2                   │
│      "Who among you is a traitor?"  │
│         ━━━━━━━━━━ 2:15             │
│─────────────────────────────────────│
│                                     │
│  ┌───────────── ALERT ────────────┐ │
│  │  💀 Can was found dead.        │ │
│  │  The village mourns.           │ │
│  └────────────────────────────────┘ │
│                                     │
│   ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐   │
│   │Al│  │Be│  │XX│  │De│  │Ec│   │
│   └──┘  └──┘  └──┘  └──┘  └──┘   │
│                ╱╲                   │
│              (dead)                 │
│                                     │
│─────────────────────────────────────│
│  Action Panel (bottom sheet)       │
│  ┌─────────────────────────────┐   │
│  │  Accusation: Tap a player   │   │
│  │  to accuse them              │   │
│  └─────────────────────────────┘   │
│                                     │
│  [💬 Chat]   [📋 Log]             │
└─────────────────────────────────────┘
```

**Key elements:**

- **Death announcement** — If someone died during the night, an alert banner slides down from the top with a skull icon. The dead player's card in the circle gets an X overlay with a cross-fade to grayscale.
- **Player circle** — All players displayed. Dead players are grayed out with a skull overlay. Alive players are tappable.
- **Timer** — Configurable discussion time. Progress bar drains from left to right. Last 30 seconds: bar turns red and pulses.
- **Accusation** — Tapping an alive player during discussion creates an accusation. If seconded (another player taps the same player), it triggers a vote phase for that player.

**Real-time updates:**

- Accusations appear as speech-bubble indicators above the accused player's avatar.
- When two players accuse the same person, a dramatic "ACCUSATION" banner slides in, the accused player's card pulses red, and the phase transitions to voting.

---

### 5.5 Game Screen — Voting Phase

```
┌─────────────────────────────────────┐
│         ⚖️ Vote                     │
│   "Should Ali be eliminated?"       │
│         ━━━━━━━━━━ 0:30             │
│─────────────────────────────────────│
│                                     │
│         ┌────────────┐              │
│         │    Ali      │              │
│         │   (accused) │              │
│         │    😺       │              │
│         └────────────┘              │
│                                     │
│  ┌──────────────┐ ┌──────────────┐ │
│  │               │ │               │ │
│  │   👍 GUILTY   │ │  👎 INNOCENT  │ │
│  │               │ │               │ │
│  │  bg-red-700   │ │  bg-stone-700│ │
│  └──────────────┘ └──────────────┘ │
│                                     │
│  Votes: 3/7 cast                   │
│  ████████░░░░░░░░                  │
│                                     │
│  [💬 Chat]                          │
└─────────────────────────────────────┘
```

**Interactive elements:**

- **GUILTY / INNOCENT buttons** — Large, tappable (min 48px height). Once tapped, your choice locks in with a checkmark. You cannot change your vote.
- **Vote progress bar** — Shows how many votes are in without revealing the tally. Fills up as votes arrive.
- **After all votes:** A dramatic tally animation counts up the guilty vs innocent votes. If guilty wins, the player is eliminated with a death animation.

**What information is hidden:**

- Individual vote choices are hidden during voting.
- The tally is only revealed after all votes are cast (or timer expires).
- Moderator can see individual votes in real-time via the moderator overlay.

---

### 5.6 Game Screen — Vote Result

```
┌─────────────────────────────────────┐
│                                     │
│        ⚖️ The Village Has Spoken    │
│                                     │
│         Guilty: 5                   │
│         Innocent: 2                 │
│                                     │
│         ┌────────────┐              │
│         │    Ali      │              │
│         │   💀        │              │
│         │ ELIMINATED  │              │
│         └────────────┘              │
│                                     │
│   "Ali was a... Villager."          │
│   (role card flips dramatically)    │
│                                     │
│                                     │
│  ┌───────────────────────────┐     │
│  │    Continue →              │     │ (moderator only)
│  └───────────────────────────┘     │
│                                     │
└─────────────────────────────────────┘
```

The vote result screen is highly dramatic. The vote counts animate in one by one. The elimination is announced. The eliminated player's role card flips with a 3D CSS transform, revealing their true role.

---

### 5.7 Results Screen

**URL:** `/game/:gameId/results`

**Purpose:** Post-game summary. Reveals all roles. Shows game stats.

```
┌─────────────────────────────────────┐
│                                     │
│    🐺 WEREWOLVES WIN 🐺             │
│    "The village has fallen."        │
│                                     │
│─────── Role Reveal ─────────────── │
│                                     │
│  ┌─────┐ ┌─────┐ ┌─────┐          │
│  │Ali  │ │Berk │ │Can  │          │
│  │🐺   │ │🏘️   │ │🔮   │          │
│  │Were │ │Vill │ │Seer │          │
│  │ALIVE│ │ALIVE│ │DEAD │          │
│  └─────┘ └─────┘ └─────┘          │
│  ┌─────┐ ┌─────┐ ┌─────┐          │
│  │Deniz│ │Ece  │ │Fatih│          │
│  │🏘️   │ │🐺   │ │🏥   │          │
│  │Vill │ │Were │ │Doc  │          │
│  │DEAD │ │ALIVE│ │DEAD │          │
│  └─────┘ └─────┘ └─────┘          │
│                                     │
│──── Game Timeline ──────────────── │
│  Night 1: Can (Seer) investigated  │
│           Ali → Werewolf 🔴        │
│  Night 1: Werewolves killed Fatih  │
│  Day 1:   Deniz eliminated (Vill.) │
│  Night 2: Werewolves killed Can    │
│  Day 2:   No elimination           │
│  Night 3: Werewolves killed Berk   │
│  ▸ Werewolves outnumber village    │
│                                     │
│  ┌───────────────────────────┐     │
│  │    🔄 Play Again           │     │
│  └───────────────────────────┘     │
│                                     │
└─────────────────────────────────────┘
```

**Animations:**

- Role cards flip one by one with staggered timing (200ms delay between each).
- Winner banner has a dramatic entrance: scale from 0 to 1 with a glow effect.
- Game timeline entries animate in sequentially as the user scrolls.

---

## 6. Moderator vs Player View

### Design Philosophy

The moderator is a player first, with a toggleable overlay for moderator duties. This is implemented as a **persistent floating action button (FAB)** that opens a **slide-up panel**.

### How it works

```
┌─────────────────────────────────────┐
│         Normal Player View          │
│         (what everyone sees)        │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
│                          ┌───┐      │
│                          │ ★ │ ←── Moderator FAB
│                          └───┘      │
│─────────────────────────────────────│
│  Action Panel                       │
└─────────────────────────────────────┘
```

Tapping the FAB slides up the **Moderator Overlay**:

```
┌─────────────────────────────────────┐
│  ★ Moderator Panel        [▾ Hide] │
│─────────────────────────────────────│
│                                     │
│  ── Roles ──                        │
│  Ali: 🐺 Werewolf                  │
│  Berk: 🏘️ Villager                  │
│  Can: 🔮 Seer                      │
│  Deniz: 🏘️ Villager                 │
│  Ece: 🐺 Werewolf                  │
│  Fatih: 🏥 Doctor                   │
│                                     │
│  ── Night Actions ──                │
│  🐺 Werewolves: targeting Can      │
│  🔮 Seer: investigated Ali (🐺)    │
│  🏥 Doctor: protected Deniz        │
│                                     │
│  ── Phase Control ──                │
│  [⏭️ Advance to Day]               │
│  [⏱️ Add 30s]  [⏱️ Skip Timer]     │
│                                     │
│  ── Game Log ──                     │
│  20:14 Game started                 │
│  20:14 Roles assigned               │
│  20:14 Night 1 began                │
│  20:15 Werewolves chose: Can        │
│  20:15 Seer investigated: Ali       │
│  20:15 Doctor protected: Deniz      │
│                                     │
└─────────────────────────────────────┘
```

### Moderator-specific capabilities

| Capability | Where it appears | How it works |
|---|---|---|
| See all roles | Moderator Panel → Roles | Always visible in mod panel |
| See night actions | Moderator Panel → Night Actions | Live-updates as roles act |
| Advance phase | Moderator Panel → Phase Control | Big "Advance" button |
| Adjust timer | Moderator Panel → Phase Control | Add time or skip timer |
| Override elimination | Moderator Panel → Phase Control | Emergency override (rare) |
| View game log | Moderator Panel → Game Log | Scrollable chronological log |
| Pause game | Phase header (mod only) | Pause icon next to timer |

### Visual differentiation

- The **FAB** has a gold/amber color (`#D97706`) to distinguish it from the game's red/stone palette.
- When the mod panel is open, the main game view remains visible but dimmed (20% opacity overlay), so the moderator doesn't lose context.
- The mod panel has a **distinct left border** (`border-l-4 border-amber-500`) to visually separate it from the game UI.

### Dual-role during night

When the moderator is also a werewolf (or seer, etc.), they see BOTH:
1. Their personal action prompt (as a player)
2. The moderator panel showing all other actions

The personal action appears in the normal action panel at the bottom. The moderator panel is the overlay. The moderator is expected to act as their role first, then manage the phase.

---

## 7. Mobile-First Responsive Design

### Breakpoints

```
Mobile:    0 – 639px    (primary target)
Tablet:    640 – 1023px
Desktop:   1024px+
```

### Layout Strategy

#### Mobile (Default)

```
┌─────────────────────┐
│    Phase Header      │  ← fixed top, 64px
│─────────────────────│
│                     │
│    Main Content     │  ← scrollable, flex-1
│    (player circle,  │
│     announcements)  │
│                     │
│─────────────────────│
│    Action Panel     │  ← fixed bottom sheet
│    (votes, chat,    │     min-height: 120px
│     night actions)  │     swipe-up to expand
└─────────────────────┘
```

- **Bottom sheet pattern.** The action panel lives at the bottom, permanently visible at a peek height showing the current action prompt. Swiping up reveals full options. This mirrors native mobile UX patterns players are already familiar with.
- **Player circle becomes a horizontal scroll** on mobile when there are 8+ players.
- **No horizontal scrolling otherwise.** Everything fits within the viewport width.
- **Touch targets: 44px minimum.** All tappable elements (buttons, player cards, vote buttons) are at least 44×44px per Apple HIG.
- **Safe area insets.** `env(safe-area-inset-bottom)` padding for notched phones.

#### Tablet

```
┌──────────────────────────────────────┐
│           Phase Header               │
│──────────────────────────────────────│
│                    │                 │
│   Player Circle    │  Action Panel   │
│   (larger cards)   │  (side panel)   │
│                    │                 │
│                    │                 │
│                    │                 │
└──────────────────────────────────────┘
```

- Action panel moves from bottom sheet to a right-side panel (320px wide).
- Player circle gets more space, cards are larger.
- Moderator panel can be a right sidebar instead of overlay.

#### Desktop

```
┌─────────────────────────────────────────────────────┐
│                   Phase Header                       │
│─────────────────────────────────────────────────────│
│          │                         │                │
│  Player  │     Game Arena          │  Side Panel    │
│  List    │     (circular layout)   │  (Chat +       │
│          │                         │   Actions +    │
│          │                         │   Mod Panel)   │
│          │                         │                │
│          │                         │                │
└─────────────────────────────────────────────────────┘
```

- Three-column layout with the game arena in the center.
- Player list as a sidebar on the left.
- Chat, actions, and moderator tools in the right sidebar.
- Maximum content width: 1280px, centered.

### Key Mobile Considerations

1. **Prevent accidental actions.** Voting and night actions require a **confirmation step** — tap to select, then tap "Confirm" to submit. This prevents mis-taps on crowded screens.

2. **Landscape orientation.** Show a gentle prompt suggesting portrait mode, but don't lock orientation. The layout still works in landscape with adjusted spacing.

3. **Keyboard handling.** When the chat input opens the keyboard, the action panel scrolls up smoothly. Use `visualViewport` API to detect keyboard height.

4. **Pull-to-refresh disabled.** Prevent accidental page reloads during gameplay. `overscroll-behavior: none`.

5. **Wake lock.** Use the Screen Wake Lock API to prevent the phone from sleeping during a game.

---

## 8. Animations and Polish

### Phase Transition — The Signature Moment

Phase changes are the most dramatic moments. They get a **full-screen overlay animation**.

#### Night → Day Transition

1. Screen darkens to pure black over 300ms.
2. A moon icon fades out while a sun icon fades in (center of screen).
3. The background gradient shifts from `#0C0A09` → `#1C1917` (subtle warm shift).
4. Text fades in: "Dawn breaks over the village..." (typewriter effect, 40ms per character).
5. If someone died: a dramatic 1-second pause, then the death announcement slides up.
6. Overlay dissolves outward (radial wipe from center) revealing the day view. Total duration: ~3 seconds.

#### Day → Night Transition

1. The sun icon "sets" (translates downward and fades).
2. Screen dims progressively over 500ms.
3. Stars twinkle in (small white dots with staggered `opacity` animations).
4. Moon rises (translates upward and fades in).
5. Text: "Night falls. The werewolves awaken..."
6. Radial wipe inward to the night view. Total duration: ~3 seconds.

#### Implementation: CSS + minimal JS

```css
@keyframes typewriter {
  from { width: 0; }
  to { width: 100%; }
}

@keyframes twinkle {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}

@keyframes moonrise {
  from { transform: translateY(100px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.phase-transition {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: #0C0A09;
  animation: fadeIn 300ms ease-out;
}
```

### Micro-interactions

| Element | Interaction | Animation |
|---|---|---|
| Player card (tap) | Select target | `scale(1.05)` + red border glow, 150ms spring |
| Vote button | Cast vote | Button ripple effect + checkmark morph, 200ms |
| Player eliminated | Death | Card flips to gray, skull fades in, 600ms |
| Timer (last 30s) | Urgency | Pulse red glow, increasingly fast (CSS `animation-duration` decreases) |
| New player joins | Lobby | Spring scale-in from 0, 300ms |
| Accusation | Day phase | Speech bubble pops up with bounce, 200ms |
| Chat message | Any time | Slide up from bottom, 150ms ease-out |
| Role reveal | Results | 3D card flip (Y-axis rotation), 500ms |
| Connection lost | Any time | Top banner slides down, 200ms |
| Reconnected | Recovery | Banner changes to green, fades out after 2s |

### Sound Design (Optional, Muted by Default)

- Phase transitions: atmospheric whoosh sound
- Elimination: dramatic sting
- Timer warning: subtle ticking (last 10s)
- New player joins: soft chime
- Vote cast: subtle click

All sounds use the Web Audio API with pre-loaded buffers. A mute toggle is always visible in the header. Sounds default to OFF and are opt-in — never surprise users with audio.

---

## 9. Accessibility

### Color Contrast

All text meets **WCAG 2.1 AA** (4.5:1 for normal text, 3:1 for large text).

| Element | Foreground | Background | Ratio |
|---|---|---|---|
| Body text | `#E7E5E4` (stone-200) | `#1C1917` (stone-900) | 12.5:1 ✅ |
| Secondary text | `#A8A29E` (stone-400) | `#1C1917` (stone-900) | 5.4:1 ✅ |
| Red accent on dark | `#EF4444` (red-500) | `#1C1917` (stone-900) | 4.8:1 ✅ |
| Button text | `#FAFAF9` (stone-50) | `#B91C1C` (red-700) | 6.2:1 ✅ |
| Amber (mod) on dark | `#F59E0B` (amber-500) | `#1C1917` (stone-900) | 7.1:1 ✅ |
| Night phase text | `#D6D3D1` (stone-300) | `#0C0A09` (stone-950) | 13.4:1 ✅ |

### Beyond Color

- **Never use color alone** to convey information. Dead players show a skull icon AND grayed-out color AND strikethrough text. Werewolf alignment uses a wolf icon AND red color AND text label.
- **Vote status** uses icons (✓ for voted, ✕ for not voted, ⏳ for pending) alongside color changes.
- **Phase indicator** uses both color and icon (🌙 moon for night, ☀️ sun for day, ⚖️ scales for vote).

### Screen Reader Support

```html
<!-- Phase announcement -->
<div role="status" aria-live="polite" aria-label="Game phase">
  Night phase. Close your eyes.
</div>

<!-- Player card -->
<button
  role="option"
  aria-label="Select Ali for elimination. Ali is alive."
  aria-selected="false"
  aria-disabled="false"
>
  <span class="sr-only">Alive player</span>
  Ali
</button>

<!-- Timer -->
<div role="timer" aria-live="off" aria-label="Phase timer: 42 seconds remaining">
  0:42
</div>

<!-- Death announcement -->
<div role="alert" aria-live="assertive">
  Can has been eliminated. They were a Villager.
</div>

<!-- Vote buttons -->
<div role="group" aria-label="Vote on Ali's fate">
  <button aria-label="Vote guilty">Guilty</button>
  <button aria-label="Vote innocent">Innocent</button>
</div>
```

### Keyboard Navigation

- `Tab` / `Shift+Tab` navigates between interactive elements.
- `Enter` / `Space` activates buttons and selects players.
- `Escape` closes overlays, modals, and the moderator panel.
- **Focus trap** inside modals and the moderator panel when open.
- **Visible focus rings** — `ring-2 ring-red-500 ring-offset-2 ring-offset-stone-900`. Never remove outlines without replacement.

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  
  .phase-transition {
    /* Instant cut instead of animated transition */
    animation: none;
  }
}
```

### Touch Accessibility

- Minimum touch target: 44×44px (iOS) / 48×48dp (Android Material).
- Spacing between adjacent touch targets: minimum 8px.
- No hover-only interactions. Everything works with tap.
- Long-press shows tooltip (player info) on mobile; hover shows tooltip on desktop.

---

## 10. Dark Theme / Atmospheric Design

### Color Palette

The palette is built on Tailwind's **Stone** gray scale (warm undertones) paired with a **blood red** accent. This creates a warm, ominous atmosphere without being garish.

#### Core Palette

```
┌─────────────────────────────────────────────────────────┐
│  BACKGROUNDS                                            │
│                                                         │
│  ██████  #0C0A09  stone-950   Deepest background       │
│  ██████  #1C1917  stone-900   Primary background        │
│  ██████  #292524  stone-800   Elevated surfaces         │
│  ██████  #44403C  stone-700   Borders, dividers         │
│                                                         │
│  TEXT                                                    │
│                                                         │
│  ██████  #FAFAF9  stone-50    Primary text              │
│  ██████  #E7E5E4  stone-200   Secondary text            │
│  ██████  #A8A29E  stone-400   Muted text               │
│  ██████  #78716C  stone-500   Disabled text             │
│                                                         │
│  ACCENT — BLOOD RED                                     │
│                                                         │
│  ██████  #FCA5A5  red-300     Light accent (highlights) │
│  ██████  #EF4444  red-500     Standard accent           │
│  ██████  #B91C1C  red-700     Buttons, primary actions  │
│  ██████  #7F1D1D  red-900     Subtle red backgrounds    │
│                                                         │
│  SEMANTIC                                               │
│                                                         │
│  ██████  #D97706  amber-600   Moderator / warning       │
│  ██████  #16A34A  green-600   Success / connected       │
│  ██████  #2563EB  blue-600    Info / seer               │
│  ██████  #7C3AED  violet-600  Special roles             │
│                                                         │
│  PHASE COLORS                                           │
│                                                         │
│  Night BG:    #0C0A09 (near black)                      │
│  Night Accent:#6366F1 (indigo-500, moonlight)           │
│  Day BG:      #1C1917 (warm dark)                       │
│  Day Accent:  #F59E0B (amber-500, sunlight)             │
│  Vote BG:     #1C1917                                   │
│  Vote Accent: #EF4444 (red-500, tension)                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Phase-specific atmospheric effects

**Night:**
- Background: radial gradient from `#0C0A09` center to `#000000` edges.
- Subtle star particles (CSS-only, using `box-shadow` on a pseudo-element with `twinkle` animation).
- UI elements have a faint blue/indigo tint.
- A crescent moon SVG in the header.

**Day:**
- Background: `#1C1917` with a very subtle warm gradient overlay.
- UI elements shift to warmer tones.
- Sun SVG replaces moon in header.
- Slightly increased overall brightness (text shifts from `stone-200` to `stone-100`).

**Voting:**
- Red tension overlay — a very faint red radial gradient pulses behind the accused player.
- Timer glows red.
- Heightened contrast for vote buttons.

### Typography

```
Font Stack:
  Primary:    'Inter', system-ui, -apple-system, sans-serif
  Monospace:  'JetBrains Mono', 'Fira Code', monospace  (game codes, timers)
  Display:    'Cinzel', serif  (logo, phase headers, dramatic moments)
```

**Why these fonts:**

- **Inter** — Designed for screens, excellent readability at small sizes (mobile), extensive weight range, free. Loaded via Google Fonts with `display=swap` and subset to Latin + Latin Extended.
- **JetBrains Mono** — Clean monospace for game codes and timers. Players need to read and type 6-char game codes quickly.
- **Cinzel** — Medieval/serif display font for thematic headers. Used sparingly — logo, "Night falls...", "The Village Has Spoken", winner announcement. Adds gravitas without making the UI feel dated.

#### Type Scale

```
text-xs:    12px / 16px    Timestamps, labels
text-sm:    14px / 20px    Secondary text, captions
text-base:  16px / 24px    Body text, player names
text-lg:    18px / 28px    Section headers
text-xl:    20px / 28px    Phase sub-headers
text-2xl:   24px / 32px    Phase headers
text-3xl:   30px / 36px    Dramatic reveals
text-4xl:   36px / 40px    Winner announcement (display font)
```

All text uses **`font-smoothing: antialiased`** for crisp rendering on dark backgrounds.

### Spacing System

Based on Tailwind's 4px grid:

```
1:   4px     Micro spacing (icon-to-text)
2:   8px     Tight spacing (within components)
3:  12px     Standard gap (between related items)
4:  16px     Component padding
5:  20px     Section gaps
6:  24px     Page horizontal padding (mobile)
8:  32px     Section vertical padding
10: 40px     Large section gaps
12: 48px     Between major sections
16: 64px     Page vertical padding (desktop)
```

### Imagery & Iconography

- **Icons:** Lucide Icons (tree-shakeable, consistent stroke width, MIT licensed). Key icons: Moon, Sun, Skull, Shield, Eye, Users, Timer, MessageCircle, Crown (moderator).
- **Player avatars:** DiceBear API with `adventurer-neutral` style. Generated client-side from a hash of the player's name. Each avatar sits on a colored circular background using a deterministic color derived from the player's name.
- **Background elements:** CSS-only atmospheric effects. No heavy images. Fog uses layered `linear-gradient` with slow CSS animation. Stars use `radial-gradient` dots.
- **Wolf motif:** A single wolf silhouette SVG used in the logo and as a watermark (5% opacity) on the night phase background.

### Card Design

Player cards are the most repeated element. Their design:

```css
.player-card {
  /* Size */
  width: 72px;              /* mobile */
  /* 88px on tablet, 96px on desktop */
  
  /* Shape */
  border-radius: 12px;      /* rounded-xl */
  
  /* Surface */
  background: #292524;       /* stone-800 */
  border: 2px solid #44403C; /* stone-700 */
  
  /* When selected */
  border-color: #EF4444;     /* red-500 */
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.3);
  
  /* When dead */
  opacity: 0.4;
  filter: grayscale(100%);
  
  /* When disconnected */
  opacity: 0.5;
  /* wifi-off icon overlay */
  
  /* Inner layout */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
}
```

### Glassmorphism for Overlays

Modals, the moderator panel, and the chat drawer use a frosted glass effect:

```css
.glass-panel {
  background: rgba(28, 25, 23, 0.85);  /* stone-900 at 85% */
  backdrop-filter: blur(12px);
  border: 1px solid rgba(68, 64, 60, 0.5);  /* stone-700 at 50% */
  border-radius: 16px;
}
```

---

## Appendix A: Complete File Structure

```
src/
├── main.tsx                      # Entry point
├── app.tsx                       # Root component, router setup
├── vite-env.d.ts
│
├── assets/
│   ├── wolf-logo.svg
│   ├── moon.svg
│   ├── sun.svg
│   └── sounds/                   # Optional audio files
│       ├── phase-transition.mp3
│       ├── elimination.mp3
│       └── tick.mp3
│
├── styles/
│   ├── tailwind.css              # @tailwind directives
│   ├── theme.css                 # CSS custom properties
│   └── animations.css            # @keyframes
│
├── store/
│   ├── game.ts                   # All game-related Signals
│   ├── connection.ts             # WebSocket connection state
│   └── ui.ts                     # Local UI state signals
│
├── services/
│   ├── websocket.ts              # WebSocketManager class
│   ├── audio.ts                  # AudioManager (Web Audio API)
│   └── wakeLock.ts               # Screen Wake Lock API
│
├── types/
│   ├── game.ts                   # Game, Player, Role, Phase types
│   ├── messages.ts               # WebSocket message types
│   └── ui.ts                     # UI-specific types
│
├── hooks/
│   ├── useGamePhase.ts           # Phase-dependent logic
│   ├── useTimer.ts               # Timer display logic
│   ├── usePlayerAction.ts        # Current available action
│   └── useMediaQuery.ts          # Responsive breakpoints
│
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── BottomSheet.tsx
│   │   ├── Toast.tsx
│   │   ├── Timer.tsx
│   │   ├── Avatar.tsx
│   │   ├── Badge.tsx
│   │   ├── ConnectionStatus.tsx
│   │   └── ScreenReaderOnly.tsx
│   │
│   ├── home/
│   │   ├── HomeScreen.tsx
│   │   ├── CreateGameButton.tsx
│   │   ├── JoinGameForm.tsx
│   │   └── RulesModal.tsx
│   │
│   ├── lobby/
│   │   ├── LobbyScreen.tsx
│   │   ├── PlayerGrid.tsx
│   │   ├── PlayerSlot.tsx
│   │   ├── RoleConfig.tsx
│   │   ├── GameCodeDisplay.tsx
│   │   ├── ShareOptions.tsx
│   │   └── QRCodeModal.tsx
│   │
│   ├── game/
│   │   ├── GameScreen.tsx
│   │   ├── PhaseHeader.tsx
│   │   ├── PhaseIndicator.tsx
│   │   ├── PlayerCircle.tsx
│   │   ├── PlayerCard.tsx
│   │   ├── DeathMarker.tsx
│   │   ├── ActionPanel.tsx
│   │   ├── VotePanel.tsx
│   │   ├── NightActionPanel.tsx
│   │   ├── DiscussionPanel.tsx
│   │   ├── SpectatorPanel.tsx
│   │   ├── ChatDrawer.tsx
│   │   ├── EventToast.tsx
│   │   └── PhaseTransition.tsx
│   │
│   ├── moderator/
│   │   ├── ModeratorFAB.tsx
│   │   ├── ModeratorPanel.tsx
│   │   ├── AllRolesView.tsx
│   │   ├── NightActionQueue.tsx
│   │   ├── PhaseControls.tsx
│   │   └── GameLog.tsx
│   │
│   └── results/
│       ├── ResultsScreen.tsx
│       ├── WinnerBanner.tsx
│       ├── RoleReveal.tsx
│       ├── RevealCard.tsx
│       ├── GameTimeline.tsx
│       └── PlayAgainButton.tsx
│
├── utils/
│   ├── avatarColor.ts            # Deterministic color from name
│   ├── formatTime.ts             # Timer formatting
│   └── gameCode.ts               # Code generation/validation
│
└── constants/
    ├── roles.ts                  # Role definitions, icons, descriptions
    └── phases.ts                 # Phase definitions, theme mappings
```

---

## Appendix B: Performance Budget

| Metric | Target | Rationale |
|---|---|---|
| First Contentful Paint | < 1.5s on 3G | Players joining mid-party on cellular |
| Time to Interactive | < 3s on 3G | Must be usable quickly |
| Total JS bundle (gzipped) | < 50 KB | Preact + Signals + app code |
| Total CSS (gzipped) | < 15 KB | Tailwind purged |
| WebSocket message size | < 1 KB avg | Minimize data usage |
| Memory usage | < 30 MB | Low-end phones |
| Lighthouse Performance | > 90 | Baseline quality gate |

### Loading Strategy

1. **Critical CSS inlined** in the HTML `<head>`.
2. **Route-based code splitting** — lobby, game, and results screens are separate chunks.
3. **Font loading** — `display=swap`, subset to used characters, preconnect to Google Fonts CDN.
4. **No images** on critical path. SVGs inlined or loaded lazily.
5. **Service Worker** for offline shell caching (the app should at least show a "reconnecting" screen offline).

---

## Appendix C: Technology Stack Summary

```
Runtime:          Preact 10.x + Preact Signals
Language:         TypeScript 5.x (strict)
Build:            Vite 5.x
Styling:          Tailwind CSS v4 + CSS custom properties
Routing:          Preact-Router (lightweight, 1.6 KB)
Icons:            Lucide Icons (tree-shaken)
Avatars:          DiceBear (client-side generation)
Fonts:            Inter + Cinzel + JetBrains Mono (Google Fonts)
Audio:            Web Audio API (native)
Animations:       CSS transitions/animations + requestAnimationFrame
Linting:          ESLint + Prettier
Testing:          Vitest + Preact Testing Library
E2E Testing:      Playwright
```

No Redux. No React Query. No component library. No CSS-in-JS runtime. Every dependency must justify its bundle cost for a mobile-first, real-time game.
