import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  set
} from 'firebase/database';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ROOM_CHARS[byte % ROOM_CHARS.length]).join('');
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 20);
}

export async function createRoom(db, uid, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new Error('Masukkan nama moderator terlebih dahulu.');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode();
    const metaRef = ref(db, `rooms/${code}/meta`);
    const createdAt = Date.now();
    const reservation = await runTransaction(metaRef, (current) => current === null
      ? { hostUid: uid, createdAt, status: 'lobby', title: 'StockLab Online' }
      : undefined);
    if (!reservation.committed) continue;
    await set(ref(db, `rooms/${code}/players/${uid}`), { uid, name, joinedAt: createdAt, isHost: true });
    return code;
  }
  throw new Error('Belum berhasil membuat kode room unik. Coba lagi.');
}

export async function joinRoom(db, uid, rawName, rawCode) {
  const name = cleanName(rawName);
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Kode room harus terdiri dari 6 karakter.');

  const metaSnap = await get(ref(db, `rooms/${code}/meta`));
  if (!metaSnap.exists()) throw new Error('Room tidak ditemukan. Periksa kembali kodenya.');
  const meta = metaSnap.val();
  const existingPlayer = await get(ref(db, `rooms/${code}/players/${uid}`));
  if (existingPlayer.exists()) return code;
  if (!name) throw new Error('Masukkan nama pemain terlebih dahulu.');
  if (meta.status !== 'lobby') throw new Error('Permainan sudah dimulai. Room tidak menerima pemain baru.');
  const playersSnap = await get(ref(db, `rooms/${code}/players`));
  const players = playersSnap.val() || {};
  if (!players[uid] && Object.keys(players).length >= 5) throw new Error('Room sudah penuh (maksimal 5 pemain).');

  await set(ref(db, `rooms/${code}/players/${uid}`), { uid, name, joinedAt: Date.now(), isHost: false });
  return code;
}

export function subscribeRoom(db, code, callback, onError) {
  const room = { meta: null, players: {}, presence: {}, state: null };
  let metaReady = false;
  const publish = () => {
    if (metaReady) callback(room.meta ? { ...room, players: room.players || {} } : null);
  };
  const unsubscribers = [
    onValue(ref(db, `rooms/${code}/meta`), (snapshot) => { room.meta = snapshot.val(); metaReady = true; publish(); }, onError),
    onValue(ref(db, `rooms/${code}/players`), (snapshot) => { room.players = snapshot.val() || {}; publish(); }, onError),
    onValue(ref(db, `rooms/${code}/presence`), (snapshot) => { room.presence = snapshot.val() || {}; publish(); }, onError),
    onValue(ref(db, `rooms/${code}/state`), (snapshot) => { room.state = snapshot.val(); publish(); }, onError)
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function trackPresence(db, code, uid, onError) {
  const playerRef = ref(db, `rooms/${code}/presence/${uid}`);
  return onValue(ref(db, '.info/connected'), async (snapshot) => {
    if (snapshot.val() !== true) return;
    try {
      await onDisconnect(playerRef).set({ online: false, lastSeen: Date.now() });
      await set(playerRef, { online: true, lastSeen: Date.now() });
    } catch (error) {
      onError?.(error);
    }
  }, onError);
}

export async function removePresence(db, code, uid) {
  await remove(ref(db, `rooms/${code}/presence/${uid}`));
}

export async function updateRoomStatus(db, code, status) {
  await set(ref(db, `rooms/${code}/meta/status`), status);
}

export async function publishGameState(db, code, game) {
  const publicGame = structuredClone(game);
  delete publicGame.actionDeck;
  delete publicGame.economyPiles;
  publicGame.players = publicGame.players.map(({ coins, utang, ...player }) => player);
  await Promise.all([
    set(ref(db, `rooms/${code}/private/hostState`), game),
    ...game.players.map((player) => set(ref(db, `rooms/${code}/private/playerState/${player.uid}`), { coins: player.coins, utang: player.utang }))
  ]);
  await set(ref(db, `rooms/${code}/state`), publicGame);
}

export function subscribeHostGame(db, code, callback, onError) {
  return onValue(ref(db, `rooms/${code}/private/hostState`), (snapshot) => callback(snapshot.val()), onError);
}

export function subscribePrivatePlayer(db, code, uid, callback, onError) {
  return onValue(ref(db, `rooms/${code}/private/playerState/${uid}`), (snapshot) => callback(snapshot.val()), onError);
}

export async function publishPrivateNotice(db, code, uid, notice) {
  await set(ref(db, `rooms/${code}/private/notices/${uid}`), notice);
}

export function subscribePrivateNotice(db, code, uid, callback, onError) {
  return onValue(ref(db, `rooms/${code}/private/notices/${uid}`), (snapshot) => callback(snapshot.val()), onError);
}

export async function sendCommand(db, code, uid, type, payload = {}) {
  const commandRef = push(ref(db, `rooms/${code}/commands/${uid}`));
  await set(commandRef, { type, payload, createdAt: Date.now() });
}

export function subscribeCommands(db, code, playerUids, callback, onError) {
  const unsubscribers = playerUids.map((uid) => onChildAdded(ref(db, `rooms/${code}/commands/${uid}`), (snapshot) => {
    callback(uid, snapshot.key, snapshot.val());
  }, onError));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function removeCommand(db, code, uid, commandId) {
  await remove(ref(db, `rooms/${code}/commands/${uid}/${commandId}`));
}

export async function submitBid(db, code, uid, round, bid) {
  await set(ref(db, `rooms/${code}/private/bids/${uid}`), { round, bid, submittedAt: Date.now() });
}

export async function readBids(db, code, playerUids) {
  const entries = await Promise.all(playerUids.map(async (uid) => {
    const snapshot = await get(ref(db, `rooms/${code}/private/bids/${uid}`));
    return [uid, snapshot.val()];
  }));
  return Object.fromEntries(entries.filter(([, bid]) => bid));
}

export async function clearBids(db, code, playerUids) {
  await Promise.all(playerUids.map((uid) => remove(ref(db, `rooms/${code}/private/bids/${uid}`))));
}

export function subscribeBids(db, code, playerUids, callback, onError) {
  const bids = {};
  const unsubscribers = playerUids.map((uid) => onValue(ref(db, `rooms/${code}/private/bids/${uid}`), (snapshot) => {
    if (snapshot.exists()) bids[uid] = snapshot.val();
    else delete bids[uid];
    callback({ ...bids });
  }, onError));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function leaveRoom(db, code, uid, isHost) {
  if (isHost) {
    await set(ref(db, `rooms/${code}/meta/status`), 'closed');
    return;
  }
  await remove(ref(db, `rooms/${code}/players/${uid}`));
}
