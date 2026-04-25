import { useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Moon, RotateCcw, Sparkles, Sun, Upload, Vote } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

type Role = "Vampir" | "Koylu" | "Kahin" | "Doktor";
type Team = "vampir" | "koy";
type Phase = "setup" | "lobby" | "roles" | "night" | "day" | "vote" | "voteReveal" | "result" | "gameover";
type RevealStep = "countdown" | "eliminated" | "role";

type Player = {
  id: string;
  name: string;
  photo: string;
  role?: Role;
  team?: Team;
  isHuman: boolean;
  alive: boolean;
  voteDone: boolean;
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

type RoomState = {
  players: Player[];
  phase: Phase;
  settings: GameSettings;
  round: number;
};

type RoomMessage = { type: "state"; state: RoomState | null };

const demoNames = ["Mina", "Bora", "Lara", "Deniz", "Efe", "Ada", "Mert", "Nora"];
const initialSettings: GameSettings = {
  vampireCount: 2,
  villagerCount: 4,
  seerEnabled: true,
  doctorEnabled: true,
};

const roleMeta: Record<Role, { team: Team; hint: string }> = {
  Vampir: { team: "vampir", hint: "Gece hedef seç. Sayıca eşitliği yakalarsan kazanırsın." },
  Koylu: { team: "koy", hint: "Konuş, gözlemle, doğru kişiyi ele." },
  Kahin: { team: "koy", hint: "Gece bir oyuncunun tarafını öğren." },
  Doktor: { team: "koy", hint: "Gece bir oyuncuyu koru." },
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function avatarFor(name: string, index: number) {
  return `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(name)}-${index}`;
}

function totalPlayers(settings: GameSettings) {
  return settings.vampireCount + settings.villagerCount + Number(settings.seerEnabled) + Number(settings.doctorEnabled);
}

function roleDeck(settings: GameSettings): Role[] {
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

function pickTarget(players: Player[], avoidId?: string) {
  const options = players.filter((player) => player.alive && player.id !== avoidId);
  return options[Math.floor(Math.random() * options.length)];
}

function getWinner(players: Player[]) {
  if (!players.length) return undefined;
  const aliveVampires = players.filter((player) => player.alive && player.team === "vampir").length;
  const aliveVillage = players.filter((player) => player.alive && player.team === "koy").length;
  if (aliveVampires === 0) return "Köylüler kazandı";
  if (aliveVampires >= aliveVillage) return "Vampirler kazandı";
  return undefined;
}

function getVoteTarget(sourcePlayers: Player[]) {
  const tallies = sourcePlayers.reduce<Record<string, number>>((acc, player) => {
    if (player.voteTargetId) acc[player.voteTargetId] = (acc[player.voteTargetId] ?? 0) + 1;
    return acc;
  }, {});
  const [targetId] = Object.entries(tallies).sort((a, b) => b[1] - a[1])[0] ?? [];
  return sourcePlayers.find((player) => player.id === targetId);
}

function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [settings, setSettings] = useState<GameSettings>(initialSettings);
  const [playerName, setPlayerName] = useState("Ev sahibi");
  const [playerPhoto, setPlayerPhoto] = useState(avatarFor("Ev sahibi", 0));
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState(1);
  const [nightAction, setNightAction] = useState<NightAction>({});
  const [selectedVoteId, setSelectedVoteId] = useState<string>();
  const [voteNotice, setVoteNotice] = useState("");
  const [revealStep, setRevealStep] = useState<RevealStep>("countdown");
  const [countdown, setCountdown] = useState(10);
  const [eliminatedId, setEliminatedId] = useState<string>();
  const [joinCopied, setJoinCopied] = useState(false);
  const [log, setLog] = useState<string[]>(["Oyun hazır."]);
  const botTimers = useRef<number[]>([]);
  const revealTimers = useRef<number[]>([]);
  const phaseRef = useRef<Phase>("setup");
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef(createId("player"));
  const queryRoom = new URLSearchParams(window.location.search).get("room");

  const gameCode = "VAMP-2026";
  const joinUrl = `${window.location.origin}?room=${gameCode}`;
  const human = players.find((player) => player.isHuman);
  const alivePlayers = players.filter((player) => player.alive);
  const eliminated = players.find((player) => player.id === eliminatedId);
  const requiredPlayers = totalPlayers(settings);
  const winner = getWinner(players);

  const votersDone = players.filter((player) => player.alive && player.voteDone);
  const pendingVoters = players.filter((player) => player.alive && !player.voteDone);

  function mergeRemotePlayers(localPlayers: Player[], remotePlayers: Player[]) {
    const localHuman = localPlayers.find((player) => player.id === playerIdRef.current);
    const withoutLocalDuplicate = remotePlayers.filter((player) => player.id !== playerIdRef.current);
    return localHuman ? [localHuman, ...withoutLocalDuplicate] : remotePlayers;
  }

  function broadcastRoom(nextPlayers = players, nextPhase = phase, nextSettings = settings, nextRound = round) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: "state",
        room: gameCode,
        state: { players: nextPlayers, phase: nextPhase, settings: nextSettings, round: nextRound },
      }),
    );
  }

  useEffect(() => {
    return () => clearTimers();
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/room-ws`);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", room: gameCode }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as RoomMessage;
      if (message.type !== "state" || !message.state) return;
      setPlayers((current) => mergeRemotePlayers(current, message.state!.players));
      setSettings(message.state.settings);
      setRound(message.state.round);
      if (message.state.phase !== "setup") setPhase(message.state.phase);
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!queryRoom || queryRoom !== gameCode || players.some((player) => player.id === playerIdRef.current)) return;
    setPhase("setup");
    setLog(["Odaya katılmak için isim ve fotoğrafını gir."]);
  }, [players, queryRoom]);

  function clearTimers() {
    botTimers.current.forEach(window.clearTimeout);
    revealTimers.current.forEach(window.clearTimeout);
    botTimers.current = [];
    revealTimers.current = [];
  }

  function updateSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function handlePhotoUpload(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPlayerPhoto(String(reader.result));
    reader.readAsDataURL(file);
  }

  function startLobby(withBots: boolean) {
    const host: Player = {
      id: playerIdRef.current,
      name: playerName.trim() || "Ev sahibi",
      photo: playerPhoto,
      isHuman: true,
      alive: true,
      voteDone: false,
    };
    const botCount = withBots ? Math.max(requiredPlayers - 1, 0) : 0;
    const bots = Array.from({ length: botCount }, (_, index): Player => {
      const name = demoNames[index % demoNames.length];
      return {
        id: createId("bot"),
        name,
        photo: avatarFor(name, index + 1),
        isHuman: false,
        alive: true,
        voteDone: false,
      };
    });

    const nextPlayers = [host, ...bots];
    setPlayers(nextPlayers);
    setPhase("lobby");
    setLog([withBots ? "Demo oyuncuları eklendi." : "Oda açıldı."]);
    broadcastRoom(nextPlayers, "lobby", settings, round);
  }

  function joinRoom() {
    const joiningPlayer: Player = {
      id: playerIdRef.current,
      name: playerName.trim() || "Oyuncu",
      photo: playerPhoto,
      isHuman: true,
      alive: true,
      voteDone: false,
    };
    const nextPlayers = mergeRemotePlayers(players, [...players, joiningPlayer]);
    setPlayers(nextPlayers);
    broadcastRoom(nextPlayers, "lobby", settings, round);
    setPhase("lobby");
    setLog(["Odaya katıldın."]);
  }

  function addDemoBot() {
    if (players.length >= requiredPlayers) return;
    const name = demoNames[players.length % demoNames.length];
    setPlayers((current) => [
      ...current,
      {
        id: createId("bot"),
        name,
        photo: avatarFor(name, current.length),
        isHuman: false,
        alive: true,
        voteDone: false,
      },
    ]);
  }

  function assignRoles() {
    const deck = shuffle(roleDeck(settings));
    setPlayers((current) => {
      const nextPlayers = current.map((player, index) => {
        const role = deck[index] ?? "Koylu";
        return { ...player, role, team: roleMeta[role].team };
      });
      broadcastRoom(nextPlayers, "roles", settings, round);
      return nextPlayers;
    });
    setPhase("roles");
    setLog((current) => ["Roller dağıtıldı.", ...current]);
  }

  function startNight() {
    const seer = players.find((player) => player.alive && player.role === "Kahin");
    const doctor = players.find((player) => player.alive && player.role === "Doktor");

    setNightAction({
      vampireTargetId: undefined,
      seerTargetId: seer ? pickTarget(players, seer.id)?.id : undefined,
      doctorTargetId: doctor ? pickTarget(players)?.id : undefined,
    });
    setPhase("night");
    setLog((current) => ["Gece başladı.", ...current]);
  }

  function chooseVampireTarget(targetId: string) {
    setNightAction((current) => ({ ...current, vampireTargetId: targetId }));
    setLog((current) => ["Vampir hedefini seçti.", ...current]);
  }

  function resolveNight() {
    const fallbackTarget = pickTarget(players.filter((player) => player.team !== "vampir"));
    const target = players.find((player) => player.id === nightAction.vampireTargetId) ?? fallbackTarget;
    const protectedPlayer = players.find((player) => player.id === nightAction.doctorTargetId);
    const nextPlayers = players.map((player) =>
      target && target.id !== protectedPlayer?.id && player.id === target.id ? { ...player, alive: false } : player,
    );

    setPlayers(nextPlayers);
    setEliminatedId(target && target.id !== protectedPlayer?.id ? target.id : undefined);
    setPhase(getWinner(nextPlayers) ? "gameover" : "day");
    setLog((current) => [target && target.id !== protectedPlayer?.id ? `${target.name} gece elendi.` : "Gece sakin geçti.", ...current]);
  }

  function startVoting() {
    setSelectedVoteId(undefined);
    setVoteNotice("");
    clearTimers();
    setPlayers((current) =>
      current.map((player) => ({ ...player, voteDone: false, voteTargetId: undefined })),
    );
    phaseRef.current = "vote";
    setPhase("vote");
    setLog((current) => ["Oylama başladı. Demo oyuncuları sırayla oy verecek.", ...current]);
    scheduleBotVotes();
  }

  function confirmHumanVote() {
    if (!human) return;
    if (!selectedVoteId) {
      setVoteNotice("Önce bir fotoğraf seç.");
      return;
    }
    const nextPlayers = players.map((player) =>
      player.id === human.id ? { ...player, voteDone: true, voteTargetId: selectedVoteId } : player,
    );
    setPlayers(nextPlayers);
    setVoteNotice("");
    setLog((current) => [`${human.name} oyunu tamamladı.`, ...current]);
    maybeBeginVoteReveal(nextPlayers);
  }

  function scheduleBotVotes() {
    const botVoters = players.filter((player) => player.alive && !player.isHuman);
    const delayStep = botVoters.length > 1 ? 30000 / (botVoters.length - 1) : 0;

    botVoters.forEach((bot, index) => {
      const delay = Math.round(1200 + index * delayStep);
      const timer = window.setTimeout(() => {
        setPlayers((current) => {
          const voter = current.find((player) => player.id === bot.id && player.alive && !player.voteDone);
          if (!voter) return current;
          const target = pickTarget(current, voter.id);
          if (!target) return current;
          setLog((events) => [`${voter.name} oyunu tamamladı.`, ...events]);
          const nextPlayers = current.map((player) =>
            player.id === voter.id ? { ...player, voteDone: true, voteTargetId: target.id } : player,
          );
          maybeBeginVoteReveal(nextPlayers);
          return nextPlayers;
        });
      }, delay);
      botTimers.current.push(timer);
    });
  }

  function maybeBeginVoteReveal(sourcePlayers: Player[]) {
    const alive = sourcePlayers.filter((player) => player.alive);
    if (phaseRef.current !== "vote" || alive.some((player) => !player.voteDone)) return;
    beginVoteReveal(sourcePlayers);
  }

  function beginVoteReveal(sourcePlayers: Player[]) {
    if (phaseRef.current !== "vote") return;
    clearTimers();
    phaseRef.current = "voteReveal";
    setPhase("voteReveal");
    setRevealStep("countdown");
    setCountdown(10);
    setLog((current) => ["Herkes oyunu tamamladı. Sayım başladı.", ...current]);

    for (let value = 9; value >= 0; value -= 1) {
      const timer = window.setTimeout(() => setCountdown(value), (10 - value) * 1000);
      revealTimers.current.push(timer);
    }

    const resultTimer = window.setTimeout(() => {
      const target = getVoteTarget(sourcePlayers);
      if (!target) return;
      setEliminatedId(target.id);
      setRevealStep("eliminated");
      setLog((current) => [`${target.name} elendi. Rolü birazdan açıklanacak.`, ...current]);
    }, 10200);

    const roleTimer = window.setTimeout(() => resolveVote(sourcePlayers), 13200);
    revealTimers.current.push(resultTimer, roleTimer);
  }

  function resolveVote(sourcePlayers = players) {
    const target = getVoteTarget(sourcePlayers);
    if (!target) return;
    const nextPlayers = sourcePlayers.map((player) => (player.id === target.id ? { ...player, alive: false } : player));
    setPlayers(nextPlayers);
    setEliminatedId(target.id);
    setRevealStep("role");
    setPhase(getWinner(nextPlayers) ? "gameover" : "result");
    setLog((current) => [`${target.name} bir ${target.role ?? "oyuncu"} çıktı.`, ...current]);
  }

  function nextRound() {
    setRound((current) => current + 1);
    startNight();
  }

  function resetGame() {
    setPhase("setup");
    setPlayers([]);
    setRound(1);
    setNightAction({});
    setSelectedVoteId(undefined);
    setVoteNotice("");
    setRevealStep("countdown");
    setCountdown(10);
    setEliminatedId(undefined);
    setLog(["Oyun hazır."]);
    clearTimers();
  }

  async function copyJoinUrl() {
    await navigator.clipboard.writeText(joinUrl);
    setJoinCopied(true);
    window.setTimeout(() => setJoinCopied(false), 1300);
  }

  return (
    <main className="app">
      <div className="phone-frame">
        <header className="topbar">
          <div className="brand">
            <span>VK</span>
            <div>
              <strong>Vampir Köylü</strong>
              <small>Tur {round} · {phaseLabel(phase)}</small>
            </div>
          </div>
          {players.length > 0 && <span className="live-dot">{alivePlayers.length}/{players.length}</span>}
        </header>

        {phase === "setup" && (
          <Screen title="Oyunu kur" subtitle="Oyuncu sayısı, rol dağılımı ve profil.">
            <div className="profile-card">
              <img src={playerPhoto} alt="Profil" />
              <div>
                <label>İsim</label>
                <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
                <label className="upload-button">
                  <Upload size={17} />
                  Fotoğraf seç
                  <input type="file" accept="image/*" onChange={(event) => handlePhotoUpload(event.target.files?.[0])} />
                </label>
              </div>
            </div>

            <div className="compact-grid">
              <Counter label="Vampir" value={settings.vampireCount} min={1} max={4} onChange={(value) => updateSetting("vampireCount", value)} />
              <Counter label="Köylü" value={settings.villagerCount} min={2} max={10} onChange={(value) => updateSetting("villagerCount", value)} />
            </div>

            <label className="switch">
              <input type="checkbox" checked={settings.seerEnabled} onChange={(event) => updateSetting("seerEnabled", event.target.checked)} />
              Kahin
            </label>
            <label className="switch">
              <input type="checkbox" checked={settings.doctorEnabled} onChange={(event) => updateSetting("doctorEnabled", event.target.checked)} />
              Doktor
            </label>

            <div className="action-stack">
              {queryRoom === gameCode ? (
                <button className="button primary" onClick={joinRoom}>Odaya katıl</button>
              ) : (
                <button className="button primary" onClick={() => startLobby(false)}>Oda aç</button>
              )}
              <button className="button soft" onClick={() => startLobby(true)}><Bot size={18} /> Demo başlat</button>
            </div>
          </Screen>
        )}

        {phase === "lobby" && (
          <Screen title="Oda hazır" subtitle={`${players.length}/${requiredPlayers} oyuncu`}>
            <div className="join-card">
              <div className="qr" aria-label="Oda katılım QR kodu">
                <QRCodeSVG value={joinUrl} size={108} marginSize={1} bgColor="#fff7ed" fgColor="#130710" />
              </div>
              <div>
                <small>Oda kodu</small>
                <strong>{gameCode}</strong>
                <button className="tiny-button" onClick={copyJoinUrl}>{joinCopied ? <Check size={15} /> : <Copy size={15} />} Link</button>
              </div>
            </div>
            <PlayerList players={players} />
            <div className="action-stack">
              <button className="button soft" disabled={players.length >= requiredPlayers} onClick={addDemoBot}><Bot size={18} /> Bot ekle</button>
              <button className="button primary" disabled={players.length < requiredPlayers} onClick={assignRoles}>Rolleri dağıt</button>
            </div>
          </Screen>
        )}

        {phase === "roles" && human?.role && (
          <Screen title="Rolün" subtitle="Telefonu sadece sen gör.">
            <div className={`role-card ${human.team}`}>
              <span>{human.role}</span>
              <p>{roleMeta[human.role].hint}</p>
            </div>
            <PlayerList players={players} hideRoles />
            <button className="button primary bottom" onClick={startNight}><Moon size={18} /> Geceye geç</button>
          </Screen>
        )}

        {phase === "night" && (
          <Screen title="Gece" subtitle="Oyuncular gizli aksiyonlarını tamamlıyor.">
            <NightSummary human={human} players={players} action={nightAction} onVampireTarget={chooseVampireTarget} />
            <button className="button primary bottom" onClick={resolveNight}>Sabahı aç</button>
          </Screen>
        )}

        {phase === "day" && (
          <Screen title="Gündüz" subtitle="Konuşma zamanı.">
            <div className="announcement">{eliminated ? `${eliminated.name} bu gece elendi.` : "Bu gece kimse elenmedi."}</div>
            <PlayerList players={players} hideRoles />
            <button className="button primary bottom" onClick={startVoting}><Vote size={18} /> Oylamaya geç</button>
          </Screen>
        )}

        {phase === "vote" && human && (
          <Screen title="Oylama" subtitle="Bir fotoğraf seç, sonra oyunu tamamla.">
            <VoteProgress done={votersDone} pending={pendingVoters} total={alivePlayers.length} />
            <div className="vote-grid">
              {alivePlayers.filter((player) => player.id !== human.id).map((player) => (
                <button
                  key={player.id}
                  className={`vote-card ${selectedVoteId === player.id ? "selected" : ""}`}
                  disabled={human.voteDone}
                  onClick={() => setSelectedVoteId(player.id)}
                >
                  <img src={player.photo} alt={player.name} />
                  <strong>{player.name}</strong>
                  <small>Seç</small>
                </button>
              ))}
            </div>
            <button className="button primary bottom" disabled={!selectedVoteId || human.voteDone} onClick={confirmHumanVote}>
              {human.voteDone ? "Oy tamamlandı" : "Oyumu tamamla"}
            </button>
            {voteNotice && <p className="vote-hint">{voteNotice}</p>}
          </Screen>
        )}

        {phase === "voteReveal" && (
          <Screen title="Sonuç geliyor" subtitle={revealStep === "countdown" ? "Oylar sayılıyor." : "Açıklama zamanı."}>
            <VoteProgress done={votersDone} pending={pendingVoters} total={alivePlayers.length} />
            <RevealPanel step={revealStep} countdown={countdown} eliminated={eliminated} />
          </Screen>
        )}

        {(phase === "result" || phase === "gameover") && (
          <Screen title={phase === "gameover" ? "Oyun bitti" : "Sonuç"} subtitle={winner ?? "Tur tamamlandı."}>
            <RevealPanel step="role" countdown={0} eliminated={eliminated} />
            <PlayerList players={players} hideRoles revealPlayerId={eliminatedId} />
            <div className="action-stack">
              {phase !== "gameover" ? (
                <button className="button primary" onClick={nextRound}><Sun size={18} /> Sonraki tur</button>
              ) : (
                <p className="vote-hint">{winner}</p>
              )}
              <button className="button soft" onClick={resetGame}><RotateCcw size={18} /> Yeni oyun</button>
            </div>
          </Screen>
        )}

        <Log events={log} />
      </div>
    </main>
  );
}

function phaseLabel(phase: Phase) {
  const labels: Record<Phase, string> = {
    setup: "Kurulum",
    lobby: "Lobi",
    roles: "Rol",
    night: "Gece",
    day: "Gündüz",
    vote: "Oylama",
    voteReveal: "Sayım",
    result: "Sonuç",
    gameover: "Bitti",
  };
  return labels[phase];
}

function Screen({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="screen">
      <div className="screen-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Counter({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
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

function PlayerList({ players, hideRoles, revealPlayerId }: { players: Player[]; hideRoles?: boolean; revealPlayerId?: string }) {
  return (
    <div className="player-list">
      {players.map((player) => (
        <article key={player.id} className={`player-row ${!player.alive ? "dead" : ""}`}>
          <img src={player.photo} alt={player.name} />
          <div>
            <strong>{player.name}</strong>
            <small>{!player.alive ? "Elendi" : player.isHuman ? "Oyuncu" : "Demo"}</small>
          </div>
          {player.role && (!hideRoles || player.id === revealPlayerId) && <span>{player.role}</span>}
        </article>
      ))}
    </div>
  );
}

function VoteProgress({ done, pending, total }: { done: Player[]; pending: Player[]; total: number }) {
  return (
    <div className="vote-progress">
      <div>
        <strong>{done.length}/{total}</strong>
        <small>oy tamamlandı</small>
      </div>
      <small className="vote-caption">Tamamlayanlar yeşil, bekleyenler gri.</small>
      <div className="voter-cloud">
        {done.map((player) => <span className="done" key={player.id}>{player.name}</span>)}
        {pending.map((player) => <span className="pending" key={player.id}>{player.name}</span>)}
      </div>
    </div>
  );
}

function RevealPanel({ step, countdown, eliminated }: { step: RevealStep; countdown: number; eliminated?: Player }) {
  if (step === "countdown") {
    return (
      <div className="reveal-panel pulse">
        <span className="countdown">{countdown}</span>
        <strong>Oylar sayılıyor</strong>
      </div>
    );
  }

  if (step === "eliminated") {
    return (
      <div className="reveal-panel">
        <strong>{eliminated?.name ?? "Bir oyuncu"} elendi.</strong>
        <small>Rolü birazdan açıklanacak.</small>
      </div>
    );
  }

  return (
    <div className="reveal-panel">
      <strong>{eliminated?.name ?? "Elenen oyuncu"} elendi.</strong>
      <small>Bu oyuncu bir {eliminated?.role ?? "oyuncu"} idi.</small>
    </div>
  );
}

function NightSummary({
  human,
  players,
  action,
  onVampireTarget,
}: {
  human?: Player;
  players: Player[];
  action: NightAction;
  onVampireTarget: (targetId: string) => void;
}) {
  if (human?.role === "Vampir" && human.alive) {
    return (
      <div className="night-card vampire-action">
        <Moon />
        <div>
          <strong>Bu gece hedef seç</strong>
          <small>Telefonu sakin kullan; diğer oyuncular sadece bekleme ekranı görür.</small>
        </div>
        <div className="vote-grid">
          {players.filter((player) => player.alive && player.team !== "vampir").map((player) => (
            <button
              key={player.id}
              className={`vote-card ${action.vampireTargetId === player.id ? "selected" : ""}`}
              onClick={() => onVampireTarget(player.id)}
            >
              <img src={player.photo} alt={player.name} />
              <strong>{player.name}</strong>
              <small>Hedef seç</small>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="night-card">
      <Moon />
      <div>
        <strong>Gece başladı</strong>
        <small>Gizli aksiyonlar tamamlanırken bekle.</small>
      </div>
    </div>
  );
}

function Log({ events }: { events: string[] }) {
  return (
    <aside className="log">
      <Sparkles size={16} />
      <span>{events[0]}</span>
    </aside>
  );
}

export default App;
