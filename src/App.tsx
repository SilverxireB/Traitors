import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Crown,
  Lock,
  Moon,
  QrCode,
  RotateCcw,
  Smartphone,
  Sparkles,
  Sun,
  Users,
  Vote,
} from "lucide-react";
import "./App.css";

type Role = "Vampir" | "Koylu" | "Kahin" | "Doktor";
type Team = "vampir" | "koy";
type Phase = "setup" | "lobby" | "roles" | "night" | "day" | "vote" | "result" | "gameover";

type Player = {
  id: string;
  name: string;
  photo: string;
  role?: Role;
  team?: Team;
  isHuman: boolean;
  alive: boolean;
  voteLocked: boolean;
  voteTargetId?: string;
};

type GameSettings = {
  vampireCount: number;
  villagerCount: number;
  seerEnabled: boolean;
  doctorEnabled: boolean;
};

type NightAction = {
  vampireTargetId?: string;
  seerTargetId?: string;
  doctorTargetId?: string;
};

const demoNames = ["Mina", "Bora", "Lara", "Deniz", "Efe", "Ada", "Mert", "Nora"];
const photoGradients = [
  "linear-gradient(135deg, #7f1d1d, #dc2626)",
  "linear-gradient(135deg, #312e81, #8b5cf6)",
  "linear-gradient(135deg, #164e63, #06b6d4)",
  "linear-gradient(135deg, #713f12, #f59e0b)",
  "linear-gradient(135deg, #581c87, #d946ef)",
  "linear-gradient(135deg, #14532d, #22c55e)",
  "linear-gradient(135deg, #881337, #fb7185)",
  "linear-gradient(135deg, #1e293b, #64748b)",
];

const initialSettings: GameSettings = {
  vampireCount: 2,
  villagerCount: 4,
  seerEnabled: true,
  doctorEnabled: true,
};

