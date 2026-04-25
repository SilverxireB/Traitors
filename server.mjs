import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";

const portArgIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
const portArg = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : undefined;
const port = Number(portArg ?? process.env.PORT ?? 4173);
const root = resolve("dist");
const rooms = new Map();
const clients = new Map();
const roomTimers = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const demoNames = ["Mina", "Bora", "Lara", "Deniz", "Efe", "Ada", "Mert", "Nora"];
const botSelfies = [
  "https://randomuser.me/api/portraits/women/44.jpg",
  "https://randomuser.me/api/portraits/men/32.jpg",
  "https://randomuser.me/api/portraits/women/68.jpg",
  "https://randomuser.me/api/portraits/men/75.jpg",
  "https://randomuser.me/api/portraits/men/46.jpg",
  "https://randomuser.me/api/portraits/women/12.jpg",
  "https://randomuser.me/api/portraits/men/22.jpg",
  "https://randomuser.me/api/portraits/women/90.jpg",
];
const initialSettings = {
  vampireCount: 2,
  villagerCount: 4,
  seerEnabled: true,
  doctorEnabled: true,
};
const roleMeta = {
  Vampir: { team: "vampir" },
  Koylu: { team: "koy" },
  Kahin: { team: "koy" },
  Doktor: { team: "koy" },
};

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function botPhotoFor(index) {
  return botSelfies[index % botSelfies.length];
}

function totalPlayers(settings) {
  return settings.vampireCount + settings.villagerCount + Number(settings.seerEnabled) + Number(settings.doctorEnabled);
}

