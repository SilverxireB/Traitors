# Traitors — Game Logic, Rules Engine & Turn Management Specification

> A complete game rules specification for a web-based Werewolf (Vampir Köylü / Mafia) game management tool.
> Version 1.0 · Game Logic Spec

---

## Table of Contents

1. [Complete Role System](#1-complete-role-system)
2. [Phase System & Turn Management](#2-phase-system--turn-management)
3. [Night Phase Resolution](#3-night-phase-resolution)
4. [Voting System](#4-voting-system)
5. [Win Conditions](#5-win-conditions)
6. [Edge Cases & Error Handling](#6-edge-cases--error-handling)
7. [Role Balance Tables](#7-role-balance-tables)
8. [Game Configuration Options](#8-game-configuration-options)

---

## 1. Complete Role System

### 1.1 Core Design Principles

- Every role belongs to exactly one **team**: Village, Werewolf, or Neutral.
- Every role has zero or one **night ability** (never more than one active ability per night).
- Abilities are **mandatory by default** — a player who fails to submit an action before the timer expires has their action auto-skipped (no-op), not randomly assigned.
- The moderator is a full player with a randomly assigned role. Their moderator privileges are an overlay, not a replacement for their role.
- Roles are designed to be **composable**: any combination of roles can coexist without rule conflicts because every interaction is resolved through a deterministic priority queue (§3).

### 1.2 Team Definitions

| Team | Goal | Members |
|---|---|---|
| **Village** | Eliminate all Werewolves | Villager, Seer, Doctor, Hunter, Witch, Bodyguard, Cupid, Elder, Village Idiot |
| **Werewolf** | Equal or outnumber living Village-aligned players | Werewolf, Alpha Werewolf |
| **Neutral** | Varies per role | Tanner, Jester |

### 1.3 Role Catalog

Each role entry specifies:
- **Team**: Affiliation
- **Night ability**: What they do, if anything
- **Activation phase**: When their ability triggers
- **Resolution priority**: Order in the night resolution queue (lower = resolves first)
- **Appears as (to Seer)**: What the Seer's investigation reveals
- **Special rules**: Edge cases and interactions

---

#### 1.3.1 Villager

| Property | Value |
|---|---|
| Team | Village |
| Night ability | None |
| Resolution priority | N/A |
| Appears as (to Seer) | Village |
| Count in game | Fills remaining slots after special roles are assigned |

**Description**: The backbone of the village. No special power. Wins by deduction, persuasion, and voting. The Villager's power is political — their vote counts the same as everyone else's.

**Special rules**: None.

---

#### 1.3.2 Werewolf

| Property | Value |
|---|---|
| Team | Werewolf |
| Night ability | Choose one non-Werewolf player to kill |
| Activation phase | Night (every night, including Night 1) |
| Resolution priority | 40 |
| Appears as (to Seer) | Werewolf |
| Count in game | See balance tables (§7); typically ⌊players ÷ 3.5⌋, minimum 1 |

**Description**: The primary antagonist. During the night, all living Werewolves collectively choose one target to kill. They know each other's identities from the start of the game.

**Ability mechanics**:
- All Werewolves share a single night action. They must agree on one target.
- The server tracks individual Werewolf selections. When all living Werewolves have selected the same target, the action is locked in.
- If Werewolves disagree and the timer expires, the **plurality target** is chosen (the player with the most Werewolf selections). On a tie among Werewolf selections, the target is chosen **randomly** from the tied candidates.
- A Werewolf **cannot** target another Werewolf.
- Werewolves have access to a private "Wolf Chat" channel during the night phase only (configurable: can be extended to all phases).

**Edge case — Lone Werewolf**: If only one Werewolf is alive, they choose alone with no consensus needed.

**Edge case — All Werewolves disconnected**: See §6.4.

---

#### 1.3.3 Alpha Werewolf

| Property | Value |
|---|---|
| Team | Werewolf |
| Night ability | Same as Werewolf; additionally, once per game, may convert a Village-aligned player to the Werewolf team |
| Activation phase | Night (conversion is a separate action resolved at priority 35) |
| Resolution priority | 35 (conversion), 40 (kill — shared with pack) |
| Appears as (to Seer) | Werewolf |
| Count in game | 0 or 1 (optional advanced role) |

**Description**: A more powerful Werewolf who leads the pack. Participates in the normal Werewolf kill and has one additional ability.

**Conversion mechanics**:
- Once per game, the Alpha Werewolf may choose to **convert** a living Village-aligned player instead of (or in addition to) the pack's kill.
- The converted player's role changes to Werewolf. Their original ability is lost.
- The conversion target learns they have been converted at the start of the next night phase (message: "You feel a change... you are now a Werewolf").
- Conversion is resolved at priority 35, **before** the Werewolf kill at priority 40. If the conversion target is also the kill target, the conversion takes effect and the kill is wasted (the pack effectively "killed" their new member — the server cancels the kill).
- Roles that **cannot be converted**: Hunter (dies and shoots instead), Elder (conversion fails, ability wasted), other Werewolves.
- The Seer investigating a converted player on the same night the conversion occurs sees them as **Village** (because the Seer resolves at priority 20, before conversion at priority 35).

**Special rules**:
- The Alpha Werewolf is always included in the Werewolf count for balance purposes.
- If the Alpha Werewolf dies, no further conversions can occur.
- The moderator is notified of the conversion and the new Werewolf's identity.

---

#### 1.3.4 Seer (Fortune Teller)

| Property | Value |
|---|---|
| Team | Village |
| Night ability | Choose one living player to investigate; learn their team affiliation |
| Activation phase | Night (every night, including Night 1) |
| Resolution priority | 20 |
| Appears as (to Seer) | N/A (cannot self-investigate) |
| Count in game | 0 or 1 |

**Description**: The village's primary information-gathering role. Each night, the Seer selects a player and learns whether they are **Village** or **Werewolf**.

**Ability mechanics**:
- The Seer sees **team affiliation**, not the specific role. "Village" or "Werewolf" only.
- The result is delivered instantly upon resolution (the Seer does not need to wait for the night to end to see their result).
- The Seer **can** investigate dead players (useful for validating claims), but this wastes their nightly action.
- The Seer **cannot** investigate themselves.

**Interaction with other roles**:
- The Seer resolves at priority 20, meaning their investigation happens **before** deaths are resolved at priority 40+. If the Seer's target is killed by Werewolves on the same night, the Seer still receives the result (they investigated before the kill resolved).
- If the Seer themselves is killed, they still receive their result (they acted before they died). The result is shown in a "last vision" message on their death screen.
- The Village Idiot appears as **Village** to the Seer.
- The Tanner appears as **Village** to the Seer (they are not a Werewolf).

---

#### 1.3.5 Doctor (Healer)

| Property | Value |
|---|---|
| Team | Village |
| Night ability | Choose one living player to protect from death this night |
| Activation phase | Night (every night, including Night 1) |
| Resolution priority | 30 |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: The Doctor can protect one player from being killed during the night. If the Werewolves target a protected player, that player survives.

**Ability mechanics**:
- The Doctor selects one living player (including themselves) to protect.
- Protection lasts for one night only.
- **Self-protection limit** (configurable, default: once per game): The Doctor may protect themselves, but only once during the entire game. After self-protecting, the option to select themselves is disabled in the UI. The server rejects subsequent self-protection attempts.
- **Consecutive protection rule** (configurable, default: not allowed): The Doctor **cannot** protect the same player on two consecutive nights. This prevents an optimal strategy of always protecting the same confirmed-good player.
- If the Doctor protects the Werewolf target, the target survives. The Werewolves are **not** informed that their kill failed (they learn at dawn when the village announcement says "No one died last night").
- If the Doctor protects a player who was not targeted, nothing happens (the protection is wasted, but no information is leaked).

**Resolution**:
- The Doctor's protection is registered at priority 30, before the Werewolf kill at priority 40. When the kill resolves, the engine checks if the target has active protection. If yes, the kill is nullified.

**Interaction with Witch**: If the Witch uses her kill potion on a Doctor-protected player, the protection **does not** block the Witch's kill. The Doctor only blocks Werewolf kills (and Hunter kills, if applicable). The Witch's kill potion is magical and bypasses standard protection.

**Configurable variant**: "Doctor blocks all night kills" — if enabled, the Doctor also blocks the Witch's kill. Default: off.

---

#### 1.3.6 Hunter

| Property | Value |
|---|---|
| Team | Village |
| Night ability | None (passive ability triggers on death) |
| Activation phase | On death (any phase) |
| Resolution priority | 90 (death trigger) |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: The Hunter has no active night ability. Instead, when the Hunter dies — by any means (Werewolf kill, village vote, Witch kill, or any other cause) — they immediately take one player down with them.

**Ability mechanics**:
- When the Hunter dies, the game **pauses** and the Hunter is prompted to choose a living player to shoot.
- The Hunter's shot is **mandatory** — they must shoot someone. If the timer expires without a choice, a random living player is selected.
- The Hunter's shot **cannot be prevented** by Doctor protection or any other ability. It is an instantaneous, unblockable death.
- The Hunter **cannot** shoot themselves (they are already dead).
- The shot triggers **immediately**, interrupting the current phase:
  - If the Hunter dies at night (Werewolf kill): the shot resolves during night resolution, before the dawn announcement.
  - If the Hunter dies during a day vote: the shot resolves immediately after the vote result is shown, before the next phase transition.
- The shot target's role is **not** revealed (unless the game's "reveal role on death" setting is enabled).

**Chain reactions**:
- If the Hunter shoots another Hunter (when multiple Hunters are enabled via custom roles), the second Hunter's ability triggers as well, creating a chain.
- If the Hunter shoots a player who is Cupid-linked (see §1.3.8), the linked lover also dies, but the lover's death does **not** re-trigger the Hunter (only the initial shot triggers the ability).

**Timing detail — Hunter dies during night**:
1. Werewolves choose target → target is the Hunter.
2. Night resolution runs → Hunter is marked as "dying."
3. Before dawn, the Hunter death-trigger fires (priority 90).
4. Hunter is prompted to shoot (15-second timer, configurable).
5. Shot target dies.
6. Win conditions are checked.
7. Dawn announcement reveals all deaths: "Hunter and [shot target] were found dead."

---

#### 1.3.7 Witch

| Property | Value |
|---|---|
| Team | Village |
| Night ability | Two one-use potions: (1) Heal — save the Werewolf's target, (2) Kill — kill any living player |
| Activation phase | Night (every night, but each potion is single-use) |
| Resolution priority | 50 (heal), 60 (kill) |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: The Witch is the most complex Village role. They possess two potions, each usable exactly once per game.

**Ability mechanics**:

**Heal Potion (priority 50)**:
- At the start of the Witch's night turn, the Witch is **told who the Werewolves targeted** this night (e.g., "The Werewolves have chosen to kill Ali. Do you wish to save them?").
- The Witch may use their heal potion to save the target. The target survives.
- The heal potion can only be used on the Werewolf's target, not on any arbitrary player.
- Once used, the heal potion is gone for the remainder of the game.
- The Witch **can** heal themselves if they are the Werewolf target (configurable, default: yes).

**Kill Potion (priority 60)**:
- The Witch may choose any living player (including themselves, though this would be suicidal and is generally undesirable) and kill them.
- The kill potion bypasses Doctor protection (it is a magical kill, not a Werewolf attack).
- Once used, the kill potion is gone for the remainder of the game.

**Using both in one night** (configurable, default: no):
- By default, the Witch can only use **one** potion per night — either heal or kill, not both.
- If the "Witch can use both potions in one night" setting is enabled, they may use both.

**Special rules**:
- On Night 1, the Witch **may** use either potion (configurable, default: both available from Night 1).
- If the Witch has no remaining potions, they still "wake up" during the night (so that their lack of potions is not revealed to observant players in an in-person variant), but the server auto-skips their turn.
- The Witch is informed of the Werewolf target even if the Doctor has already protected them. The Witch does not know whether the Doctor has acted. If both the Doctor protects and the Witch heals the same target, the protection is redundant (no harm done, but the Witch wastes a potion).

**Edge case — Witch targets a player who is also the Werewolf target**:
- If the Witch uses the kill potion on the same player the Werewolves targeted, and also uses the heal potion: the heal potion saves from the Werewolf kill, but the kill potion still kills. Net result: the player dies (kill potion overrides heal potion when targeting the same player).
- If the Witch heals the Werewolf target, and the Doctor also protected them: redundant protection, player lives, Witch potion is consumed.

---

#### 1.3.8 Cupid

| Property | Value |
|---|---|
| Team | Village (but see special win condition below) |
| Night ability | On Night 1 only: choose two players to be "lovers" |
| Activation phase | Night 1 only |
| Resolution priority | 5 (resolves first) |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: Cupid creates a romantic bond between two players on the first night. If either lover dies, the other immediately dies of heartbreak.

**Ability mechanics**:
- On Night 1, Cupid selects exactly two living players. These players become "lovers."
- Both lovers are privately notified: "You are in love with [partner name]." They learn each other's identity but **not** each other's role.
- Cupid may choose themselves as one of the two lovers.
- From Night 2 onward, Cupid has no ability and functions as a Villager.

**Lover mechanics**:
- If either lover dies (by any means: Werewolf kill, village vote, Hunter shot, Witch kill), the other **immediately dies** of heartbreak.
- Heartbreak death is **unblockable** — Doctor protection cannot prevent it.
- Heartbreak death **does** trigger death abilities (e.g., if the heartbroken lover is the Hunter, they fire their shot).
- Lovers cannot vote to eliminate each other during the day phase. If a lover attempts to vote for their partner, the server rejects the action with a message: "You cannot vote against your lover."
- Lovers can be on **different teams**. A Village-Werewolf lover pair creates a special win condition (see below).

**Special win condition — Cross-team lovers**:
- If the two lovers are on different teams (e.g., one Villager and one Werewolf), they gain a **secret third win condition**: if they are the last two players alive, they win together (overriding both Village and Werewolf win conditions).
- Cupid, if alive, also wins in this scenario.
- This win condition is checked at every win-condition checkpoint (§5).

**Special rules**:
- Cupid's pairing is immutable — once set, it cannot be changed.
- If Cupid disconnects on Night 1 before making a selection, and the timer expires, **no lovers are created** (the ability is forfeited).
- The moderator always knows who the lovers are (visible in the moderator panel).

---

#### 1.3.9 Bodyguard

| Property | Value |
|---|---|
| Team | Village |
| Night ability | Choose one player to guard; if that player is attacked, the Bodyguard dies instead |
| Activation phase | Night (every night, including Night 1) |
| Resolution priority | 25 |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: A more aggressive protector than the Doctor. The Bodyguard takes the fatal blow instead of their ward.

**Ability mechanics**:
- Each night, the Bodyguard chooses one living player (not themselves) to guard.
- If the guarded player is targeted by the Werewolves, the guarded player lives and the **Bodyguard dies instead**.
- The Bodyguard **cannot** guard themselves.
- **No consecutive guard rule**: The Bodyguard cannot guard the same player two nights in a row (same as Doctor's consecutive protection rule).

**Interaction with Doctor**: If the Doctor also protects the Bodyguard's ward, both protections are in effect. The Doctor's protection triggers first (priority 30). Since the Doctor's protection prevents the kill outright, the Bodyguard's sacrifice is not triggered. The Bodyguard survives.

**Interaction with Witch kill**: The Bodyguard's protection does **not** apply against the Witch's kill potion. The Bodyguard only intercepts Werewolf kills.

**Edge case — Bodyguard guards a player, and the Bodyguard themselves is the Werewolf target**: The Bodyguard dies normally (they were the target, not their ward). Their guard on the other player becomes irrelevant.

---

#### 1.3.10 Elder (Old Man)

| Property | Value |
|---|---|
| Team | Village |
| Night ability | None (passive) |
| Activation phase | Passive |
| Resolution priority | N/A |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: The Elder has two lives against Werewolf attacks, but only one life against the village vote.

**Ability mechanics**:
- The Elder can survive **one** Werewolf attack. The first time the Werewolves target the Elder (and the kill is not otherwise prevented), the Elder survives but loses their extra life. The Werewolves are not informed that the kill failed (same as Doctor save — announced at dawn as "No one died").
- The second Werewolf attack kills the Elder normally.
- If the Elder is killed by **village vote**, the Elder dies immediately (no extra life). Additionally, as a penalty for executing an Elder, **all Village-aligned special roles lose their abilities** for the remainder of the game. This is announced: "The village has made a grave mistake. The spirits are angered." This does not reveal which roles were affected.
- If the Elder is killed by the **Witch's kill potion** or the **Hunter's shot**, the extra-life mechanic does not apply — they die in one hit. However, the "all roles lose abilities" penalty does **not** trigger (only village vote triggers it).

**Special rules**:
- The Elder's extra life status is tracked server-side. The moderator can see it in the mod panel.
- The Elder cannot be converted by the Alpha Werewolf (conversion fails, Alpha's ability is consumed).

---

#### 1.3.11 Village Idiot

| Property | Value |
|---|---|
| Team | Village |
| Night ability | None (passive) |
| Activation phase | Passive |
| Resolution priority | N/A |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 |

**Description**: The Village Idiot cannot be eliminated by village vote — but their survival comes at a cost.

**Ability mechanics**:
- If the Village Idiot is the target of a successful village elimination vote, their role is **revealed** and they survive. However, they **permanently lose their voting rights** for the rest of the game.
- The Village Idiot can still participate in discussion but cannot cast votes.
- The Village Idiot can still be killed by Werewolves, the Witch, or the Hunter normally.

**Special rules**:
- After being "caught," the Village Idiot's revealed status is visible to all players (their card shows a "Village Idiot" label).
- The Village Idiot's survival does **not** consume the village's daily elimination — the vote result is "no one was eliminated" (the village wasted their vote).
- If the Village Idiot is the last Village-aligned player alive (and there are living Werewolves), the village loses (the Village Idiot cannot vote to eliminate Werewolves).

---

#### 1.3.12 Tanner

| Property | Value |
|---|---|
| Team | Neutral |
| Night ability | None |
| Activation phase | N/A |
| Resolution priority | N/A |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 (optional) |

**Description**: The Tanner hates their life and wins by getting eliminated by the village vote. They are a chaos agent.

**Win condition**: The Tanner wins if they are eliminated during the day vote. Their win is **exclusive** — neither the Village nor the Werewolves win in this scenario (the game ends immediately).

**Special rules**:
- If the Tanner is killed at night (by Werewolves, Witch, Hunter), they simply die. They do **not** win.
- The Tanner appears as "Village" to the Seer (they are not a Werewolf).
- The Tanner can vote and participate normally.
- The Tanner's win condition is checked immediately after a day vote execution. If the executed player is the Tanner, the game ends with "The Tanner wins!"
- If the game's "Tanner win ends game" setting is disabled, the Tanner wins personally but the game continues for the remaining players. Default: Tanner win ends the game.

---

#### 1.3.13 Jester

| Property | Value |
|---|---|
| Team | Neutral |
| Night ability | None |
| Activation phase | On death by village vote |
| Resolution priority | 85 (death trigger) |
| Appears as (to Seer) | Village |
| Count in game | 0 or 1 (optional, alternative to Tanner) |

**Description**: Similar to the Tanner, but with a vengeful twist. If the Jester is eliminated by village vote, the Jester wins **and** may kill one player who voted "Guilty" against them.

**Ability mechanics**:
- If eliminated by village vote, the game pauses. The Jester is shown the list of players who voted "Guilty" and may choose one to kill.
- This kill is unblockable.
- If the Jester does not choose within the timer (15 seconds), a random "Guilty" voter is selected.
- If killed at night, the Jester simply dies with no special effect.

**Special rules**:
- The Jester and Tanner should not both be in the same game (they occupy the same design space). The configuration UI enforces this.
- The Jester's retribution kill can trigger chain deaths (e.g., killing a lover triggers the other lover's death).

---

### 1.4 Role Visibility Matrix

This table defines what each player knows about other players' roles at each point in the game.

| Observer → Target | Own Role | Other Village | Other Werewolf | Seer Result | Lovers |
|---|---|---|---|---|---|
| **Villager** | ✅ Known | ❌ Hidden | ❌ Hidden | ❌ | ❌ |
| **Werewolf** | ✅ Known | ❌ Hidden | ✅ Known (all wolves know each other) | ❌ | ❌ |
| **Seer** | ✅ Known | ❌ (until investigated) | ❌ (until investigated) | ✅ Results only | ❌ |
| **Doctor** | ✅ Known | ❌ Hidden | ❌ Hidden | ❌ | ❌ |
| **Cupid** | ✅ Known | ❌ Hidden | ❌ Hidden | ❌ | ✅ Knows the pair |
| **Lover** | ✅ Known | ❌ Hidden | ❌ Hidden | ❌ | ✅ Knows partner identity |
| **Moderator** | ✅ Known | ✅ All roles visible | ✅ All roles visible | ✅ All results | ✅ |

**Information revealed on death** (configurable, default: role is revealed):
- "Reveal role on death" ON: The dead player's specific role is announced.
- "Reveal role on death" OFF: Only "a player has died" is announced. The team is not revealed.
- "Reveal team on death" (middle option): Only "Village" or "Werewolf" is announced, not the specific role.

---

## 2. Phase System & Turn Management

### 2.1 Phase Flow Overview

```
Game Start
    │
    ▼
┌──────────────────┐
│   ROLE REVEAL    │  Players see their assigned role (5s, auto-advance)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   NIGHT 1        │  Special first-night roles act (Cupid, then standard night)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   DAWN           │  Deaths announced, transition animation (auto, 5s)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  DAY DISCUSSION  │  Players discuss, timer runs (configurable, default 3 min)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   NOMINATION     │  Players nominate suspects (configurable, default 1 min)
└────────┬─────────┘
         │
         ├──── No nominations? ──── Skip to Dusk (no elimination)
         │
         ▼
┌──────────────────┐
│  DEFENSE SPEECH  │  Each nominee speaks (configurable, default 30s each)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   DAY VOTE       │  Vote on nominee(s) (configurable, default 30s)
└────────┬─────────┘
         │
         ├──── Tie or no majority? ──── Tie-breaker rules (§4.5)
         │
         ▼
┌──────────────────┐
│  VOTE RESULT     │  Announce result, reveal role if applicable (auto, 8s)
└────────┬─────────┘
         │
         ├──── Win condition met? ──── Game Over
         │
         ▼
┌──────────────────┐
│   DUSK           │  Transition to night, last words (auto, 3s)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   NIGHT N+1      │  Night roles act
└────────┬─────────┘
         │
         ├──── Win condition met? ──── Game Over
         │
         ▼
         └──── Loop back to DAWN ────
```

### 2.2 Detailed Phase Definitions

#### 2.2.1 ROLE_REVEAL Phase

| Property | Value |
|---|---|
| Duration | 5 seconds (not configurable) |
| Trigger to advance | Timer expiry (auto) |
| Who acts | No one — passive viewing |

**What happens**:
1. Each player receives a private message revealing their assigned role.
2. The UI shows a dramatic card-flip animation revealing their role card.
3. Werewolves additionally receive a list of all other Werewolves: "Your fellow wolves are: [names]."
4. The moderator sees all role assignments in the moderator panel.

**Server actions**:
- Assign roles according to the configured role distribution.
- Send `ROLE_ASSIGNED` message to each player.
- Send `WEREWOLF_ALLIES` message to all Werewolves.
- Start the 5-second timer.
- Auto-advance to NIGHT_1 when timer expires.

---

#### 2.2.2 NIGHT Phase

| Property | Default Value |
|---|---|
| Duration | 45 seconds per sub-phase (configurable, see below) |
| Trigger to advance | All actions submitted OR timer expiry OR moderator advance |
| Who acts | Roles with night abilities, in priority order |

**Structure of the night phase**:

The night is internally subdivided into **sub-phases**, one per active role. Sub-phases run sequentially based on resolution priority. Players with no night ability see a "The village sleeps" screen for the entire duration.

Sub-phase order (by resolution priority):

| Priority | Role | Sub-phase | Duration |
|---|---|---|---|
| 5 | Cupid | Choose lovers (Night 1 only) | 30s |
| 20 | Seer | Investigate a player | 20s |
| 25 | Bodyguard | Choose a player to guard | 20s |
| 30 | Doctor | Choose a player to protect | 20s |
| 35 | Alpha Werewolf | Convert (optional, once per game) | 20s |
| 40 | Werewolves | Choose a kill target | 30s |
| 50 | Witch (heal) | Save the Werewolf target? | 15s |
| 60 | Witch (kill) | Kill a player? | 15s |

**Important implementation note**: All sub-phases run on the server, but **only the currently-acting player(s) see their action prompt**. All other players see the sleeping screen. The total night duration is the sum of all active sub-phase durations (only sub-phases for roles that are alive and in the game).

**Optimization — Parallel sub-phases** (configurable, default: sequential):
If enabled, all night actions happen simultaneously (all roles get their prompt at the same time, and the night timer is a single shared timer). Resolution still follows priority order, but the order of player input does not matter. This speeds up gameplay significantly but reduces the "one at a time" drama of in-person games.

**Auto-advance within night**:
- When a role submits their action, their sub-phase ends immediately and the next sub-phase begins.
- When a role's timer expires without action, the action is **skipped** (no-op) and the next sub-phase begins.
- When all sub-phases are complete, the server resolves all actions (§3) and transitions to DAWN.

---

#### 2.2.3 DAWN Phase

| Property | Value |
|---|---|
| Duration | 5–8 seconds (auto, includes animation time) |
| Trigger to advance | Timer expiry (auto) |
| Who acts | No one — announcements only |

**What happens**:
1. The night→day transition animation plays.
2. The server announces the results of the night:
   - If someone died: "When the village awakes, they find [name] dead." (If role reveal is on: "[name] was a [role].")
   - If the Doctor/Witch saved someone: "The village awakes. No one died last night." (The saved player is not identified publicly.)
   - If the Bodyguard sacrificed: "[Bodyguard name] was found dead, having given their life to protect another." (The protected player is not identified.)
   - If multiple players died (e.g., Werewolf kill + Witch kill): all deaths are announced.
3. The dead player(s) are marked as dead in the player circle.
4. Win conditions are checked. If met, transition to GAME_OVER instead of DAY_DISCUSSION.

---

#### 2.2.4 DAY_DISCUSSION Phase

| Property | Default Value |
|---|---|
| Duration | 180 seconds (3 minutes, configurable: 60–600s) |
| Trigger to advance | Timer expiry OR moderator advance |
| Who acts | All living players may discuss |

**What happens**:
1. Players discuss openly. In a digital-only game, this means text chat is enabled for all living players. In an in-person game (where the app is a management tool), this is verbal discussion.
2. Players may make informal accusations (pointing fingers, sharing information, lying).
3. Dead players cannot speak (their chat is disabled). They can observe.
4. The moderator can extend or shorten the timer.

**Server actions**:
- Enable public chat for all living players.
- Start the discussion timer.
- On timer expiry or moderator advance, transition to NOMINATION.

---

#### 2.2.5 NOMINATION Phase

| Property | Default Value |
|---|---|
| Duration | 60 seconds (configurable: 30–180s) |
| Trigger to advance | Timer expiry OR moderator advance OR nomination limit reached |
| Who acts | All living players may nominate |

**What happens**:
1. Any living player may **nominate** another living player for elimination. A player taps on another player's card and selects "Nominate."
2. A nomination requires a **second** — another living player must confirm the nomination. This prevents frivolous nominations.
3. The nominated player cannot nominate anyone (they are defending).
4. A player can only be nominated once per round.
5. Maximum nominees per round (configurable, default: 2). When the limit is reached, nominations close.

**Nomination mechanics**:
- Player A taps Player B → "Player A nominates Player B" is announced.
- Within 15 seconds, if Player C seconds the nomination → "Player C seconds. Player B is nominated."
- If no one seconds within 15 seconds, the nomination lapses: "Nomination not seconded. It lapses."
- A player cannot nominate themselves.
- A player cannot second their own nomination.
- Each player may only make one nomination per nomination phase.
- Each player may second at most one nomination per phase.

**If no nominations are made**:
- The phase ends with "The village could not agree on a suspect. No one is nominated."
- Transition to DUSK → NIGHT (no elimination this round).

**Server actions**:
- Track nominations and seconds.
- When a nomination is seconded, add the nominee to the vote queue.
- When the nomination limit is reached or timer expires, transition to DEFENSE_SPEECH (if there are nominees) or DUSK (if there are none).

---

#### 2.2.6 DEFENSE_SPEECH Phase

| Property | Default Value |
|---|---|
| Duration | 30 seconds per nominee (configurable: 15–120s) |
| Trigger to advance | Timer expiry per nominee OR moderator advance |
| Who acts | Nominated players, one at a time |

**What happens**:
1. Each nominated player gets a timed opportunity to speak in their defense.
2. If there are multiple nominees, they speak in the order they were nominated.
3. The defense speech timer is visible to all players.
4. Other players cannot speak during the defense (chat disabled for non-nominees; in practice, this is enforced for digital chat only — in-person games rely on moderator enforcement).

**Server actions**:
- For each nominee, start a defense timer.
- On timer expiry or moderator advance, move to the next nominee or transition to DAY_VOTE.

---

#### 2.2.7 DAY_VOTE Phase

| Property | Default Value |
|---|---|
| Duration | 30 seconds (configurable: 15–60s) |
| Trigger to advance | All living players have voted OR timer expiry |
| Who acts | All living players (except nominees, who cannot vote — configurable) |

**What happens**:
1. Players vote on the nominated player(s).
2. Voting format depends on the number of nominees and configuration (see §4 for full voting system details).

**Single nominee**:
- Players vote **Guilty** or **Innocent** (binary vote).
- If Guilty votes exceed Innocent votes by the required threshold (configurable: simple majority, absolute majority, or supermajority), the nominee is eliminated.

**Multiple nominees**:
- Players vote for **one nominee** or abstain.
- The nominee with the most votes is eliminated (plurality).
- In case of a tie, tie-breaking rules apply (§4.5).

**Abstention**: Players may abstain from voting. Abstentions are counted as neither Guilty nor Innocent. If the "required to vote" setting is enabled (default: off), abstentions are not allowed and non-voters are auto-assigned an abstention at timer expiry.

**Server actions**:
- Accept and validate votes.
- On completion (all votes in or timer expiry), calculate the result.
- Transition to VOTE_RESULT.

---

#### 2.2.8 VOTE_RESULT Phase

| Property | Value |
|---|---|
| Duration | 8 seconds (auto, includes animation) |
| Trigger to advance | Timer expiry (auto) OR moderator advance |
| Who acts | No one — announcement |

**What happens**:
1. Vote tallies are revealed with animation.
2. If a player is eliminated:
   - Their role is revealed (if setting is on).
   - Death animation plays.
   - If the eliminated player is the Hunter, the Hunter's shot triggers (pausing this phase, see §1.3.6).
   - If the eliminated player has a lover, the lover dies of heartbreak.
   - If the eliminated player is the Tanner, the Tanner wins (§5).
   - If the eliminated player is the Jester, the Jester's retribution triggers.
   - If the eliminated player is the Elder, all Village specials lose abilities.
   - If the eliminated player is the Village Idiot, they survive and are revealed (§1.3.11).
3. If no player is eliminated (tie, insufficient votes), the announcement says "The village could not reach a decision."
4. Win conditions are checked.

---

#### 2.2.9 DUSK Phase

| Property | Value |
|---|---|
| Duration | 3 seconds (auto, animation) |
| Trigger to advance | Timer expiry (auto) |
| Who acts | No one — transition |

**What happens**:
1. Day→night transition animation plays.
2. "Night falls. Close your eyes." message appears.
3. Transition to NIGHT.

---

#### 2.2.10 GAME_OVER Phase

| Property | Value |
|---|---|
| Duration | Indefinite (until "Play Again" or room closes) |
| Trigger | Win condition met |
| Who acts | No one — results viewing |

**What happens**:
1. Winner announcement with dramatic animation.
2. All roles are revealed.
3. Game timeline is shown.
4. "Play Again" button available.

---

### 2.3 First Night Special Rules

Night 1 differs from subsequent nights in the following ways:

1. **Cupid acts first** (priority 5). No other role acts until Cupid has made their selection or their timer expires.
2. **Werewolves still kill on Night 1** (default, configurable). Some variants skip the Werewolf kill on Night 1 to prevent an early elimination. Setting: "Werewolves kill on Night 1" (default: yes).
3. **Seer investigates on Night 1** (default: yes, configurable). Some variants delay the Seer's first investigation to Night 2.
4. **Doctor protects on Night 1** (default: yes). No consecutive-protection restriction applies since there is no "previous night."
5. **Witch may act on Night 1** (default: yes, configurable). Setting: "Witch active on Night 1."

### 2.4 Timer Management

#### Timer Architecture

```
Server (authoritative)
  │
  ├── Phase timer (countdown in seconds)
  │     - Started when a phase begins
  │     - Decremented every second server-side
  │     - Broadcast to all clients via TIMER_TICK messages (every second)
  │     - On reaching 0: phase auto-advances
  │
  └── Sub-phase timer (night role actions)
        - Same mechanics, scoped to the current night sub-phase
        - Only visible to the acting player(s) and moderator
```

#### Timer Controls (Moderator Only)

| Action | Effect |
|---|---|
| **Pause** | Freezes the timer. Sends `TIMER_PAUSE` to all clients. UI shows "Paused" indicator. |
| **Resume** | Resumes from the paused value. |
| **Add time** | Adds 30 seconds (configurable increment). Sends updated `TIMER_TICK`. |
| **Skip timer** | Sets timer to 0, triggering immediate phase advancement. |
| **Set timer** | Override the timer to a specific value (advanced). |

#### Timer Expiry Behavior

| Phase | What happens on timer expiry |
|---|---|
| ROLE_REVEAL | Auto-advance to NIGHT_1 |
| NIGHT (sub-phase) | Current role's action is **skipped** (no-op). Move to next sub-phase. |
| NIGHT (overall) | All remaining sub-phases are skipped. Resolve with submitted actions only. |
| DAWN | Auto-advance to DAY_DISCUSSION |
| DAY_DISCUSSION | Auto-advance to NOMINATION |
| NOMINATION | Close nominations. If any exist, advance to DEFENSE_SPEECH. If none, advance to DUSK. |
| DEFENSE_SPEECH | Current nominee's speech ends. Move to next nominee or DAY_VOTE. |
| DAY_VOTE | All un-cast votes are treated as **abstentions**. Resolve with submitted votes. |
| VOTE_RESULT | Auto-advance to DUSK or GAME_OVER |
| DUSK | Auto-advance to NIGHT |

### 2.5 Phase Transition Triggers

Every phase transition is triggered by exactly one of three mechanisms:

| Mechanism | When it applies |
|---|---|
| **Timer expiry** | Default trigger for all phases. The countdown reaches 0. |
| **Action completion** | All expected actions for the phase have been submitted. Example: all living Werewolves agreed on a target, or all living players have voted. |
| **Moderator advance** | The moderator presses the "Advance Phase" button. This overrides the timer and any incomplete actions. |

**Priority**: Moderator advance > Action completion > Timer expiry. If the moderator advances, any incomplete actions are skipped. If all actions complete, the timer is canceled and the transition happens immediately.

### 2.6 Round Tracking

The game tracks **round numbers** starting at 1. A round consists of one Night + the following Day (through the vote result). The round number increments when transitioning from DUSK to NIGHT.

```
Round 1: Night 1 → Dawn 1 → Day 1 (discuss, nominate, vote) → Dusk 1
Round 2: Night 2 → Dawn 2 → Day 2 → Dusk 2
...
```

The round number is displayed in the UI (e.g., "Night 2", "Day 3") and is used in the game log and timeline.

---

## 3. Night Phase Resolution

### 3.1 Resolution Engine

Night actions are collected during the night phase and resolved **atomically** at the end of the night, in priority order. No action's effect is visible to any player until all actions are resolved and dawn begins.

**Exception**: The Seer's investigation result is delivered immediately to the Seer upon resolution (priority 20), even though other actions haven't resolved yet. This is a UX decision — the Seer's result is private and does not affect other players. If the Seer's target dies later in the same night, the result is still valid (they investigated before the death).

### 3.2 Resolution Priority Table

| Priority | Role | Action | Effect |
|---|---|---|---|
| 5 | Cupid | Link two players as lovers | Creates the lover bond (Night 1 only) |
| 20 | Seer | Investigate target | Returns "Village" or "Werewolf" to the Seer |
| 25 | Bodyguard | Guard target | Marks target as guarded |
| 30 | Doctor | Protect target | Marks target as protected |
| 35 | Alpha Werewolf | Convert target | Changes target's team to Werewolf |
| 40 | Werewolf pack | Kill target | Marks target for death |
| 50 | Witch (heal) | Save Werewolf target | Cancels the Werewolf kill |
| 60 | Witch (kill) | Kill target | Marks another target for death |
| 70 | — | Reserved for future roles | — |
| 80 | — | Reserved for future roles | — |
| 90 | Hunter | Death trigger shot | If Hunter died, shoot a target |
| 95 | Lovers | Heartbreak death | If a lover died, the other dies |
| 100 | — | Final death resolution | All marked-for-death players officially die |
| 110 | — | Win condition check | Check if the game should end |

### 3.3 Resolution Algorithm (Pseudocode)

```
function resolveNight(actions: NightAction[], gameState: GameState):
    // Phase 1: Collect all submitted actions
    actionQueue = sortByPriority(actions)
    
    protectedPlayers = Set()
    guardedPlayers = Map()  // guardedPlayer → bodyguardId
    deaths = []
    conversions = []
    
    for action in actionQueue:
        switch action.type:
            
            case CUPID_LINK (priority 5):
                // Only on Night 1
                gameState.setLovers(action.target1, action.target2)
                notify(action.target1, "You are in love with " + action.target2.name)
                notify(action.target2, "You are in love with " + action.target1.name)
            
            case SEER_INVESTIGATE (priority 20):
                team = getTeamOf(action.target)
                notify(action.actor, "Investigation result: " + team)
                // Seer sees the team AT THIS MOMENT in resolution
                // (before conversions at priority 35)
            
            case BODYGUARD_GUARD (priority 25):
                guardedPlayers.set(action.target, action.actor)
            
            case DOCTOR_PROTECT (priority 30):
                protectedPlayers.add(action.target)
            
            case ALPHA_CONVERT (priority 35):
                if canConvert(action.target):
                    conversions.push(action.target)
                    action.target.team = WEREWOLF
                    action.target.role = WEREWOLF
                    notify(action.target, "You have been converted to a Werewolf")
            
            case WEREWOLF_KILL (priority 40):
                target = action.target
                if protectedPlayers.has(target):
                    // Doctor saved them — kill is nullified
                    log("Doctor saved " + target.name)
                else if guardedPlayers.has(target):
                    // Bodyguard takes the hit
                    bodyguard = guardedPlayers.get(target)
                    deaths.push({ player: bodyguard, cause: 'bodyguard_sacrifice' })
                    log("Bodyguard " + bodyguard.name + " died protecting " + target.name)
                else if target.role == ELDER and target.elderLivesRemaining > 0:
                    target.elderLivesRemaining -= 1
                    log("Elder survived Werewolf attack (lives remaining: " + target.elderLivesRemaining + ")")
                else if conversions.includes(target):
                    // Werewolves "killed" their newly converted ally — cancel
                    log("Werewolf kill cancelled — target was converted")
                else:
                    deaths.push({ player: target, cause: 'werewolf' })
            
            case WITCH_HEAL (priority 50):
                if deaths.find(d => d.player == action.target and d.cause == 'werewolf'):
                    deaths.remove(d => d.player == action.target and d.cause == 'werewolf')
                    log("Witch saved " + action.target.name)
            
            case WITCH_KILL (priority 60):
                deaths.push({ player: action.target, cause: 'witch' })
    
    // Phase 2: Process deaths and chain reactions
    processDeathChain(deaths, gameState)
    
    // Phase 3: Check win conditions
    checkWinConditions(gameState)


function processDeathChain(deaths: Death[], gameState: GameState):
    queue = [...deaths]
    processed = Set()
    
    while queue is not empty:
        death = queue.dequeue()
        if processed.has(death.player):
            continue
        processed.add(death.player)
        
        death.player.isAlive = false
        
        // Hunter death trigger (priority 90)
        if death.player.role == HUNTER:
            hunterTarget = promptHunterShot(death.player)  // 15s timer
            if hunterTarget:
                queue.enqueue({ player: hunterTarget, cause: 'hunter' })
        
        // Lover heartbreak (priority 95)
        lover = gameState.getLover(death.player)
        if lover and lover.isAlive:
            queue.enqueue({ player: lover, cause: 'heartbreak' })
```

### 3.4 Interaction Matrix

This matrix shows what happens when two actions interact on the same target.

| Action A | Action B | Same target? | Result |
|---|---|---|---|
| Werewolf Kill | Doctor Protect | Yes | Target survives. Werewolves not informed. |
| Werewolf Kill | Bodyguard Guard | Yes | Target survives. Bodyguard dies instead. |
| Werewolf Kill | Witch Heal | Yes | Target survives. Witch potion consumed. |
| Werewolf Kill | Witch Kill | Same target | Target dies (Werewolf kill). Witch potion wasted (already dead). |
| Werewolf Kill | Witch Kill | Different targets | Both targets die. |
| Doctor Protect | Witch Kill | Yes | Target dies. Doctor protection does not block Witch kill (default). |
| Doctor Protect | Bodyguard Guard | Same target | Doctor protection takes priority (resolves first). Bodyguard sacrifice not triggered. |
| Witch Heal | Witch Kill | Same target | Target dies. Kill potion overrides heal potion. |
| Seer Investigate | Werewolf Kill | Same target | Seer gets result (investigated first). Target still dies. |
| Seer Investigate | Alpha Convert | Same target | Seer sees "Village" (investigated before conversion resolved). |
| Alpha Convert | Werewolf Kill | Same target | Conversion succeeds. Kill is cancelled (target is now an ally). |
| Hunter Shot | Doctor Protect | Yes | Target dies. Hunter shot is unblockable. |
| Hunter Shot | Bodyguard Guard | Yes | Target dies. Hunter shot is unblockable. Bodyguard is not sacrificed. |
| Any Kill | Lover's partner | — | Lover dies → partner dies of heartbreak (chain). |

### 3.5 Edge Cases in Night Resolution

#### 3.5.1 Seer investigates a player who dies that night

The Seer receives their result normally. The Seer resolves at priority 20, well before deaths at priority 40+. The result is accurate as of the moment of investigation. The Seer is not informed during the night that their target died — they learn at dawn with everyone else.

#### 3.5.2 Doctor protects a player who is not attacked

Nothing happens. The protection is "wasted" but this is not communicated to anyone (not even the Doctor). From the Doctor's perspective, every night is the same — they don't know if their protection was useful.

#### 3.5.3 Bodyguard guards a player who is not attacked

Nothing happens. The Bodyguard survives. Same no-information-leak principle as the Doctor.

#### 3.5.4 Witch heals someone the Doctor already protected

Both protections apply, but only one is needed. The Werewolf kill is cancelled by the Doctor's protection (priority 30, before the Witch's heal at priority 50). The Witch still "uses" their heal potion, because from the Witch's perspective, they were told the Werewolves targeted this player and chose to save them. The server does consume the potion.

**Design rationale**: Not consuming the potion would leak information (the Witch would know the Doctor protected the same target). All information leaks are avoided.

#### 3.5.5 All Werewolves are killed on the same night they kill someone

This cannot happen through normal game mechanics (only Werewolves kill at night, and the Witch kills one player). However, if the Witch kills a Werewolf on the same night the Werewolves kill a Villager, both deaths occur. The win condition is checked after all deaths resolve. If the last Werewolf dies, the Village wins — even though a Villager also died that night.

#### 3.5.6 Werewolves target a Werewolf (invalid)

The server rejects this action. The Werewolf UI only shows non-Werewolf players as valid targets. If a malicious client sends this action, the server returns an error and the Werewolves must re-select.

#### 3.5.7 The night produces no deaths

Perfectly valid. The dawn announcement says "The village awakes. A peaceful night — no one died." This can happen if:
- The Doctor protected the Werewolf target.
- The Witch healed the Werewolf target.
- The Bodyguard guarded the Werewolf target (but the Bodyguard dies — so this doesn't apply).
- The Elder survived their first attack.

#### 3.5.8 Multiple deaths in one night

Possible through:
- Werewolf kill + Witch kill = 2 deaths
- Werewolf kill + Witch kill + Hunter chain + Lover heartbreak = up to 4+ deaths
- All deaths are announced at dawn, in order of cause: Werewolf → Witch → Hunter → Heartbreak.

---

## 4. Voting System

### 4.1 Voting Modes

The game supports two voting modes, selectable in game configuration:

| Mode | Description | Default |
|---|---|---|
| **Open ballot** | Each player's vote is visible to all players in real-time as they cast it. | ❌ |
| **Secret ballot** | Votes are hidden until all votes are in (or timer expires). Only the total tally is revealed. | ✅ (default) |

In **secret ballot** mode:
- Players see a progress bar showing how many votes have been cast (e.g., "5/8 votes cast") but not who voted for what.
- The moderator can see individual votes in real-time (in the moderator panel).
- After the vote concludes, the tally is revealed (Guilty: X, Innocent: Y / votes per nominee).
- Individual vote records can optionally be revealed (configurable: "Reveal individual votes after tally", default: off).

In **open ballot** mode:
- Each vote is announced as it is cast: "Ali voted Guilty."
- This creates social pressure and is closer to the in-person experience.

### 4.2 Voting Formats

The voting format depends on the number of nominees:

#### Single Nominee (Binary Vote)

Players vote **Guilty** or **Innocent** (or abstain, if allowed).

**Elimination threshold** (configurable):

| Setting | Description | Default |
|---|---|---|
| **Simple majority** | More Guilty than Innocent (>50% of votes cast, excluding abstentions) | ✅ (default) |
| **Absolute majority** | Guilty votes > 50% of all living players (not just those who voted) | ❌ |
| **Supermajority** | Guilty votes ≥ 2/3 of votes cast | ❌ |

If the threshold is not met, the nominee survives and the village moves to DUSK with no elimination.

#### Multiple Nominees (Plurality Vote)

Players vote for **one nominee** (or abstain). The nominee with the most votes is eliminated.

**Elimination requirement**: The leading nominee must have **strictly more votes** than any other nominee. In case of a tie, tie-breaking rules apply (§4.5).

**Minimum vote threshold** (configurable, default: off): If enabled, the leading nominee must have at least N votes (or N% of living players) to be eliminated. This prevents elimination with very few votes.

### 4.3 Nomination Mechanics (Detailed)

```
State Machine for Nomination:

    OPEN
      │
      ├── Player A nominates Player B → PENDING_SECOND(A→B)
      │     │
      │     ├── Player C seconds → CONFIRMED(B is nominated)
      │     │     │
      │     │     └── Nomination limit reached? → Close nominations
      │     │
      │     └── 15s timer expires without second → LAPSED (return to OPEN)
      │
      ├── Timer expires → Close nominations
      │
      └── Moderator advances → Close nominations
```

**Rules**:
- A player cannot be nominated more than once in the same round.
- A player cannot nominate themselves.
- A player cannot second their own nomination (i.e., Player A nominates Player B, Player A cannot second it).
- The nominee cannot nominate anyone while they are nominated (they are on the defensive).
- Dead players cannot nominate or second.
- Players can only nominate **living** players.
- The number of nominations is limited (configurable, default: 2 per round).

### 4.4 Defense Speech Mechanics

After nominations close and before voting:

1. Each nominee is given a timed opportunity to defend themselves.
2. The defense order matches the nomination order.
3. During a nominee's defense:
   - Only the nominee can send chat messages (if digital chat is used).
   - The nominee's card is highlighted in the UI.
   - Other players see a "listening" state.
4. The moderator can extend or cut short a defense speech.
5. A nominee may choose to **remain silent** (skip their defense). They can tap "Skip" to end their defense early.

### 4.5 Tie-Breaking Rules

Ties can occur in multiple-nominee votes or in single-nominee votes (equal Guilty and Innocent).

**Configurable tie-breaking strategies**:

| Strategy | Description | Default |
|---|---|---|
| **No elimination** | A tie means no one is eliminated. The village moves to DUSK. | ✅ (default) |
| **Runoff vote** | The tied nominees face a second vote (single round, no further ties — if the runoff also ties, no elimination). | ❌ |
| **Moderator decides** | The moderator breaks the tie by choosing which nominee (if any) is eliminated. | ❌ |
| **Random** | One of the tied nominees is randomly eliminated. | ❌ |

**Implementation — Runoff vote**:
1. If the initial vote results in a tie between N nominees, a RUNOFF_VOTE phase is inserted.
2. Only the tied nominees are on the ballot.
3. Players have 20 seconds to vote (shorter than the initial vote).
4. Abstaining players from the original vote can vote in the runoff.
5. If the runoff also ties, no elimination occurs (no infinite runoff loops).
6. Maximum one runoff per day.

### 4.6 Abstention Rules

| Setting | Effect |
|---|---|
| **Abstention allowed** (default: yes) | Players may choose not to vote. Their non-vote does not count toward any total. |
| **Forced vote** (configurable) | Players must vote. If the timer expires without a vote, a random vote is cast for them (NOT abstention). |
| **Abstention counts as Innocent** (configurable) | In binary votes, abstentions are treated as "Innocent" votes. |

### 4.7 Who Can Vote

| Player status | Can vote? |
|---|---|
| Alive, not nominated | ✅ Yes |
| Alive, nominee | Configurable (default: **no** — nominees cannot vote on their own fate) |
| Dead | ❌ No |
| Disconnected (alive) | Treated as abstention (or auto-skip after timer) |
| Village Idiot (revealed) | ❌ No (lost voting rights) |
| Lover (voting against partner) | ❌ No (server rejects) |

### 4.8 Vote Cancellation

Once a player casts a vote, it is **locked** (they cannot change it). This is by design — it prevents flip-flopping and social pressure manipulation.

**Configurable alternative**: "Allow vote changes" (default: off). If enabled, players can change their vote until the timer expires. Only their final vote counts.

### 4.9 What Happens if No One is Eliminated

If a day round produces no elimination (no nominations, tied vote, insufficient majority):

- The announcement says "The village could not reach a decision. No one is eliminated."
- The game proceeds to DUSK → NIGHT normally.
- No penalty is applied.
- A configurable **no-elimination limit** (default: off) can be set: if N consecutive days produce no elimination, the game ends in a draw (or the moderator is warned). This prevents infinite stalemates.

---

## 5. Win Conditions

### 5.1 Win Condition Definitions

| Condition | Winner | Description |
|---|---|---|
| **All Werewolves dead** | Village | Every player with team=Werewolf is dead. |
| **Werewolves ≥ Village** | Werewolf | Living Werewolf-team players ≥ living Village-team players. (They can openly overpower the village.) |
| **Tanner executed** | Tanner | The Tanner is eliminated during a day vote. |
| **Jester executed** | Jester | The Jester is eliminated during a day vote. (Game may or may not end — see config.) |
| **Lovers are last two alive** | Lovers (+ Cupid) | Cross-team lovers survive to be the final two players. |
| **Draw** | None | Configurable draw condition (see §5.5). |

### 5.2 When Win Conditions Are Checked

Win conditions are checked at these **exact moments** (checkpoints), in order:

1. **After every death is fully resolved** (including chain deaths from Hunter shots and lover heartbreak).
2. Specifically:
   - After night death resolution (end of night, after all chains resolve).
   - After day vote elimination (after the execution and all resulting chain deaths).
   - After Hunter shot resolution (if the Hunter's shot kills someone, re-check).
   - After Jester retribution (if the Jester's revenge kill triggers more deaths).

**Checking algorithm**:

```
function checkWinConditions(gameState: GameState): WinResult | null:
    aliveWerewolves = count(alive players where team == WEREWOLF)
    aliveVillagers = count(alive players where team == VILLAGE)
    aliveNeutrals = count(alive players where team == NEUTRAL)
    
    // Check Tanner win (highest priority among special wins)
    if lastElimination.cause == 'vote' and lastElimination.player.role == TANNER:
        if config.tannerWinEndsGame:
            return { winner: TANNER, player: lastElimination.player }
    
    // Check Jester win
    if lastElimination.cause == 'vote' and lastElimination.player.role == JESTER:
        if config.jesterWinEndsGame:
            return { winner: JESTER, player: lastElimination.player }
    
    // Check Lovers win (cross-team lovers)
    if gameState.hasLovers():
        alivePlayers = getAllAlivePlayers()
        if alivePlayers.length == 2 and alivePlayers are the lovers:
            if lovers are on different teams:
                return { winner: LOVERS }
    
    // Check Village win
    if aliveWerewolves == 0:
        return { winner: VILLAGE }
    
    // Check Werewolf win
    if aliveWerewolves >= aliveVillagers + aliveNeutrals:
        return { winner: WEREWOLF }
    
    // Game continues
    return null
```

### 5.3 Village Win — Detailed

The Village wins when **all Werewolf-team players are dead**. This includes:
- Base Werewolves
- Alpha Werewolf
- Any converted Werewolves (originally Village, but now on the Werewolf team)

The Village does **not** need all Villagers to survive. Even if only one Villager remains, the Village wins as long as no Werewolves are alive.

**What about Neutral players?** Neutral players (Tanner, Jester) are not counted for either team's win condition. If all Werewolves are dead and only Villagers + Neutrals remain, the Village wins. The Neutral players lose (unless they achieved their personal win condition).

### 5.4 Werewolf Win — Detailed

The Werewolves win when **the number of living Werewolf-team players is greater than or equal to the number of living non-Werewolf players**.

Formally: `aliveWerewolves >= (aliveVillagers + aliveNeutrals)`

**Why ≥ and not >?** When Werewolves equal Villagers, the Werewolves can block any vote (they vote as a block to protect each other). The Village can no longer eliminate Werewolves through voting. The game is functionally over.

**Example**:
- 2 Werewolves alive, 2 Villagers alive → Werewolf win.
- 2 Werewolves alive, 3 Villagers alive → Game continues.
- 1 Werewolf alive, 1 Villager alive → Werewolf win.

### 5.5 Draw Conditions

Draws are rare but possible:

| Scenario | Result |
|---|---|
| All players dead (e.g., complex chain of Hunter + Lover deaths) | Draw |
| No-elimination limit reached (configurable) | Draw |
| All Werewolves and all Village players die simultaneously | Draw |

**Configurable**: "Allow draws" (default: yes). If disabled, the game continues until one team wins, even if it takes many rounds.

### 5.6 Exact Moment of Game End

When a win condition is met:

1. The current phase completes its death resolution (all chains finish).
2. The game state transitions to GAME_OVER.
3. No further phases are played. The night does not continue. The day does not continue.
4. The GAME_OVER screen is shown immediately.

**Example — Werewolf killed at night by Witch**:
1. Night resolution: Werewolves kill Player A. Witch kills Werewolf B (the last Werewolf).
2. Death chains resolve: Player A dies (if they're a Hunter, their shot resolves too). Werewolf B dies.
3. Win condition check: 0 living Werewolves → Village wins.
4. Game ends. Dawn does not play its full animation. Instead, the win announcement is shown at dawn.

**Example — Day vote eliminates last Werewolf**:
1. Vote result: Werewolf C is eliminated.
2. Chain deaths: If Werewolf C had a lover, the lover dies. If the lover was the Hunter, the Hunter shoots. Etc.
3. Win condition check after all chains: 0 living Werewolves → Village wins.
4. Game ends immediately.

---

## 6. Edge Cases & Error Handling

### 6.1 Player Disconnection Mid-Game

#### Detection

- The WebSocket connection drops (no heartbeat response for 3 consecutive pings at 5-second intervals = 15 seconds timeout).
- The server marks the player as `isConnected: false`.
- All clients receive `PLAYER_DISCONNECTED { playerId }`.

#### Effects During Night

- If the disconnected player has a night action pending, their action is treated as **skipped** when their sub-phase timer expires. The night proceeds.
- If the disconnected player is a Werewolf, the remaining Werewolves can still act. The disconnected Werewolf's "vote" on the kill target is not counted.
- If the disconnected player is the **only** Werewolf, see §6.4.

#### Effects During Day

- The disconnected player cannot participate in discussion, nomination, or voting.
- Their vote is treated as an **abstention**.
- They can still be nominated and voted upon.
- They cannot give a defense speech (auto-skipped with a message: "[Player] is not available to defend themselves.").

#### Reconnection

- The player reconnects by sending a `REJOIN` message with their `gameId`, `playerId`, and `lastSeqNum`.
- The server validates the rejoin (matching game and player records).
- The server sends a full `STATE_SNAPSHOT` with the current game state.
- The player resumes as if they never left (their turn may have passed).
- If the player reconnects during their own action phase (e.g., it's the Seer's turn and the Seer reconnects), they can still act if the timer hasn't expired.

#### Permanent Disconnection

- If a player is disconnected for more than **5 minutes** (configurable), they are marked as `ABANDONED`.
- The moderator receives a notification: "[Player] has been disconnected for 5 minutes."
- The moderator can choose to:
  1. **Wait** — keep the game paused or continue without them.
  2. **Replace** — allow a new player to take over the disconnected player's role (spectator promotion).
  3. **Remove** — mark the player as dead (treated as if they left the game). Their role is not revealed. The game continues.
- If "Auto-remove disconnected players" is enabled (default: off), the player is automatically removed after the timeout.

### 6.2 Moderator Disconnection

The moderator is also a player, so they can disconnect like any other player. However, the moderator has additional responsibilities.

**What happens**:
1. The game continues automatically. Timers and phase transitions are server-driven, not moderator-driven. The moderator's absence does not block the game.
2. The moderator's player-role actions (e.g., if they're a Werewolf, their kill vote) are treated as skipped on timer expiry, same as any other player.
3. The moderator's administrative functions (advance phase, adjust timer) are unavailable while disconnected.
4. If the moderator does not reconnect within 2 minutes, a warning is shown to all players: "The moderator is disconnected. The game will continue automatically."
5. If the moderator does not reconnect within 10 minutes (configurable), **moderator powers are transferred** to the next player in join order who is still connected. That player receives a notification: "You are now the moderator." Their role does not change.

**Moderator transfer rules**:
- The new moderator inherits all moderator capabilities (see all roles, advance phases, etc.).
- The original moderator, upon reconnecting, can reclaim moderator status (the server sends a prompt to the current moderator to confirm transfer back).
- Only one moderator exists at a time.

### 6.3 All Werewolves Disconnected During Night

This is a critical edge case that could stall the game.

**Resolution**:
1. The Werewolf sub-phase timer runs as normal.
2. When the timer expires with no Werewolf action submitted, the Werewolf kill is **skipped** for this night. No one is killed by Werewolves.
3. Dawn announcement: "The village awakes. A peaceful night — no one died." (Same as Doctor save, to avoid revealing that the Werewolves disconnected.)
4. The game continues normally.
5. If all Werewolves remain disconnected for multiple rounds, the moderator is notified and can pause the game or remove the disconnected Werewolves (which would trigger a Village win).

### 6.4 Timer Expiry With No Action (Auto-Skip)

Each role action has a specific default when the timer expires:

| Role | Timer expiry behavior |
|---|---|
| **Werewolves** | If at least one Werewolf selected a target but not all confirmed, the most-voted target is chosen. If no Werewolf selected anyone, the kill is skipped (no one dies). |
| **Seer** | Investigation is skipped. The Seer learns nothing this night. |
| **Doctor** | Protection is skipped. No one is protected. |
| **Bodyguard** | Guard is skipped. No one is guarded. |
| **Witch** | Both potions are skipped (not used). |
| **Cupid (Night 1)** | No lovers are created. Cupid functions as a Villager for the rest of the game. |
| **Alpha Werewolf (convert)** | Conversion is skipped. The ability is not consumed (they can try again next night). |
| **Hunter (death shot)** | A random living player is selected as the shot target. This is the only action with a random default, because the Hunter shot is mandatory. |
| **Day vote** | Uncast votes are treated as abstentions. |

### 6.5 Invalid Actions

All actions are validated server-side. The client UI should prevent most invalid actions, but the server is the ultimate authority.

| Invalid action | Server response | Client prevention |
|---|---|---|
| Targeting a dead player | `ERROR: TARGET_DEAD` | Dead players are not selectable in the UI |
| Voting for self (day vote) | Depends on config (allowed by default, rejected if "nominees cannot vote" is on) | UI hides self from ballot if configured |
| Werewolf targeting another Werewolf | `ERROR: INVALID_TARGET` | Only non-Werewolves shown in target list |
| Doctor self-protecting twice | `ERROR: SELF_PROTECT_LIMIT` | Self option disabled after first use |
| Doctor protecting same player consecutively | `ERROR: CONSECUTIVE_PROTECT` | Previous target disabled in UI |
| Witch using a spent potion | `ERROR: POTION_SPENT` | Button disabled after use |
| Dead player attempting any action | `ERROR: PLAYER_DEAD` | Action panel shows spectator mode |
| Non-moderator using moderator commands | `ERROR: NOT_MODERATOR` | Moderator controls only rendered for moderator |
| Action submitted outside the correct phase | `ERROR: WRONG_PHASE` | Buttons disabled outside relevant phase |
| Lover voting against partner | `ERROR: LOVER_RESTRICTION` | Partner's card not selectable during vote |
| Cupid selecting on Night 2+ | `ERROR: CUPID_NIGHT_1_ONLY` | No action prompt after Night 1 |
| Nominating a player who was already nominated this round | `ERROR: ALREADY_NOMINATED` | Already-nominated players not selectable |

### 6.6 What Happens When the Moderator is a Werewolf

This is a core design feature, not a bug. The moderator-as-player can be assigned any role, including Werewolf.

**Mechanics**:
- The moderator who is a Werewolf sees the full Werewolf action panel during the night (select a kill target, wolf chat).
- They also see the moderator panel overlay showing all other night actions (Seer investigation, Doctor protection, etc.).
- This creates a significant information advantage for the Werewolves, which is acknowledged as a design tradeoff.

**Mitigations** (configurable):
1. **"Moderator excluded from Werewolf assignment"** (default: off): If enabled, the moderator is guaranteed a Village-aligned role. This removes the conflict of interest.
2. **"Blind moderator night"** (default: off): If enabled, the moderator cannot see night action details in the moderator panel. They can still advance phases and manage timers, but the role actions are hidden with a message: "Night actions are hidden for fairness." This allows the moderator to be a Werewolf without an unfair advantage.
3. **"Full trust moderator"** (default: on): The moderator sees everything and is trusted not to abuse the information. This is the traditional in-person Werewolf experience, where the moderator literally calls out each role.

**Integrity concern**: In competitive games, the moderator should be excluded from Werewolf assignment or the "Blind moderator night" setting should be enabled. In casual/party games, full trust mode is fine.

### 6.7 Hunter's Last Shot — Timing Edge Cases

The Hunter's shot creates the most complex timing scenarios. Here is a definitive ruling for each:

| Scenario | Resolution |
|---|---|
| Hunter killed by Werewolves at night | Shot resolves during night resolution (priority 90), before dawn. Both the Hunter and their target are announced as dead at dawn. |
| Hunter killed by Witch at night | Same as above. Shot resolves at priority 90. |
| Hunter killed by day vote | Shot resolves immediately after vote result is displayed, before the DUSK phase. The game pauses for the Hunter to choose a target (15s timer). |
| Hunter killed by Hunter (chain) | Second Hunter's shot triggers after the first Hunter's shot resolves. Both Hunters are dead. Chain continues until no more Hunters die. |
| Hunter killed by Jester retribution | Shot resolves after the Jester's kill. The Hunter can shoot any living player (including the Jester, who is already dead — in this case, the server rejects the target and prompts for a new one). |
| Hunter kills a lover → Heartbreak | The lover's partner dies. If the partner is also a Hunter, their shot triggers (chain). |
| Hunter is a lover; Hunter's partner dies | Hunter dies of heartbreak. Hunter's shot triggers (the Hunter is dying, which triggers the shot, regardless of the cause of death). |
| Hunter disconnected when shot is due | Random target is selected (mandatory shot). |
| Hunter targets themselves | Server rejects (Hunter is already dead). Prompted to choose a valid target. |

### 6.8 Simultaneous Deaths and Order of Announcements

When multiple players die in the same night:

**Announcement order**:
1. Werewolf kill victim(s)
2. Witch kill victim (if different from Werewolf target)
3. Bodyguard sacrifice
4. Hunter shot victim
5. Lover heartbreak victim(s)

Each death is announced separately with a short delay (1 second between announcements) for dramatic effect. The order is cosmetic — all deaths happened simultaneously in the game logic.

### 6.9 Player Tries to Leave the Game Voluntarily

If a player closes their browser or navigates away:

1. The WebSocket disconnects. Same flow as §6.1.
2. The player can return to the game URL and rejoin.
3. If they don't return, the standard disconnection timeout applies.
4. There is no explicit "Leave Game" button during an active game. The only way to leave is to close the browser.

**Before the game starts (lobby)**: A player can leave the lobby freely. Their slot opens up for another player. The player is removed from the player list. If the moderator leaves the lobby, the game room is closed (or moderator is transferred if "transfer moderator on leave" is enabled).

### 6.10 Stalemate Detection

The server detects potential stalemates:

| Scenario | Detection | Action |
|---|---|---|
| Only 1 Werewolf and 1 Villager remain | Win condition met (Werewolf wins, 1 ≥ 1) | Game ends |
| 2 Village-aligned players with no power vs 1 Werewolf | Game continues (village could vote out the Werewolf) | No action |
| Multiple consecutive days with no elimination and no night kills | After N rounds with no deaths (configurable, default: 3), moderator is warned: "Stalemate risk detected" | Moderator may intervene or the game can auto-draw |
| All Village players are Village Idiots who have been revealed (no voting power) | Win condition check: Werewolves ≥ effective Village voters → Werewolf win | Game ends |

---

## 7. Role Balance Tables

### 7.1 Balance Philosophy

The game's balance targets a **slight Village advantage** (Village should win ~55% of games with perfect play). This compensates for the Werewolves' inherent information advantage (they know each other).

**Key balance principles**:
- The Werewolf-to-player ratio should be approximately 1:3.5 to 1:4.
- Every game should have at least one Village information role (Seer or equivalent).
- Protective roles (Doctor, Bodyguard) scale with player count — more players means more value from protection.
- Chaos roles (Tanner, Jester, Cupid) should only be added at 8+ players to avoid overwhelming smaller games.

### 7.2 Recommended Distributions

#### Standard Mode (Recommended for most games)

| Players | Werewolves | Seer | Doctor | Other Village Special | Villagers | Notes |
|---|---|---|---|---|---|---|
| **6** | 1 | 1 | 1 | — | 3 | Tight game. One Werewolf must be very convincing. |
| **7** | 2 | 1 | 1 | — | 3 | Classic small game. |
| **8** | 2 | 1 | 1 | Hunter | 3 | Hunter adds a safety net for the Village. |
| **9** | 2 | 1 | 1 | Hunter | 4 | Balanced mid-size game. |
| **10** | 2 | 1 | 1 | Hunter, Witch | 4 | Witch adds complexity. Two powerful Village specials. |
| **11** | 3 | 1 | 1 | Hunter, Witch | 4 | Third Werewolf needed. Village has strong specials. |
| **12** | 3 | 1 | 1 | Hunter, Witch, Cupid | 4 | Cupid adds lover dynamics. |
| **13** | 3 | 1 | 1 | Hunter, Witch, Bodyguard | 5 | Bodyguard provides redundant protection. |
| **14** | 4 | 1 | 1 | Hunter, Witch, Bodyguard | 5 | Four Werewolves for large games. |
| **15** | 4 | 1 | 1 | Hunter, Witch, Bodyguard, Cupid | 5 | Maximum standard game. |

#### Advanced Mode (With Neutral Roles)

| Players | Werewolves | Seer | Doctor | Other Village | Neutral | Villagers |
|---|---|---|---|---|---|---|
| **8** | 2 | 1 | 1 | — | Tanner | 3 |
| **9** | 2 | 1 | 1 | Hunter | Tanner | 3 |
| **10** | 2 | 1 | 1 | Hunter, Witch | Tanner | 3 |
| **11** | 3 | 1 | 1 | Hunter | Tanner | 4 |
| **12** | 3 | 1 | 1 | Hunter, Witch | Jester | 4 |
| **13** | 3 | 1 | 1 | Hunter, Witch, Bodyguard | Tanner | 4 |
| **14** | 4 | 1 | 1 | Hunter, Witch | Jester | 4 |
| **15** | 4 | 1 | 1 | Hunter, Witch, Bodyguard | Tanner | 4 |

#### With Alpha Werewolf (Replaces one Werewolf)

| Players | Alpha WW | Werewolves | Seer | Doctor | Other Village | Villagers |
|---|---|---|---|---|---|---|
| **10+** | 1 | 1 (10–11) or 2 (12–13) or 3 (14–15) | 1 | 1 | Hunter, +Witch at 11+ | Fill |

The Alpha Werewolf replaces one standard Werewolf — the total Werewolf count (Alpha + standard) stays the same as the standard table.

### 7.3 Balance Scoring System

The server calculates a **balance score** for any custom role configuration. This helps the moderator understand if their setup is balanced.

**Formula**:

```
Village Power  = sum of Village role values
Werewolf Power = sum of Werewolf role values
Balance Score  = Village Power / (Village Power + Werewolf Power)

Target: 0.50–0.60 (slight Village advantage)
```

**Role power values** (empirically tuned):

| Role | Power Value | Team |
|---|---|---|
| Villager | 1.0 | Village |
| Seer | 3.5 | Village |
| Doctor | 2.5 | Village |
| Hunter | 2.0 | Village |
| Witch | 3.0 | Village |
| Bodyguard | 2.0 | Village |
| Cupid | 1.0 | Village (but unpredictable) |
| Elder | 1.5 | Village |
| Village Idiot | 0.5 | Village |
| Werewolf | 4.0 | Werewolf |
| Alpha Werewolf | 5.5 | Werewolf |
| Tanner | −0.5 | Neutral (hurts Village — distraction) |
| Jester | −0.5 | Neutral (hurts Village — retribution) |

**Score interpretation**:

| Score | Label | Color |
|---|---|---|
| < 0.40 | Strongly Werewolf-favored | 🔴 Red |
| 0.40–0.45 | Werewolf-favored | 🟠 Orange |
| 0.45–0.50 | Slightly Werewolf-favored | 🟡 Yellow |
| 0.50–0.60 | Balanced | 🟢 Green |
| 0.60–0.65 | Slightly Village-favored | 🟡 Yellow |
| 0.65–0.70 | Village-favored | 🟠 Orange |
| > 0.70 | Strongly Village-favored | 🔴 Red |

The balance score is shown in the lobby's role configuration panel with a visual gauge and a text label.

### 7.4 Minimum/Maximum Role Counts

| Role | Min | Max | Notes |
|---|---|---|---|
| Werewolf (total, including Alpha) | 1 | ⌊players ÷ 3⌋ | At least 1, never more than 1/3 of players |
| Seer | 0 | 1 | Multiple Seers would be overpowered |
| Doctor | 0 | 1 | Multiple Doctors would be overpowered |
| Hunter | 0 | 1 | Multiple allowed in custom mode but not recommended |
| Witch | 0 | 1 | One Witch per game |
| Bodyguard | 0 | 1 | Doctor + Bodyguard is already very strong |
| Cupid | 0 | 1 | Multiple Cupids would create confusing love triangles |
| Elder | 0 | 1 | |
| Village Idiot | 0 | 1 | |
| Alpha Werewolf | 0 | 1 | Replaces one Werewolf |
| Tanner | 0 | 1 | Exclusive with Jester |
| Jester | 0 | 1 | Exclusive with Tanner |
| Villager | 0 | ∞ | Fills remaining slots |

**Validation rules enforced at game start**:
1. Total assigned roles must equal the number of players.
2. Werewolf count must be ≥ 1 and ≤ ⌊players ÷ 3⌋.
3. Tanner and Jester cannot both be included.
4. The game must have at least 2 distinct teams (e.g., at least 1 Village and 1 Werewolf).
5. The total Werewolf power should not exceed 50% of total power (warn but allow).

---

## 8. Game Configuration Options

### 8.1 Configuration Categories

All settings are organized into three categories visible in the lobby configuration panel:

| Category | Description |
|---|---|
| **Basic** | Settings visible in Simple Mode. These cover the essentials and are suitable for casual players. |
| **Advanced** | Settings visible in Advanced Mode. These cover all role-specific and gameplay-variant options. |
| **Hidden/Internal** | Server-side settings not exposed in the UI. Used for debugging or tournament play. |

### 8.2 Complete Configuration Table

#### Role Configuration (Basic)

| Setting | Type | Default | Range/Options | Category |
|---|---|---|---|---|
| `werewolfCount` | integer | Auto (see §7.2) | 1 – ⌊players/3⌋ | Basic |
| `seerEnabled` | boolean | true | — | Basic |
| `doctorEnabled` | boolean | true | — | Basic |
| `hunterEnabled` | boolean | false | — | Basic |
| `witchEnabled` | boolean | false | — | Advanced |
| `bodyguardEnabled` | boolean | false | — | Advanced |
| `cupidEnabled` | boolean | false | — | Advanced |
| `elderEnabled` | boolean | false | — | Advanced |
| `villageIdiotEnabled` | boolean | false | — | Advanced |
| `alphaWerewolfEnabled` | boolean | false | — | Advanced |
| `tannerEnabled` | boolean | false | — | Advanced |
| `jesterEnabled` | boolean | false | — | Advanced |

#### Timer Configuration (Basic)

| Setting | Type | Default | Range | Category |
|---|---|---|---|---|
| `nightSubPhaseDuration` | seconds | 20 | 10–60 | Advanced |
| `werewolfNightDuration` | seconds | 30 | 15–60 | Basic |
| `discussionDuration` | seconds | 180 | 60–600 | Basic |
| `nominationDuration` | seconds | 60 | 30–180 | Advanced |
| `defenseSpeechDuration` | seconds | 30 | 15–120 | Advanced |
| `voteDuration` | seconds | 30 | 15–60 | Basic |
| `hunterShotDuration` | seconds | 15 | 10–30 | Advanced |
| `jesterRetributionDuration` | seconds | 15 | 10–30 | Advanced |

#### Voting Configuration

| Setting | Type | Default | Options | Category |
|---|---|---|---|---|
| `votingMode` | enum | `secret` | `secret`, `open` | Basic |
| `eliminationThreshold` | enum | `simple_majority` | `simple_majority`, `absolute_majority`, `supermajority` | Advanced |
| `tieBreaker` | enum | `no_elimination` | `no_elimination`, `runoff`, `moderator_decides`, `random` | Advanced |
| `allowAbstention` | boolean | true | — | Advanced |
| `nomineesCanVote` | boolean | false | — | Advanced |
| `maxNomineesPerRound` | integer | 2 | 1–5 | Advanced |
| `allowVoteChange` | boolean | false | — | Advanced |
| `revealIndividualVotes` | boolean | false | — | Advanced |
| `requiredToVote` | boolean | false | — | Advanced |

#### Gameplay Configuration

| Setting | Type | Default | Options | Category |
|---|---|---|---|---|
| `revealRoleOnDeath` | enum | `role` | `role`, `team`, `none` | Basic |
| `werewolvesKillNight1` | boolean | true | — | Advanced |
| `seerActiveNight1` | boolean | true | — | Advanced |
| `witchActiveNight1` | boolean | true | — | Advanced |
| `doctorSelfProtectLimit` | integer | 1 | 0 (unlimited), 1, 2 | Advanced |
| `doctorConsecutiveProtect` | boolean | false | — | Advanced |
| `witchBothPotionsSameNight` | boolean | false | — | Advanced |
| `doctorBlocksAllKills` | boolean | false | — | Advanced |
| `parallelNightActions` | boolean | false | — | Advanced |
| `tannerWinEndsGame` | boolean | true | — | Advanced |
| `jesterWinEndsGame` | boolean | false | — | Advanced |
| `wolfChatDuringDay` | boolean | false | — | Advanced |
| `deadPlayersCanChat` | boolean | false | — | Advanced |
| `noEliminationLimit` | integer | 0 (off) | 0–10 | Hidden |
| `stalemateDetectionRounds` | integer | 3 | 1–10 | Hidden |

#### Moderator Configuration

| Setting | Type | Default | Options | Category |
|---|---|---|---|---|
| `moderatorExcludedFromWerewolf` | boolean | false | — | Advanced |
| `blindModeratorNight` | boolean | false | — | Advanced |
| `moderatorAutoAdvance` | boolean | true | — | Advanced |
| `moderatorTransferTimeout` | seconds | 600 | 120–1800 | Hidden |
| `disconnectionTimeout` | seconds | 300 | 60–900 | Advanced |
| `autoRemoveDisconnected` | boolean | false | — | Advanced |

#### Player Configuration

| Setting | Type | Default | Range | Category |
|---|---|---|---|---|
| `minPlayers` | integer | 6 | 5–8 | Hidden |
| `maxPlayers` | integer | 15 | 10–20 | Hidden |

### 8.3 Simple Mode vs Advanced Mode

The lobby configuration panel has a toggle: **Simple Mode** (default) / **Advanced Mode**.

**Simple Mode** shows only:
- Werewolf count (stepper)
- Seer, Doctor, Hunter toggles
- Discussion time (slider)
- Voting time (slider)
- Voting mode (secret/open)
- Role reveal on death (toggle)

All other settings use their defaults.

**Advanced Mode** reveals all Basic + Advanced settings, organized in collapsible sections:
- Role Configuration
- Timer Configuration
- Voting Rules
- Gameplay Variants
- Moderator Options

**Hidden/Internal** settings are never shown in the UI. They can only be changed via the game creation API (for tournament/admin use).

### 8.4 Configuration Validation

When the moderator presses "Start Game," the server validates the configuration:

| Validation | Error message |
|---|---|
| Total roles ≠ player count | "Role count (X) does not match player count (Y). Add/remove roles." |
| Werewolf count = 0 | "At least one Werewolf is required." |
| Werewolf count > ⌊players/3⌋ | "Too many Werewolves (max: X for Y players)." |
| No Village roles | "At least one Village-aligned role is required." |
| Tanner + Jester both enabled | "Tanner and Jester cannot both be in the same game." |
| Player count < minPlayers | "Need at least X players to start." |
| Player count > maxPlayers | "Maximum X players allowed." |
| Alpha Werewolf enabled but werewolfCount < 1 | "Alpha Werewolf requires at least one additional Werewolf." — actually, Alpha alone is valid. No error. |

On validation failure, the "Start Game" button remains disabled and the error message is shown below the button.

### 8.5 Configuration Persistence

- Game configurations are stored on the server, keyed by the game room ID.
- When a moderator creates a game, their last-used configuration is loaded as the default (stored in the browser's `localStorage` under `traitors_last_config`).
- Configurations can be exported/imported as JSON for tournament organizers.

### 8.6 Preset Configurations

The lobby offers **preset configurations** for quick setup:

| Preset | Description | Key settings |
|---|---|---|
| **Classic** | Traditional Werewolf, minimal roles | Seer + Doctor + Werewolves + Villagers. Secret vote. Roles revealed on death. |
| **Extended** | Full special roles | All standard roles enabled based on player count (per §7.2). |
| **Chaos** | Maximum unpredictability | Cupid + Witch + Hunter + Tanner/Jester. Wolf chat during day. |
| **Competitive** | Balanced for serious play | Moderator excluded from Werewolf. Blind moderator night. Absolute majority vote. No role reveal on death. |
| **Quick** | Short game sessions | Short timers (discussion 60s, vote 15s). Parallel night actions. |
| **Custom** | Player-defined | All settings editable. |

---

## Appendix A: Complete TypeScript Type Definitions

These types complement the types defined in `FRONTEND_ARCHITECTURE.md` §4 and provide the full game logic type system.

```typescript
// ── Teams ──

type Team = 'village' | 'werewolf' | 'neutral';

// ── Roles ──

type Role =
  | 'villager'
  | 'werewolf'
  | 'alpha_werewolf'
  | 'seer'
  | 'doctor'
  | 'hunter'
  | 'witch'
  | 'bodyguard'
  | 'cupid'
  | 'elder'
  | 'village_idiot'
  | 'tanner'
  | 'jester';

interface RoleDefinition {
  id: Role;
  name: string;
  team: Team;
  nightActionPriority: number | null;  // null = no night action
  description: string;
  abilityDescription: string | null;
  appearsToSeerAs: Team;
  icon: string;
  maxCount: number;
}

// ── Phases ──

type Phase =
  | 'lobby'
  | 'role_reveal'
  | 'night'
  | 'dawn'
  | 'day_discussion'
  | 'nomination'
  | 'defense_speech'
  | 'day_vote'
  | 'runoff_vote'
  | 'vote_result'
  | 'dusk'
  | 'game_over';

type NightSubPhase =
  | 'cupid'
  | 'seer'
  | 'bodyguard'
  | 'doctor'
  | 'alpha_convert'
  | 'werewolf_kill'
  | 'witch_heal'
  | 'witch_kill';

// ── Night Actions ──

type NightActionType =
  | 'cupid_link'
  | 'seer_investigate'
  | 'bodyguard_guard'
  | 'doctor_protect'
  | 'alpha_convert'
  | 'werewolf_kill'
  | 'witch_heal'
  | 'witch_kill';

interface NightAction {
  type: NightActionType;
  actorId: string;
  targetId: string | null;       // null = skipped
  secondTargetId?: string;       // for Cupid (two targets)
  resolved: boolean;
  result?: NightActionResult;
}

interface NightActionResult {
  success: boolean;
  message: string;               // e.g., "You investigated Ali: Werewolf"
  targetSurvived?: boolean;      // for kills
  revealedTeam?: Team;           // for Seer
}

// ── Deaths ──

type DeathCause =
  | 'werewolf'
  | 'witch'
  | 'hunter'
  | 'heartbreak'
  | 'bodyguard_sacrifice'
  | 'vote'
  | 'jester_retribution'
  | 'abandoned';

interface Death {
  playerId: string;
  cause: DeathCause;
  round: number;
  phase: Phase;
}

// ── Voting ──

interface Nomination {
  nominatorId: string;
  nomineeId: string;
  seconderId: string | null;
  status: 'pending' | 'seconded' | 'lapsed';
  timestamp: number;
}

interface Vote {
  voterId: string;
  targetId: string | null;       // null = abstention
  choice?: 'guilty' | 'innocent'; // for binary votes
  timestamp: number;
}

interface VoteResult {
  nominees: {
    playerId: string;
    votesFor: number;
    votesAgainst?: number;       // for binary votes
  }[];
  eliminatedId: string | null;
  wasRunoff: boolean;
  wasTie: boolean;
}

// ── Lovers ──

interface LoverPair {
  player1Id: string;
  player2Id: string;
  isCrossTeam: boolean;
}

// ── Win Conditions ──

type WinConditionType =
  | 'village_wins'
  | 'werewolf_wins'
  | 'tanner_wins'
  | 'jester_wins'
  | 'lovers_win'
  | 'draw';

interface GameResult {
  winner: WinConditionType;
  winningTeam: Team | 'neutral' | 'lovers' | 'draw';
  winningPlayerIds: string[];
  finalRound: number;
  allRoles: { playerId: string; role: Role; team: Team }[];
  timeline: TimelineEvent[];
}

// ── Game State ──

interface GameState {
  gameId: string;
  phase: Phase;
  nightSubPhase: NightSubPhase | null;
  round: number;
  players: PlayerState[];
  nightActions: NightAction[];
  nominations: Nomination[];
  votes: Vote[];
  lovers: LoverPair | null;
  deaths: Death[];
  timer: TimerState;
  config: GameConfig;
  log: GameLogEntry[];
  result: GameResult | null;
}

interface PlayerState {
  id: string;
  name: string;
  role: Role;
  team: Team;
  isAlive: boolean;
  isModerator: boolean;
  isConnected: boolean;
  elderLivesRemaining?: number;
  witchHealUsed?: boolean;
  witchKillUsed?: boolean;
  doctorSelfProtectsUsed?: number;
  lastDoctorTarget?: string | null;
  lastBodyguardTarget?: string | null;
  alphaConvertUsed?: boolean;
  villageIdiotRevealed?: boolean;
  hasVotingRights: boolean;
}

interface TimerState {
  remaining: number;             // seconds
  total: number;                 // seconds (original duration)
  isPaused: boolean;
  phase: Phase;
}

// ── Game Log ──

interface GameLogEntry {
  timestamp: number;
  round: number;
  phase: Phase;
  type: GameLogEventType;
  message: string;
  visibility: 'all' | 'moderator' | 'werewolves' | 'player';
  playerId?: string;             // player this entry is visible to (if visibility = 'player')
}

type GameLogEventType =
  | 'game_started'
  | 'roles_assigned'
  | 'phase_change'
  | 'night_action'
  | 'death'
  | 'nomination'
  | 'vote_cast'
  | 'vote_result'
  | 'hunter_shot'
  | 'witch_action'
  | 'seer_result'
  | 'lover_created'
  | 'conversion'
  | 'elder_survived'
  | 'village_idiot_revealed'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'moderator_action'
  | 'game_over';

// ── Configuration ──

interface GameConfig {
  // Roles
  werewolfCount: number;
  seerEnabled: boolean;
  doctorEnabled: boolean;
  hunterEnabled: boolean;
  witchEnabled: boolean;
  bodyguardEnabled: boolean;
  cupidEnabled: boolean;
  elderEnabled: boolean;
  villageIdiotEnabled: boolean;
  alphaWerewolfEnabled: boolean;
  tannerEnabled: boolean;
  jesterEnabled: boolean;

  // Timers (seconds)
  nightSubPhaseDuration: number;
  werewolfNightDuration: number;
  discussionDuration: number;
  nominationDuration: number;
  defenseSpeechDuration: number;
  voteDuration: number;
  hunterShotDuration: number;
  jesterRetributionDuration: number;

  // Voting
  votingMode: 'secret' | 'open';
  eliminationThreshold: 'simple_majority' | 'absolute_majority' | 'supermajority';
  tieBreaker: 'no_elimination' | 'runoff' | 'moderator_decides' | 'random';
  allowAbstention: boolean;
  nomineesCanVote: boolean;
  maxNomineesPerRound: number;
  allowVoteChange: boolean;
  revealIndividualVotes: boolean;
  requiredToVote: boolean;

  // Gameplay
  revealRoleOnDeath: 'role' | 'team' | 'none';
  werewolvesKillNight1: boolean;
  seerActiveNight1: boolean;
  witchActiveNight1: boolean;
  doctorSelfProtectLimit: number;
  doctorConsecutiveProtect: boolean;
  witchBothPotionsSameNight: boolean;
  doctorBlocksAllKills: boolean;
  parallelNightActions: boolean;
  tannerWinEndsGame: boolean;
  jesterWinEndsGame: boolean;
  wolfChatDuringDay: boolean;
  deadPlayersCanChat: boolean;
  noEliminationLimit: number;
  stalemateDetectionRounds: number;

  // Moderator
  moderatorExcludedFromWerewolf: boolean;
  blindModeratorNight: boolean;
  moderatorAutoAdvance: boolean;
  moderatorTransferTimeout: number;
  disconnectionTimeout: number;
  autoRemoveDisconnected: boolean;

  // Players
  minPlayers: number;
  maxPlayers: number;
}
```

---

## Appendix B: Server-Side Event Sequence (Reference)

A complete game produces the following server-side event sequence. This serves as a reference for implementing the game loop.

```
1.  GAME_CREATED          { gameId, moderatorId, config }
2.  PLAYER_JOINED         { playerId, name }           (×N)
3.  GAME_STARTED          { players, roleAssignments }
4.  PHASE_CHANGE          { phase: 'role_reveal', timer: 5 }
5.  ROLE_ASSIGNED          { playerId, role }           (×N, private per player)
6.  PHASE_CHANGE          { phase: 'night', round: 1 }
7.  NIGHT_SUB_PHASE       { subPhase: 'cupid', timer: 30 }  (if Cupid in game)
8.  NIGHT_ACTION          { type: 'cupid_link', actorId, target1Id, target2Id }
9.  NIGHT_SUB_PHASE       { subPhase: 'seer', timer: 20 }
10. NIGHT_ACTION          { type: 'seer_investigate', actorId, targetId }
11. SEER_RESULT           { targetId, team }            (private to Seer)
12. NIGHT_SUB_PHASE       { subPhase: 'doctor', timer: 20 }
13. NIGHT_ACTION          { type: 'doctor_protect', actorId, targetId }
14. NIGHT_SUB_PHASE       { subPhase: 'werewolf_kill', timer: 30 }
15. WEREWOLF_SELECT       { werewolfId, targetId }     (×M, private to wolves)
16. NIGHT_ACTION          { type: 'werewolf_kill', targetId }
17. NIGHT_SUB_PHASE       { subPhase: 'witch_heal', timer: 15 }  (if Witch)
18. WITCH_PROMPT          { werewolfTargetId }          (private to Witch)
19. NIGHT_ACTION          { type: 'witch_heal', actorId, targetId }  (or skip)
20. NIGHT_SUB_PHASE       { subPhase: 'witch_kill', timer: 15 }
21. NIGHT_ACTION          { type: 'witch_kill', actorId, targetId }  (or skip)
22. NIGHT_RESOLVED        { deaths: [...], saves: [...] }
23. PHASE_CHANGE          { phase: 'dawn' }
24. DEATH_ANNOUNCEMENT    { playerId, role?, cause }    (×D, if any deaths)
25. WIN_CHECK             { result: null }              (or GameResult if game over)
26. PHASE_CHANGE          { phase: 'day_discussion', timer: 180 }
27. PHASE_CHANGE          { phase: 'nomination', timer: 60 }
28. NOMINATION_MADE       { nominatorId, nomineeId }
29. NOMINATION_SECONDED   { seconderId, nomineeId }
30. PHASE_CHANGE          { phase: 'defense_speech', nomineeId, timer: 30 }
31. PHASE_CHANGE          { phase: 'day_vote', timer: 30 }
32. VOTE_CAST             { voterId, choice }           (×V)
33. VOTE_RESULT           { tally, eliminatedId }
34. DEATH_ANNOUNCEMENT    { playerId, role?, cause: 'vote' }  (if elimination)
35. [HUNTER_SHOT_PROMPT]  { hunterId, timer: 15 }       (if Hunter dies)
36. [HUNTER_SHOT]         { targetId }
37. [HEARTBREAK_DEATH]    { playerId }                  (if lover)
38. WIN_CHECK             { result: null }              (or GameResult)
39. PHASE_CHANGE          { phase: 'dusk' }
40. PHASE_CHANGE          { phase: 'night', round: 2 }
    ... (loop from step 7, without Cupid sub-phase)
```

---

## Appendix C: Glossary

| Term | Definition |
|---|---|
| **Round** | One complete Night → Day cycle. Round 1 starts at Night 1. |
| **Phase** | A discrete segment of the game (Night, Dawn, Day Discussion, Nomination, Defense, Vote, Vote Result, Dusk, Game Over). |
| **Sub-phase** | A segment within the Night phase, corresponding to one role's action. |
| **Resolution** | The process of applying all night actions to the game state in priority order. |
| **Chain death** | A death caused by another death (e.g., heartbreak, Hunter shot). |
| **Checkpoint** | A moment where win conditions are evaluated. |
| **Action** | A player's choice during their active phase (investigate, protect, kill, vote, etc.). |
| **Skip** | An action that results in no effect (player chose not to act, or timer expired). |
| **Nomination** | A formal accusation during the day, requiring a second to proceed to a vote. |
| **Second** | A supporting nomination from a different player, confirming the accusation. |
| **Tally** | The counted votes after a voting phase concludes. |
| **Abstention** | A deliberate non-vote. Distinct from not voting due to disconnection. |
| **Balance score** | A numerical measure of how fair the role distribution is (§7.3). |
| **Authority** | The server is the single source of truth for all game state. Clients are views. |