const roleMeta: Record<Role, { team: Team; hint: string }> = {
  Vampir: { team: "vampir", hint: "Gece bir hedef seç. Vampirler eşitliği yakalarsa kazanır." },
  Koylu: { team: "koy", hint: "Gündüz tartış, şüphelini oylamada ele." },
  Kahin: { team: "koy", hint: "Gece bir oyuncunun takımını öğren." },
  Doktor: { team: "koy", hint: "Gece bir oyuncuyu koru." },
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function avatarFor(name: string, index: number) {
  return `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(name)}-${index}`;
}

function getTotalPlayers(settings: GameSettings) {
  return settings.vampireCount + settings.villagerCount + Number(settings.seerEnabled) + Number(settings.doctorEnabled);
}

function buildRoleDeck(settings: GameSettings): Role[] {
  return [
    ...Array.from({ length: settings.vampireCount }, () => "Vampir" as const),
    ...Array.from({ length: settings.villagerCount }, () => "Koylu" as const),
    ...(settings.seerEnabled ? (["Kahin"] as const) : []),
    ...(settings.doctorEnabled ? (["Doktor"] as const) : []),
  ];
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function chooseTarget(players: Player[], avoidId?: string) {
  const options = players.filter((player) => player.alive && player.id !== avoidId);
  return options[Math.floor(Math.random() * options.length)];
}

function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [settings, setSettings] = useState<GameSettings>(initialSettings);
  const [playerName, setPlayerName] = useState("Ev sahibi");
  const [players, setPlayers] = useState<Player[]>([]);
  const [nightAction, setNightAction] = useState<NightAction>({});
  const [eliminatedId, setEliminatedId] = useState<string>();
  const [round, setRound] = useState(1);
  const [eventLog, setEventLog] = useState<string[]>(["Oyun kurulumu bekleniyor."]);
  const [joinCopied, setJoinCopied] = useState(false);

  const totalPlayers = getTotalPlayers(settings);
  const human = players.find((player) => player.isHuman);
  const alivePlayers = players.filter((player) => player.alive);
  const eliminated = players.find((player) => player.id === eliminatedId);
  const gameCode = "VAMP-2026";
  const joinUrl = `${window.location.origin}?room=${gameCode}`;

  const voteTallies = useMemo(() => {
    return players.reduce<Record<string, number>>((acc, player) => {
      if (player.voteTargetId) acc[player.voteTargetId] = (acc[player.voteTargetId] ?? 0) + 1;
      return acc;
    }, {});
  }, [players]);

  const winner = useMemo(() => {
    const aliveVampires = players.filter((player) => player.alive && player.team === "vampir").length;
    const aliveVillage = players.filter((player) => player.alive && player.team === "koy").length;
    if (!players.length) return undefined;
    if (aliveVampires === 0) return "Koyluler kazandi";
    if (aliveVampires >= aliveVillage) return "Vampirler kazandi";
    return undefined;
  }, [players]);

  function updateSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function startLobby(withBots: boolean) {
    const humanPlayer: Player = {
      id: createId("player"),
      name: playerName.trim() || "Ev sahibi",
      photo: avatarFor(playerName || "Ev sahibi", 0),
      isHuman: true,
      alive: true,
      voteLocked: false,
    };

    const botCount = withBots ? Math.max(totalPlayers - 1, 0) : 0;
    const bots = Array.from({ length: botCount }, (_, index) => ({
      id: createId("bot"),
      name: demoNames[index % demoNames.length],
      photo: avatarFor(demoNames[index % demoNames.length], index + 1),
      isHuman: false,
      alive: true,
      voteLocked: false,
    }));

    setPlayers([humanPlayer, ...bots]);
    setPhase("lobby");
    setEventLog([
      withBots
        ? "Demo modu acildi: botlar normal oyuncu gibi katildi."
        : "Oda acildi: arkadaslar QR veya link ile katilabilir.",
    ]);
  }

  function addDemoBot() {
    if (players.length >= totalPlayers) return;
    const index = players.length;
    const name = demoNames[index % demoNames.length];
    setPlayers((current) => [
      ...current,
      {
        id: createId("bot"),
        name,
        photo: avatarFor(name, index),
        isHuman: false,
        alive: true,
        voteLocked: false,
      },
    ]);
  }

  function assignRoles() {
    const deck = shuffle(buildRoleDeck(settings));
    setPlayers((current) =>
      current.map((player, index) => {
        const role = deck[index] ?? "Koylu";
        return { ...player, role, team: roleMeta[role].team };
      }),
    );
    setPhase("roles");
    setEventLog((current) => ["Roller oyun tarafindan gizli olarak dagitildi.", ...current]);
  }

  function startNight() {
    const vampires = players.filter((player) => player.alive && player.role === "Vampir");
    const vampireTarget = chooseTarget(
      players.filter((player) => player.team !== "vampir"),
      vampires[0]?.id,
    );
    const seer = players.find((player) => player.alive && player.role === "Kahin");
    const doctor = players.find((player) => player.alive && player.role === "Doktor");
    const seerTarget = seer ? chooseTarget(players, seer.id) : undefined;
    const doctorTarget = doctor ? chooseTarget(players) : undefined;

    setNightAction({
      vampireTargetId: vampireTarget?.id,
      seerTargetId: seerTarget?.id,
      doctorTargetId: doctorTarget?.id,
    });
    setPhase("night");
    setEventLog((current) => [
      "Gece basladi: bot roller hedeflerini sessizce secti.",
      ...current,
    ]);
  }

  function resolveNight() {
    const target = players.find((player) => player.id === nightAction.vampireTargetId);
    const protectedPlayer = players.find((player) => player.id === nightAction.doctorTargetId);
    const targetDies = target && target.id !== protectedPlayer?.id;

    if (targetDies) {
      setPlayers((current) =>
        current.map((player) => (player.id === target.id ? { ...player, alive: false } : player)),
      );
      setEliminatedId(target.id);
      setEventLog((current) => [`Gece sonucu: ${target.name} elendi.`, ...current]);
    } else {
      setEliminatedId(undefined);
      setEventLog((current) => ["Gece sonucu: Kimse elenmedi.", ...current]);
    }
    setPhase("day");
  }

  function startVoting() {
    setPlayers((current) =>
      current.map((player) => ({ ...player, voteLocked: false, voteTargetId: undefined })),
    );
    setPhase("vote");
    setEventLog((current) => ["Oylama telefondan basladi; oylar kilitlenebilir.", ...current]);
  }

  function castVote(voterId: string, targetId: string) {
    setPlayers((current) =>
      current.map((player) =>
        player.id === voterId && !player.voteLocked
          ? { ...player, voteTargetId: targetId, voteLocked: true }
          : player,
      ),
    );
  }

  function autoVoteBots() {
    setPlayers((current) =>
      current.map((player) => {
        if (player.isHuman || !player.alive || player.voteLocked) return player;
        const target = chooseTarget(current, player.id);
        return { ...player, voteTargetId: target?.id, voteLocked: Boolean(target) };
      }),
    );
    setEventLog((current) => ["Botlar oylarini verdi ve kilitledi.", ...current]);
  }

  function resolveVote() {
    const aliveVotes = players.filter((player) => player.alive && player.voteTargetId);
    if (!aliveVotes.length) return;

    const sorted = Object.entries(voteTallies).sort((a, b) => b[1] - a[1]);
    const [targetId] = sorted[0];
    const target = players.find((player) => player.id === targetId);
    if (!target) return;

    setPlayers((current) =>
      current.map((player) => (player.id === target.id ? { ...player, alive: false } : player)),
    );
    setEliminatedId(target.id);
    setEventLog((current) => [`Oylama sonucu: ${target.name} kilitli oylarla elendi.`, ...current]);
    setPhase(winner ? "gameover" : "result");
  }

  function nextRound() {
    if (winner) {
      setPhase("gameover");
      return;
    }
    setRound((current) => current + 1);
    startNight();
  }

  function resetGame() {
    setPhase("setup");
    setSettings(initialSettings);
    setPlayers([]);
    setNightAction({});
    setEliminatedId(undefined);
    setRound(1);
    setEventLog(["Oyun kurulumu bekleniyor."]);
  }

  async function copyJoinUrl() {
    await navigator.clipboard.writeText(joinUrl);
    setJoinCopied(true);
    window.setTimeout(() => setJoinCopied(false), 1400);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Vampir Koylu / Yilbasi modu</p>
          <h1>Telefonlardan girilen, QR destekli tur yonetim araci.</h1>
          <p className="hero-copy">
            Roller oyun tarafindan dagitilir, botlar demo modunda her asamayi oynar, telefondan
            verilen oylar kilitlenir.
          </p>
        </div>
        <div className="phase-card">
          <span>Tur {round}</span>
          <strong>{phaseLabel(phase)}</strong>
          <small>{players.length ? `${alivePlayers.length}/${players.length} oyuncu hayatta` : "Oda bekliyor"}</small>
        </div>
      </section>

      {phase === "setup" && (
        <section className="grid two">
          <div className="panel">
            <SectionTitle icon={<Users />} title="Ilk giris" subtitle="Isim ve fotograf karti" />
            <label className="field">
              Ismin
              <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
            </label>
            <div className="profile-preview">
              <img src={avatarFor(playerName || "Ev sahibi", 0)} alt="Oyuncu fotografi" />
              <div>
                <strong>{playerName || "Ev sahibi"}</strong>
                <span>Dikdortgen oyuncu karti</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={<Crown />} title="Rol sayilari" subtitle="Oyunun basinda belirlenir" />
            <Counter label="Vampir" value={settings.vampireCount} min={1} max={4} onChange={(value) => updateSetting("vampireCount", value)} />
            <Counter label="Koylu" value={settings.villagerCount} min={2} max={10} onChange={(value) => updateSetting("villagerCount", value)} />
            <label className="toggle">
              <input type="checkbox" checked={settings.seerEnabled} onChange={(event) => updateSetting("seerEnabled", event.target.checked)} />
              Kahin rolunu ekle
            </label>
            <label className="toggle">
              <input type="checkbox" checked={settings.doctorEnabled} onChange={(event) => updateSetting("doctorEnabled", event.target.checked)} />
              Doktor rolunu ekle
            </label>
            <div className="actions">
              <button className="primary" onClick={() => startLobby(false)}>
                Oda ac
              </button>
              <button className="secondary" onClick={() => startLobby(true)}>
                <Bot size={18} /> Demo botlarla baslat
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === "lobby" && (
        <section className="grid lobby-grid">
          <div className="panel qr-panel">
            <SectionTitle icon={<QrCode />} title="QR ile katilim" subtitle="Arkadaslar linki telefondan acar" />
            <div className="fake-qr" aria-label="Demo QR kodu">
              {Array.from({ length: 49 }).map((_, index) => (
                <span key={index} className={(index * 7 + 3) % 5 === 0 ? "filled" : ""} />
              ))}
            </div>
            <p className="room-code">{gameCode}</p>
            <button className="secondary full" onClick={copyJoinUrl}>
              {joinCopied ? <Check size={18} /> : <Copy size={18} />}
              {joinCopied ? "Kopyalandi" : "Katilim linkini kopyala"}
            </button>
          </div>

          <div className="panel">
            <SectionTitle icon={<Smartphone />} title="Lobi" subtitle={`${players.length}/${totalPlayers} oyuncu`} />
            <PlayerGrid players={players} selectable={false} />
            <div className="actions">
              <button className="secondary" disabled={players.length >= totalPlayers} onClick={addDemoBot}>
                <Bot size={18} /> Demo bot ekle
              </button>
              <button className="primary" disabled={players.length < totalPlayers} onClick={assignRoles}>
                Rolleri dagit
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === "roles" && human?.role && (
        <section className="grid two">
          <div className="panel role-reveal">
            <SectionTitle icon={<Sparkles />} title="Gizli rolun" subtitle="Telefonu kendine cevir" />
            <div className={`role-card ${human.team}`}>
              <span>{human.role}</span>
              <strong>{roleMeta[human.role].hint}</strong>
            </div>
            <button className="primary full" onClick={startNight}>
              Geceyi baslat
            </button>
          </div>
          <div className="panel">
            <SectionTitle icon={<Users />} title="Oyuncular" subtitle="Roller gizli kalir" />
            <PlayerGrid players={players} selectable={false} hideRoles />
          </div>
        </section>
      )}

      {phase === "night" && (
        <section className="grid two">
          <div className="panel">
            <SectionTitle icon={<Moon />} title="Gece aksiyonlari" subtitle="Botlar hedeflerini secti" />
            <NightSummary players={players} action={nightAction} />
            <button className="primary full" onClick={resolveNight}>
              Geceyi cozumle
            </button>
          </div>
          <EventPanel events={eventLog} />
        </section>
      )}

      {phase === "day" && (
        <section className="grid two">
          <div className="panel day-panel">
            <SectionTitle icon={<Sun />} title="Gunduz tartismasi" subtitle="Sistem sonucu duyurur" />
            <div className="announcement">
              {eliminated ? `${eliminated.name} gece elendi.` : "Bu gece kimse elenmedi."}
            </div>
            <PlayerGrid players={players} selectable={false} hideRoles />
            <button className="primary full" onClick={startVoting}>
              Telefonda oylamaya gec
            </button>
          </div>
          <EventPanel events={eventLog} />
        </section>
      )}

      {phase === "vote" && human && (
        <section className="grid two">
          <div className="panel">
            <SectionTitle icon={<Vote />} title="Kilitli telefon oylamasi" subtitle="Oy verildikten sonra degismez" />
            <PlayerGrid
              players={players.filter((player) => player.alive && player.id !== human.id)}
              selectable={!human.voteLocked}
              voteTallies={voteTallies}
              onSelect={(targetId) => castVote(human.id, targetId)}
              hideRoles
            />
            <div className="vote-status">
              <Lock size={18} />
              {human.voteLocked ? "Oyun kilitlendi." : "Bir oyuncu secince oyun kilitlenecek."}
            </div>
            <div className="actions">
              <button className="secondary" onClick={autoVoteBots}>
                <Bot size={18} /> Botlara oy verdir
              </button>
              <button className="primary" onClick={resolveVote}>
                Oylamayi bitir
              </button>
            </div>
          </div>
          <EventPanel events={eventLog} />
        </section>
      )}

      {(phase === "result" || phase === "gameover") && (
        <section className="grid two">
          <div className="panel">
            <SectionTitle icon={<Crown />} title={phase === "gameover" ? "Oyun bitti" : "Tur sonucu"} subtitle="Roller guvenli sekilde acilir" />
            <div className="announcement">
              {winner ?? `${eliminated?.name ?? "Kimse"} oylama ile elendi.`}
            </div>
            <PlayerGrid players={players} selectable={false} />
            <div className="actions">
              {phase !== "gameover" && (
                <button className="primary" onClick={nextRound}>
                  Sonraki gece
                </button>
              )}
              <button className="secondary" onClick={resetGame}>
                <RotateCcw size={18} /> Yeni oyun
              </button>
            </div>
          </div>
          <EventPanel events={eventLog} />
        </section>
      )}
    </main>
  );
}

function phaseLabel(phase: Phase) {
  const labels: Record<Phase, string> = {
    setup: "Kurulum",
    lobby: "Lobi",
    roles: "Rol dagitimi",
    night: "Gece",
    day: "Gunduz",
    vote: "Oylama",
    result: "Sonuc",
    gameover: "Oyun sonu",
  };
  return labels[phase];
}

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <div className="icon">{icon}</div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="counter">
      <span>{label}</span>
      <div>
        <button onClick={() => onChange(Math.max(min, value - 1))}>-</button>
        <strong>{value}</strong>
        <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function PlayerGrid({
  players,
  selectable,
  hideRoles,
  voteTallies,
  onSelect,
}: {
  players: Player[];
  selectable: boolean;
  hideRoles?: boolean;
  voteTallies?: Record<string, number>;
  onSelect?: (playerId: string) => void;
}) {
  return (
    <div className="player-grid">
      {players.map((player, index) => (
        <button
          key={player.id}
          className={`player-card ${!player.alive ? "dead" : ""}`}
          onClick={() => selectable && onSelect?.(player.id)}
          disabled={!selectable}
          style={{ "--fallback": photoGradients[index % photoGradients.length] } as React.CSSProperties}
        >
          <img src={player.photo} alt={`${player.name} fotografi`} />
          <div>
            <strong>{player.name}</strong>
            <span>
              {!player.alive ? "Elendi" : player.isHuman ? "Telefon oyuncusu" : "Demo bot"}
              {voteTallies?.[player.id] ? ` · ${voteTallies[player.id]} oy` : ""}
            </span>
            {!hideRoles && player.role && <em>{player.role}</em>}
          </div>
        </button>
      ))}
    </div>
  );
}

function NightSummary({ players, action }: { players: Player[]; action: NightAction }) {
  const name = (id?: string) => players.find((player) => player.id === id)?.name ?? "Secilmedi";
  return (
    <div className="night-summary">
      <p>Vampir hedefi: {name(action.vampireTargetId)}</p>
      <p>Kahin baktigi kisi: {name(action.seerTargetId)}</p>
      <p>Doktor korumasi: {name(action.doctorTargetId)}</p>
      <small>Canli urunde bu detaylar sadece yetkili oyuncu payload'inda tutulacak.</small>
    </div>
  );
}

function EventPanel({ events }: { events: string[] }) {
  return (
    <div className="panel event-panel">
      <SectionTitle icon={<Sparkles />} title="Olay akisi" subtitle="Test icin canli log" />
      <ul>
        {events.map((event, index) => (
          <li key={`${event}-${index}`}>{event}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
