import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Moon, RotateCcw, Sparkles, Upload, Vote } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import heic2any from "heic2any";
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
  nightAction: NightAction;
  eliminatedId?: string;
  revealStep: RevealStep;
  countdown: number;
  log: string[];
};

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

function createRoomCode() {
  return `VAMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function avatarFor(name: string, index: number) {
  return `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(name)}-${index}`;
}

function totalPlayers(settings: GameSettings) {
  return settings.vampireCount + settings.villagerCount + Number(settings.seerEnabled) + Number(settings.doctorEnabled);
}

function getWinner(players: Player[]) {
  if (!players.length) return undefined;
  const aliveVampires = players.filter((player) => player.alive && player.team === "vampir").length;
  const aliveVillage = players.filter((player) => player.alive && player.team === "koy").length;
  if (aliveVampires === 0) return "Köylüler kazandı";
  if (aliveVampires > 0 && aliveVillage <= 1) return "Vampirler kazandı";
  return undefined;
}

function getVoteRows(players: Player[]) {
  return players
    .filter((player) => player.voteTargetId)
    .map((player) => ({
      voter: player,
      target: players.find((target) => target.id === player.voteTargetId),
    }))
    .filter((row): row is { voter: Player; target: Player } => Boolean(row.target));
}

function resizePhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (file.type && !file.type.startsWith("image/")) {
      reject(new Error("Lütfen bir fotoğraf seç."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Fotoğraf okunamadı."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Bu fotoğraf formatı desteklenmedi."));
      image.onload = () => {
        const maxSize = 720;
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Fotoğraf işlenemedi."));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function filePreview(file: File) {
  return URL.createObjectURL(file);
}

function storageKey(roomCode: string, key: string) {
  return `vampir:${roomCode}:${key}`;
}

function getOrCreateStoredId(roomCode: string) {
  const key = storageKey(roomCode, "playerId");
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = createId("player");
  window.localStorage.setItem(key, next);
  return next;
}

async function normalizePhotoFile(file: File) {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.82 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
}

function App() {
  const queryRoom = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase();
  const [phase, setPhase] = useState<Phase>("setup");
  const [roomCode] = useState(() => queryRoom || createRoomCode());
  const [hasJoinedRoom, setHasJoinedRoom] = useState(() => !queryRoom);
  const [isHost] = useState(() => !queryRoom || window.localStorage.getItem(storageKey(queryRoom, "role")) === "host");
  const [settings, setSettings] = useState<GameSettings>(initialSettings);
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem(storageKey(queryRoom || "draft", "name")) || (queryRoom ? "Oyuncu" : "Ev sahibi"));
  const [playerPhoto, setPlayerPhoto] = useState(() => window.localStorage.getItem(storageKey(queryRoom || "draft", "photo")) || avatarFor(queryRoom ? "Oyuncu" : "Ev sahibi", 0));
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState(1);
  const [nightAction, setNightAction] = useState<NightAction>({});
  const [selectedVoteId, setSelectedVoteId] = useState<string>();
  const [voteNotice, setVoteNotice] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [revealStep, setRevealStep] = useState<RevealStep>("countdown");
  const [countdown, setCountdown] = useState(10);
  const [eliminatedId, setEliminatedId] = useState<string>();
  const [joinCopied, setJoinCopied] = useState(false);
  const [log, setLog] = useState<string[]>(["Oyun hazır."]);
  const wsRef = useRef<WebSocket | null>(null);
  const [playerId] = useState(() => getOrCreateStoredId(roomCode));
  const clientIdRef = useRef(createId("client"));
  const hasJoinedRoomRef = useRef(!queryRoom);

  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  const human = players.find((player) => player.id === playerId);
  const alivePlayers = players.filter((player) => player.alive);
  const eliminated = players.find((player) => player.id === eliminatedId);
  const requiredPlayers = totalPlayers(settings);
  const winner = getWinner(players);
  const eliminatedPlayers = players.filter((player) => !player.alive);
  const voteRows = getVoteRows(players);
  const vampireTeam = players.filter((player) => player.role === "Vampir");

  const votersDone = players.filter((player) => player.alive && player.voteDone);
  const pendingVoters = players.filter((player) => player.alive && !player.voteDone);

  const applyRoomState = useCallback((state: RoomState | null) => {
    if (!state) {
      hasJoinedRoomRef.current = false;
      setHasJoinedRoom(false);
      setPhase("setup");
      setPlayers([]);
      setLog([isHost ? "Oda açmak için profilini hazırla." : "Bu oda henüz açılmadı."]);
      return;
    }
    const localPlayer = state.players.find((player) => player.id === playerId);
    if (localPlayer) {
      window.localStorage.setItem(storageKey(roomCode, "playerId"), playerId);
      window.localStorage.setItem(storageKey(roomCode, "name"), localPlayer.name);
      window.localStorage.setItem(storageKey(roomCode, "photo"), localPlayer.photo);
    }
    hasJoinedRoomRef.current = Boolean(localPlayer);
    setHasJoinedRoom(Boolean(localPlayer));
    if (!isHost && !localPlayer) {
      setSettings(state.settings);
      setLog(["Odaya katılmak için isim ve fotoğrafını gir."]);
      setPhase("setup");
      setPlayers(state.players);
      return;
    }
    setPlayers(state.players);
    setPhase(state.phase);
    setSettings(state.settings);
    setRound(state.round);
    setNightAction(state.nightAction);
    setEliminatedId(state.eliminatedId);
    setRevealStep(state.revealStep);
    setCountdown(state.countdown);
    setLog(state.log);
  }, [isHost, playerId, roomCode]);

  useEffect(() => {
    if (!queryRoom) {
      window.history.replaceState(null, "", `${window.location.pathname}?room=${roomCode}`);
    }
  }, [queryRoom, roomCode]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/room-ws`);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", room: roomCode, clientId: clientIdRef.current }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as { type: "state"; state: RoomState | null };
      if (message.type !== "state") return;
      applyRoomState(message.state);
    };

    return () => socket.close();
  }, [applyRoomState, roomCode]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/room-state?room=${encodeURIComponent(roomCode)}`, { cache: "no-store" });
        const payload = (await response.json()) as { state: RoomState | null };
        applyRoomState(payload.state);
      } catch {
        // WebSocket remains primary; polling is a quiet fallback for mobile sleep/reconnect.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [applyRoomState, roomCode]);

  function sendCommand(payload: Record<string, unknown>) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setLog(["Bağlantı hazır değil. Birkaç saniye sonra tekrar dene."]);
      return false;
    }
    wsRef.current.send(JSON.stringify({ ...payload, room: roomCode, clientId: clientIdRef.current }));
    return true;
  }

  function updateSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handlePhotoUpload(file?: File) {
    if (!file) return;
    setPhotoNotice("Fotoğraf hazırlanıyor...");
    const fallbackPreview = filePreview(file);
    setPlayerPhoto(fallbackPreview);
    window.localStorage.setItem(storageKey(roomCode, "photo"), fallbackPreview);
    try {
      const normalizedFile = await normalizePhotoFile(file);
      const photo = await resizePhoto(normalizedFile);
      setPlayerPhoto(photo);
      window.localStorage.setItem(storageKey(roomCode, "photo"), photo);
      setPhotoNotice("Fotoğraf yüklendi.");
    } catch (error) {
      setPhotoNotice(error instanceof Error ? `${error.message} Ham önizleme kullanılıyor.` : "Ham önizleme kullanılıyor.");
    }
  }

  function startLobby(withBots: boolean) {
    const host: Player = {
      id: playerId,
      name: playerName.trim() || "Ev sahibi",
      photo: playerPhoto,
      isHuman: true,
      alive: true,
      voteDone: false,
    };
    window.localStorage.setItem(storageKey(roomCode, "role"), "host");
    window.localStorage.setItem(storageKey(roomCode, "name"), host.name);
    window.localStorage.setItem(storageKey(roomCode, "photo"), host.photo);
    hasJoinedRoomRef.current = true;
    setHasJoinedRoom(true);
    sendCommand({ type: "create-room", host, settings, withBots });
  }

  function joinRoom() {
    const guestNumber = players.filter((player) => player.isHuman).length + 1;
    const joiningPlayer: Player = {
      id: playerId,
      name: playerName.trim() && !["Ev sahibi", "Oyuncu"].includes(playerName.trim()) ? playerName.trim() : `Oyuncu ${guestNumber}`,
      photo: playerPhoto,
      isHuman: true,
      alive: true,
      voteDone: false,
    };
    if (sendCommand({ type: "add-player", player: joiningPlayer })) {
      window.localStorage.setItem(storageKey(roomCode, "name"), joiningPlayer.name);
      window.localStorage.setItem(storageKey(roomCode, "photo"), joiningPlayer.photo);
      setLog(["Odaya katılma isteği gönderildi."]);
    }
  }

  function addDemoBot() {
    sendCommand({ type: "add-bot" });
  }

  function assignRoles() {
    sendCommand({ type: "assign-roles" });
  }

  function chooseVampireTarget(targetId: string) {
    if (!human) return;
    sendCommand({ type: "vampire-target", playerId: human.id, targetId });
  }

  function resolveNight() {
    sendCommand({ type: "resolve-night" });
  }

  function startVoting() {
    setSelectedVoteId(undefined);
    setVoteNotice("");
    sendCommand({ type: "start-voting" });
  }

  function confirmHumanVote() {
    if (!human || !human.alive) {
      setVoteNotice("Elendiğin için oy kullanamazsın.");
      return;
    }
    if (!selectedVoteId) {
      setVoteNotice("Önce bir fotoğraf seç.");
      return;
    }
    if (sendCommand({ type: "cast-vote", playerId: human.id, targetId: selectedVoteId })) {
      setVoteNotice("");
      setLog((current) => [`${human.name} oyunu tamamladı.`, ...current]);
    }
  }

  function nextRound() {
    sendCommand({ type: "next-round" });
  }

  function resetGame() {
    sendCommand({ type: "reset-room", settings: initialSettings });
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

        {log[0] && <Log event={log[0]} />}

        {eliminatedPlayers.length > 0 && (
          <EliminatedStrip players={eliminatedPlayers} />
        )}

        {phase === "setup" && (
          <Screen
            title={!isHost && !hasJoinedRoom ? "Odaya katıl" : "Oyunu kur"}
            subtitle={!isHost && !hasJoinedRoom ? "İsim ve fotoğrafını gir, canlı odaya bağlan." : "Oyuncu sayısı, rol dağılımı ve profil."}
          >
            <div className="profile-card">
              <img src={playerPhoto} alt="Profil" />
              <div>
                <label>İsim</label>
                <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
                <label className="upload-button">
                  <Upload size={17} />
                  Fotoğraf seç
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      handlePhotoUpload(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {photoNotice && <small className="photo-notice">{photoNotice}</small>}
              </div>
            </div>

            {isHost && (
              <>
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
              </>
            )}

            <div className="action-stack">
              {!isHost ? (
                <button className="button primary" onClick={joinRoom}>Odaya katıl</button>
              ) : (
                <>
                  <button className="button primary" onClick={() => startLobby(false)}>Oda aç</button>
                  <button className="button soft" onClick={() => startLobby(true)}><Bot size={18} /> Demo başlat</button>
                </>
              )}
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
                <strong>{roomCode}</strong>
                <button className="tiny-button" onClick={copyJoinUrl}>{joinCopied ? <Check size={15} /> : <Copy size={15} />} Link</button>
              </div>
            </div>
            <PlayerList players={players} />
            {isHost ? (
              <div className="action-stack">
                <button className="button soft" disabled={players.length >= requiredPlayers} onClick={addDemoBot}><Bot size={18} /> Bot ekle</button>
                <button className="button primary" disabled={players.length < requiredPlayers} onClick={assignRoles}>Rolleri dağıt</button>
              </div>
            ) : (
              <p className="vote-hint">Ev sahibi oyunu başlatınca ekranın otomatik ilerler.</p>
            )}
          </Screen>
        )}

        {phase === "roles" && human?.role && (
          <Screen title="Rolün" subtitle="Telefonu sadece sen gör.">
            <div className={`role-card ${human.team}`}>
              <span>{human.role}</span>
              <p>{roleMeta[human.role].hint}</p>
            </div>
            {human.role === "Vampir" && <VampireTeam players={vampireTeam} />}
            <PlayerList players={players} hideRoles />
            {isHost ? (
              <button className="button primary bottom" onClick={startVoting}><Vote size={18} /> İlk oylamayı başlat</button>
            ) : (
              <p className="vote-hint">Ev sahibinin ilk oylamayı başlatması bekleniyor.</p>
            )}
          </Screen>
        )}

        {phase === "night" && (
          <Screen title="Gece" subtitle="Oyuncular gizli aksiyonlarını tamamlıyor.">
            <NightSummary human={human} players={players} vampires={vampireTeam} action={nightAction} onVampireTarget={chooseVampireTarget} />
            {isHost && <button className="button primary bottom" onClick={resolveNight}>Sabahı aç</button>}
          </Screen>
        )}

        {phase === "day" && (
          <Screen title="Gündüz" subtitle="Konuşma zamanı.">
            <div className="announcement">
              {eliminated
                ? `${eliminated.name} bu gece elendi. Bu oyuncu bir ${eliminated.role ?? "oyuncu"} idi.`
                : "Bu gece kimse elenmedi."}
            </div>
            <PlayerList players={players} hideRoles />
            {isHost ? (
              <button className="button primary bottom" onClick={startVoting}><Vote size={18} /> Oylamaya geç</button>
            ) : (
              <p className="vote-hint">Ev sahibinin oylamayı başlatması bekleniyor.</p>
            )}
          </Screen>
        )}

        {phase === "vote" && human?.alive && (
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

        {phase === "vote" && human && !human.alive && (
          <Screen title="Elendin" subtitle="Oylamayı izleyebilirsin, oy kullanamazsın.">
            <VoteProgress done={votersDone} pending={pendingVoters} total={alivePlayers.length} />
            <PlayerList players={players} hideRoles revealPlayerId={eliminatedId} />
          </Screen>
        )}

        {phase === "voteReveal" && (
          <Screen title="Sonuç geliyor" subtitle={revealStep === "countdown" ? "Oylar sayılıyor." : "Açıklama zamanı."}>
            <VoteProgress done={votersDone} pending={pendingVoters} total={alivePlayers.length} />
            {revealStep !== "countdown" && voteRows.length > 0 && <VoteTrace rows={voteRows} />}
            <RevealPanel step={revealStep} countdown={countdown} eliminated={eliminated} />
          </Screen>
        )}

        {(phase === "result" || phase === "gameover") && (
          <Screen title={phase === "gameover" ? "Oyun bitti" : "Sonuç"} subtitle={winner ?? "Tur tamamlandı."}>
            <RevealPanel step="role" countdown={0} eliminated={eliminated} />
            {voteRows.length > 0 && <VoteTrace rows={voteRows} />}
            <PlayerList players={players} hideRoles revealPlayerId={eliminatedId} />
            <div className="action-stack">
              {phase !== "gameover" ? (
                isHost ? (
                  <button className="button primary" onClick={nextRound}><Moon size={18} /> Geceye geç</button>
                ) : (
                  <p className="vote-hint">Ev sahibinin geceyi başlatması bekleniyor.</p>
                )
              ) : (
                <p className="vote-hint">{winner}</p>
              )}
              {isHost && <button className="button soft" onClick={resetGame}><RotateCcw size={18} /> Yeni oyun</button>}
            </div>
          </Screen>
        )}

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
  vampires,
  action,
  onVampireTarget,
}: {
  human?: Player;
  players: Player[];
  vampires: Player[];
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
        <VampireTeam players={vampires} compact />
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

function VampireTeam({ players, compact }: { players: Player[]; compact?: boolean }) {
  return (
    <section className={`vampire-team ${compact ? "compact" : ""}`}>
      <strong>Vampir ekibi</strong>
      <div>
        {players.map((player) => (
          <span key={player.id}>{player.name}</span>
        ))}
      </div>
    </section>
  );
}

function EliminatedStrip({ players }: { players: Player[] }) {
  return (
    <section className="eliminated-strip" aria-label="Elenen oyuncular">
      <strong>Elenenler</strong>
      <div>
        {players.map((player) => (
          <article key={player.id}>
            <span className="eliminated-photo">
              <img src={player.photo} alt={player.name} />
            </span>
            <small>{player.name}</small>
            <em>{player.role}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function VoteTrace({ rows }: { rows: Array<{ voter: Player; target: Player }> }) {
  return (
    <section className="vote-trace">
      <strong>Oylar</strong>
      {rows.map((row, index) => (
        <div key={`${row.voter.id}-${row.target.id}`} style={{ animationDelay: `${index * 120}ms` }}>
          <span>{row.voter.name}</span>
          <b>→</b>
          <span>{row.target.name}</span>
        </div>
      ))}
    </section>
  );
}

function Log({ event }: { event: string }) {
  return (
    <aside className="log">
      <Sparkles size={16} />
      <span>{event}</span>
    </aside>
  );
}

export default App;