function roleDeck(settings) {
  return [
    ...Array.from({ length: settings.vampireCount }, () => "Vampir"),
    ...Array.from({ length: settings.villagerCount }, () => "Koylu"),
    ...(settings.seerEnabled ? ["Kahin"] : []),
    ...(settings.doctorEnabled ? ["Doktor"] : []),
  ];
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function pickTarget(players, avoidId) {
  const options = players.filter((player) => player.alive && player.id !== avoidId);
  return options[Math.floor(Math.random() * options.length)];
}

function getWinner(players) {
  if (!players.length) return undefined;
  const aliveVampires = players.filter((player) => player.alive && player.team === "vampir").length;
  const aliveVillage = players.filter((player) => player.alive && player.team === "koy").length;
  if (aliveVampires === 0) return "Köylüler kazandı";
  if (aliveVampires > 0 && aliveVillage <= 1) return "Vampirler kazandı";
  return undefined;
}

function getVoteTarget(players) {
  const tallies = players.reduce((acc, player) => {
    if (player.voteTargetId) acc[player.voteTargetId] = (acc[player.voteTargetId] ?? 0) + 1;
    return acc;
  }, {});
  const [targetId] = Object.entries(tallies).sort((a, b) => b[1] - a[1])[0] ?? [];
  return players.find((player) => player.id === targetId);
}

function createEmptyState(settings = initialSettings) {
  return {
    players: [],
    phase: "setup",
    settings,
    round: 1,
    nightAction: {},
    revealStep: "countdown",
    countdown: 10,
    log: ["Oyun hazır."],
  };
}

function clearRoomTimers(room) {
  for (const timer of roomTimers.get(room) ?? []) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  roomTimers.set(room, []);
}

function trackTimer(room, timer) {
  const timers = roomTimers.get(room) ?? [];
  timers.push(timer);
  roomTimers.set(room, timers);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(root, requestedPath);
  const safePath = filePath.startsWith(root) && existsSync(filePath) ? filePath : join(root, "index.html");

  try {
    const body = await readFile(safePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(safePath)] ?? "application/octet-stream",
      "cache-control": safePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

const wss = new WebSocketServer({ server, path: "/room-ws" });

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload) {
  for (const [socket, socketRoom] of clients.entries()) {
    if (socketRoom === room) send(socket, payload);
  }
}

function setRoomState(room, state) {
  rooms.set(room, state);
  broadcast(room, { type: "state", state });
}

function log(state, event) {
  return { ...state, log: [event, ...(state.log ?? [])] };
}

function upsertPlayer(players, player) {
  return players.some((current) => current.id === player.id)
    ? players.map((current) => (current.id === player.id ? { ...current, ...player } : current))
    : [...players, player];
}

function createLobbyState(host, settings, withBots) {
  const safeSettings = settings ?? initialSettings;
  const botCount = withBots ? Math.max(totalPlayers(safeSettings) - 1, 0) : 0;
  const bots = Array.from({ length: botCount }, (_, index) => {
    const name = demoNames[index % demoNames.length];
    return {
      id: createId("bot"),
      name,
      photo: botPhotoFor(index),
      isHuman: false,
      alive: true,
      voteDone: false,
    };
  });

  return {
    ...createEmptyState(safeSettings),
    players: [host, ...bots],
    phase: "lobby",
    log: [withBots ? "Demo oyuncuları eklendi." : "Oda açıldı."],
  };
}

function assignRoles(state) {
  const baseDeck = roleDeck(state.settings);
  const deck = baseDeck.includes("Vampir")
    ? ["Vampir", ...shuffle(baseDeck.filter((role, index) => role !== "Vampir" || index !== baseDeck.indexOf("Vampir")))]
    : shuffle(baseDeck);
  const players = state.players.map((player, index) => {
    const role = deck[index] ?? "Koylu";
    return { ...player, role, team: roleMeta[role].team };
  });
  return log({ ...state, players, phase: "roles" }, "Roller dağıtıldı.");
}

function startNight(state, incrementRound = false) {
  const seer = state.players.find((player) => player.alive && player.role === "Kahin");
  const doctor = state.players.find((player) => player.alive && player.role === "Doktor");
  return log(
    {
      ...state,
      round: incrementRound ? state.round + 1 : state.round,
      phase: "night",
      nightAction: {
        vampireTargetId: undefined,
        seerTargetId: seer ? pickTarget(state.players, seer.id)?.id : undefined,
        doctorTargetId: doctor ? pickTarget(state.players)?.id : undefined,
      },
    },
    "Gece başladı.",
  );
}

function resolveNight(state) {
  const fallbackTarget = pickTarget(state.players.filter((player) => player.team !== "vampir"));
  const target = state.players.find((player) => player.id === state.nightAction?.vampireTargetId) ?? fallbackTarget;
  const protectedPlayer = state.players.find((player) => player.id === state.nightAction?.doctorTargetId);
  const eliminatedId = target && target.id !== protectedPlayer?.id ? target.id : undefined;
  const players = state.players.map((player) => (eliminatedId && player.id === eliminatedId ? { ...player, alive: false } : player));
  return log(
    {
      ...state,
      players,
      eliminatedId,
      phase: getWinner(players) ? "gameover" : "day",
    },
    eliminatedId ? `${target.name} gece elendi.` : "Gece sakin geçti.",
  );
}

function startVoting(room, state) {
  clearRoomTimers(room);
  const players = state.players.map((player) => ({ ...player, voteDone: false, voteTargetId: undefined }));
  const nextState = log({ ...state, players, phase: "vote" }, "Oylama başladı. Demo oyuncuları sırayla oy verecek.");
  setRoomState(room, nextState);
  scheduleBotVotes(room);
}

function scheduleBotVotes(room) {
  const state = rooms.get(room);
  if (!state || state.phase !== "vote") return;
  const botVoters = state.players.filter((player) => player.alive && !player.isHuman);
  const delayStep = botVoters.length > 1 ? 10000 / (botVoters.length - 1) : 0;

  botVoters.forEach((bot, index) => {
    const delay = Math.round(1200 + index * delayStep);
    const timer = setTimeout(() => {
      const current = rooms.get(room);
      if (!current || current.phase !== "vote") return;
      const voter = current.players.find((player) => player.id === bot.id && player.alive && !player.voteDone);
      if (!voter) return;
      const target = pickTarget(current.players, voter.id);
      if (!target) return;
      const players = current.players.map((player) =>
        player.id === voter.id ? { ...player, voteDone: true, voteTargetId: target.id } : player,
      );
      const nextState = log({ ...current, players }, `${voter.name} oyunu tamamladı.`);
      setRoomState(room, nextState);
      maybeBeginVoteReveal(room);
    }, delay);
    trackTimer(room, timer);
  });
}

function maybeBeginVoteReveal(room) {
  const state = rooms.get(room);
  if (!state || state.phase !== "vote") return;
  const alive = state.players.filter((player) => player.alive);
  if (alive.some((player) => !player.voteDone)) return;
  beginVoteReveal(room);
}

function beginVoteReveal(room) {
  clearRoomTimers(room);
  const state = rooms.get(room);
  if (!state || state.phase !== "vote") return;
  setRoomState(room, log({ ...state, phase: "voteReveal", revealStep: "countdown", countdown: 10 }, "Herkes oyunu tamamladı. Sayım başladı."));

  for (let value = 9; value >= 0; value -= 1) {
    const timer = setTimeout(() => {
      const current = rooms.get(room);
      if (!current || current.phase !== "voteReveal" || current.revealStep !== "countdown") return;
      setRoomState(room, { ...current, countdown: value });
    }, (10 - value) * 1000);
    trackTimer(room, timer);
  }

  const resultTimer = setTimeout(() => {
    const current = rooms.get(room);
    if (!current || current.phase !== "voteReveal") return;
    const target = getVoteTarget(current.players);
    if (!target) return;
    setRoomState(room, log({ ...current, eliminatedId: target.id, revealStep: "eliminated" }, `${target.name} elendi. Rolü birazdan açıklanacak.`));
  }, 10200);

  const roleTimer = setTimeout(() => {
    const current = rooms.get(room);
    if (!current || current.phase !== "voteReveal") return;
    const target = getVoteTarget(current.players);
    if (!target) return;
    const players = current.players.map((player) => (player.id === target.id ? { ...player, alive: false } : player));
    setRoomState(
      room,
      log(
        {
          ...current,
          players,
          eliminatedId: target.id,
          revealStep: "role",
          phase: getWinner(players) ? "gameover" : "result",
        },
        `${target.name} bir ${target.role ?? "oyuncu"} çıktı.`,
      ),
    );
  }, 13200);
  trackTimer(room, resultTimer);
  trackTimer(room, roleTimer);
}

function handleCommand(room, message) {
  const state = rooms.get(room);

  if (message.type === "create-room" && message.host) {
    clearRoomTimers(room);
    setRoomState(room, createLobbyState(message.host, message.settings, Boolean(message.withBots)));
    return;
  }

  if (message.type === "reset-room") {
    clearRoomTimers(room);
    setRoomState(room, createEmptyState(message.settings ?? initialSettings));
    return;
  }

  if (!state) {
    broadcast(room, { type: "error", message: "Oda bulunamadı." });
    return;
  }

  if (message.type === "add-player" && message.player) {
    setRoomState(room, log({ ...state, players: upsertPlayer(state.players, message.player) }, `${message.player.name} odaya katıldı.`));
    return;
  }

  if (message.type === "add-bot") {
    if (state.players.length >= totalPlayers(state.settings)) return;
    const name = demoNames[state.players.length % demoNames.length];
    setRoomState(
      room,
      log(
        {
          ...state,
          players: [
            ...state.players,
            {
              id: createId("bot"),
              name,
              photo: botPhotoFor(state.players.length - 1),
              isHuman: false,
              alive: true,
              voteDone: false,
            },
          ],
        },
        `${name} eklendi.`,
      ),
    );
    return;
  }

  if (message.type === "assign-roles") {
    setRoomState(room, assignRoles(state));
    return;
  }

  if (message.type === "start-voting") {
    startVoting(room, state);
    return;
  }

  if (message.type === "cast-vote" && message.playerId && message.targetId) {
    if (state.phase !== "vote") return;
    const voter = state.players.find((player) => player.id === message.playerId && player.alive);
    if (!voter) return;
    const players = state.players.map((player) =>
      player.id === message.playerId ? { ...player, voteDone: true, voteTargetId: message.targetId } : player,
    );
    setRoomState(room, log({ ...state, players }, `${voter.name} oyunu tamamladı.`));
    maybeBeginVoteReveal(room);
    return;
  }

  if (message.type === "vampire-target" && message.playerId && message.targetId) {
    const player = state.players.find((current) => current.id === message.playerId);
    if (state.phase !== "night" || player?.role !== "Vampir" || !player.alive) return;
    setRoomState(room, log({ ...state, nightAction: { ...state.nightAction, vampireTargetId: message.targetId } }, "Vampir hedefini seçti."));
    return;
  }

  if (message.type === "resolve-night") {
    setRoomState(room, resolveNight(state));
    return;
  }

  if (message.type === "next-round") {
    setRoomState(room, startNight(state, true));
  }
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    const room = message.room ?? "VAMP-2026";
    clients.set(socket, room);

    if (message.type === "join") {
      send(socket, { type: "state", state: rooms.get(room) ?? null });
      return;
    }

    handleCommand(room, message);
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Vampir Koylu server listening on http://0.0.0.0:${port}`);
});
