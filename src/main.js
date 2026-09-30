import { onValue, ref, set } from 'firebase/database';
import { authenticate, db } from './firebase.js';
import {
  ACTION_LABELS,
  SECTOR_NAMES,
  applyAction,
  applySale,
  bidsSubmitted,
  createGame,
  currentPlayer,
  finalScores,
  playerByUid,
  requestLoan,
  resolveBids,
  resolveEconomy,
  skipCurrentTurn,
  sectorPrice,
  startNextRound
} from './game-engine.js';
import {
  clearBids,
  createRoom,
  joinRoom,
  leaveRoom,
  publishGameState,
  publishPrivateNotice,
  readBids,
  removePresence,
  removeCommand,
  sendCommand,
  submitBid,
  subscribeBids,
  subscribeCommands,
  subscribeHostGame,
  subscribePrivateNotice,
  subscribePrivatePlayer,
  subscribeRoom,
  trackPresence,
  updateRoomStatus
} from './room-service.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  home: $('#home-screen'), lobby: $('#lobby-screen'), game: $('#game-screen'), error: $('#error-screen'),
  roomForm: $('#room-form'), name: $('#player-name'), code: $('#room-code'), codeWrap: $('#join-code-wrap'),
  createTab: $('#tab-create'), joinTab: $('#tab-join'), submit: $('#room-submit'), homeError: $('#home-error'),
  connection: $('#connection-status'), lobbyCode: $('#lobby-code'), shareUrl: $('#share-url'), players: $('#lobby-players'),
  playerCount: $('#player-count'), lobbyRole: $('#lobby-role'), lobbyMessage: $('#lobby-message'),
  lobbyActionTitle: $('#lobby-action-title'), lobbyActionCopy: $('#lobby-action-copy'), startGame: $('#btn-start-game'),
  leaveRoom: $('#btn-leave-room'), copyLink: $('#btn-copy-link'), gameRoundLabel: $('#game-round-label'),
  gamePhaseTitle: $('#game-phase-title'), gameRoomCode: $('#game-room-code'), market: $('#market-strip'),
  phasePanel: $('#phase-panel'), gamePlayers: $('#game-players'), portfolioDashboard: $('#portfolio-dashboard'), gameMessage: $('#game-message'),
  sidebarRound: $('#sidebar-round'), fatalTitle: $('#fatal-title'), fatalMessage: $('#fatal-message'),
  returnHome: $('#btn-return-home'), toastRegion: $('#toast-region'), hostTools: $('#host-tools')
};

let user = null;
let selectedMode = 'create';
let roomCode = '';
let isHost = false;
let roomData = null;
let game = null;
let fullGame = null;
let privatePlayer = null;
let bids = {};
let ownBid = null;
let selectedCardId = '';
let turnKey = '';
let unsubscribeRoom = null;
let unsubscribeCommands = null;
let unsubscribeBids = null;
let unsubscribeHostState = null;
let unsubscribePrivatePlayer = null;
let unsubscribePrivateNotice = null;
let unsubscribePresence = null;
let shownNoticeId = '';
let commandQueue = Promise.resolve();
let pendingCommands = [];
let commandRosterKey = '';
let bidRosterKey = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function setScreen(screen) {
  for (const item of [elements.home, elements.lobby, elements.game, elements.error]) item.hidden = item !== screen;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  elements.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function showHomeError(message) {
  elements.homeError.textContent = message;
  elements.homeError.hidden = !message;
}

function showFatal(title, message) {
  elements.fatalTitle.textContent = title;
  elements.fatalMessage.textContent = message;
  setScreen(elements.error);
}

function stopRoomListeners() {
  unsubscribeRoom?.();
  unsubscribeCommands?.();
  unsubscribeBids?.();
  unsubscribeHostState?.();
  unsubscribePrivatePlayer?.();
  unsubscribePrivateNotice?.();
  unsubscribePresence?.();
  unsubscribeRoom = unsubscribeCommands = unsubscribeBids = unsubscribeHostState = unsubscribePrivatePlayer = unsubscribePrivateNotice = unsubscribePresence = null;
  commandRosterKey = '';
  bidRosterKey = '';
  pendingCommands = [];
}

function playerList() {
  return Object.values(roomData?.players || {}).sort((a, b) => a.joinedAt - b.joinedAt);
}

function openRoom(code) {
  stopRoomListeners();
  roomCode = code;
  game = null;
  fullGame = null;
  privatePlayer = null;
  bids = {};
  ownBid = null;
  roomData = null;
  selectedCardId = '';
  turnKey = '';
  unsubscribePresence = trackPresence(db, code, user.uid, (error) => toast(`Status koneksi room gagal: ${error.message}`, true));
  unsubscribeRoom = subscribeRoom(db, code, (data) => {
    if (!data) {
      showFatal('Room tidak tersedia', 'Room mungkin sudah ditutup atau kodenya tidak valid.');
      stopRoomListeners();
      return;
    }
    roomData = data;
    isHost = data.meta.hostUid === user.uid;
    if (data.meta.status === 'closed') {
      showFatal('Room sudah ditutup', 'Moderator menutup room ini. Kembali ke awal untuk membuat room baru atau bergabung ke room lain.');
      stopRoomListeners();
      return;
    }
    game = data.state || null;
    if (isHost && !unsubscribeHostState) {
      unsubscribeHostState = subscribeHostGame(db, code, (nextGame) => {
        fullGame = nextGame;
        if (fullGame && pendingCommands.length) {
          const queued = pendingCommands;
          pendingCommands = [];
          queued.forEach((item) => queueCommand(...item));
        }
        if (game?.phase === 'bidding') renderGame();
      }, (error) => toast(`State moderator tidak terbaca: ${error.message}`, true));
    }
    if (!unsubscribePrivatePlayer) {
      unsubscribePrivatePlayer = subscribePrivatePlayer(db, code, user.uid, (nextPlayer) => {
        privatePlayer = nextPlayer;
        if (game?.phase === 'bidding') renderGame();
      }, (error) => toast(`Saldo pribadi tidak terbaca: ${error.message}`, true));
    }
    if (!unsubscribePrivateNotice) {
      unsubscribePrivateNotice = subscribePrivateNotice(db, code, user.uid, (notice) => {
        if (notice?.id && notice.id !== shownNoticeId) {
          shownNoticeId = notice.id;
          toast(notice.text);
        }
      }, (error) => toast(`Info privat tidak terbaca: ${error.message}`, true));
    }
    syncHostListeners();
    if (game) {
      ownBid = bids[user.uid] || ownBid;
      renderGame();
      setScreen(elements.game);
    } else {
      renderLobby();
      setScreen(elements.lobby);
    }
  }, (error) => showFatal('Koneksi room terputus', error.message));
}

function syncHostListeners() {
  const uids = playerList().map((player) => player.uid);
  const rosterKey = uids.join('|');
  if (isHost && rosterKey && rosterKey !== commandRosterKey) {
    unsubscribeCommands?.();
    commandRosterKey = rosterKey;
    unsubscribeCommands = subscribeCommands(db, roomCode, uids, (uid, commandId, command) => {
      queueCommand(uid, commandId, command);
    }, (error) => toast(`Gagal menerima aksi: ${error.message}`, true));
  }
  if (game?.phase === 'bidding' && rosterKey && rosterKey !== bidRosterKey) {
    unsubscribeBids?.();
    bidRosterKey = rosterKey;
    const readableUids = isHost ? uids : [user.uid];
    unsubscribeBids = subscribeBids(db, roomCode, readableUids, (nextBids) => {
      if (isHost) bids = nextBids;
      else ownBid = nextBids[user.uid] || null;
      if (game?.phase === 'bidding') renderGame();
    }, (error) => toast(`Tidak dapat membaca status tawaran: ${error.message}`, true));
  }
  if (game?.phase !== 'bidding' && unsubscribeBids) {
    unsubscribeBids();
    unsubscribeBids = null;
    bidRosterKey = '';
    ownBid = null;
    bids = {};
  }
}

function queueCommand(uid, commandId, command) {
  commandQueue = commandQueue.then(() => processCommand(uid, commandId, command)).catch((error) => toast(error.message, true));
}

function renderLobby() {
  const players = playerList();
  elements.lobbyCode.textContent = roomCode;
  elements.shareUrl.textContent = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  elements.playerCount.textContent = String(players.length);
  elements.lobbyRole.textContent = isHost ? 'ROOM DIBUAT · MODERATOR' : 'BERHASIL BERGABUNG';
  elements.lobbyMessage.textContent = isHost
    ? 'Bagikan kode atau tautan ini. Permainan siap saat 3–5 pemain telah bergabung.'
    : 'Anda sudah masuk. Tunggu moderator memulai permainan.';
  elements.lobbyActionTitle.textContent = isHost ? 'Siap memulai?' : 'Menunggu moderator';
  elements.lobbyActionCopy.textContent = isHost
    ? 'Pastikan semua peserta yang akan bermain sudah terlihat di daftar.'
    : 'Moderator akan memulai setelah semua pemain bergabung.';
  elements.startGame.hidden = !isHost;
  elements.startGame.disabled = players.length < 3 || players.length > 5;
  elements.startGame.textContent = players.length < 3 ? `Butuh ${3 - players.length} pemain lagi` : players.length > 5 ? 'Maksimal 5 pemain' : 'Mulai permainan →';
  elements.leaveRoom.textContent = isHost ? 'Tutup room' : 'Keluar dari room';
  elements.players.innerHTML = players.map((player, index) => `
    <div class="lobby-player">
      <span class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
      <span class="lobby-player-name">${escapeHtml(player.name)}</span>
      <span class="host-label" style="color:${roomData.presence?.[player.uid]?.online === true ? '#26875e' : '#aa9690'}">${roomData.presence?.[player.uid]?.online === true ? 'ONLINE' : roomData.presence?.[player.uid]?.online === false ? 'OFFLINE' : '…'}</span>
      ${player.isHost || player.uid === roomData.meta.hostUid ? '<span class="host-label">MOD</span>' : `<span class="host-label" style="color:#aa9690">P${index + 1}</span>`}
    </div>`).join('');
}

async function startGame() {
  try {
    const players = playerList();
    const nextGame = createGame(players);
    fullGame = nextGame;
    await publishGameState(db, roomCode, nextGame);
    await updateRoomStatus(db, roomCode, 'playing');
    toast('Permainan dimulai. Semua pemain masukkan tawaran.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function processCommand(uid, commandId, command) {
  if (command && !fullGame) {
    pendingCommands.push([uid, commandId, command]);
    return;
  }
  try {
    if (!game || !fullGame || !command) return;
    const nextGame = structuredClone(fullGame);
    let privateNotice = null;
    if (command.type === 'loan') requestLoan(nextGame, uid);
    else if (command.type === 'action') {
      const payload = command.payload || {};
      const selectedCard = nextGame.pool.find((card) => card.id === payload.cardId);
      if (selectedCard?.effect === 'info' && payload.mode === 'activate') {
        const selectedSectors = payload.effectData?.sectors || [];
        if (selectedSectors.length === 2 && selectedSectors[0] !== selectedSectors[1]) {
          const previews = selectedSectors.map((sectorId) => {
            const sector = nextGame.sectors.find((item) => item.id === sectorId);
            const top = nextGame.economyPiles[sectorId]?.[0];
            return top ? `${sector?.name}: ${top.label}` : `${sector?.name}: dek sudah habis`;
          });
          privateNotice = { id: `${Date.now()}-${commandId}`, text: `Info Bursa · ${previews.join(' · ')} · +2 koin` };
        }
      }
      applyAction(nextGame, uid, payload);
    }
    else if (command.type === 'sell') applySale(nextGame, uid, command.payload?.sectorId, command.payload?.quantity);
    else throw new Error('Perintah permainan tidak dikenal.');
    fullGame = nextGame;
    await publishGameState(db, roomCode, nextGame);
    if (privateNotice) await publishPrivateNotice(db, roomCode, uid, privateNotice);
  } catch (error) {
    toast(`${playerByUid(game, uid)?.name || 'Pemain'}: ${error.message}`, true);
    try {
      await publishPrivateNotice(db, roomCode, uid, { id: `${Date.now()}-${commandId}`, text: `Aksi tidak diterapkan: ${error.message}` });
    } catch { /* The moderator toast remains the fallback if private feedback cannot be written. */ }
  } finally {
    await removeCommand(db, roomCode, uid, commandId);
  }
}

async function submitPlayerCommand(type, payload) {
  if (!roomCode || !user) return;
  try {
    await sendCommand(db, roomCode, user.uid, type, payload);
    toast('Aksi dikirim. Menunggu pembaruan room…');
  } catch (error) {
    toast(error.message, true);
  }
}

async function revealBids() {
  try {
    const uids = playerList().map((player) => player.uid);
    const currentBids = await readBids(db, roomCode, uids);
    const nextGame = structuredClone(fullGame);
    resolveBids(nextGame, currentBids);
    fullGame = nextGame;
    await publishGameState(db, roomCode, nextGame);
    bids = {};
    await clearBids(db, roomCode, uids);
    toast('Tawaran dibuka bersama. Urutan main sudah ditentukan.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function runEconomy() {
  try {
    const nextGame = structuredClone(fullGame);
    resolveEconomy(nextGame);
    if (nextGame.phase === 'complete') nextGame.publicScores = finalScores(nextGame);
    fullGame = nextGame;
    await publishGameState(db, roomCode, nextGame);
  } catch (error) {
    toast(error.message, true);
  }
}

async function nextRound() {
  try {
    const nextGame = structuredClone(fullGame);
    startNextRound(nextGame);
    fullGame = nextGame;
    await publishGameState(db, roomCode, nextGame);
  } catch (error) {
    toast(error.message, true);
  }
}

function phaseCopy(phase) {
  const map = {
    bidding: ['FASE BIDDING', 'Tentukan urutan main'],
    action: ['FASE AKSI', 'Pilih kartu aksi'],
    sell: ['FASE JUAL', 'Kelola portofolio'],
    economy: ['FASE EKONOMI', 'Pasar bergerak'],
    between: ['RONDE SELESAI', 'Siap ke ronde berikutnya'],
    complete: ['PERMAINAN BERAKHIR', 'Skor akhir']
  };
  return map[phase] || ['STOCKLAB', 'Permainan'];
}

function renderMarket() {
  const items = [...game.sectors.map((sector) => ({ id: sector.id, name: sector.name, price: sector.price })), { id: 'reksadana', name: 'Reksa Dana', price: sectorPrice(game, 'reksadana') }];
  elements.market.innerHTML = items.map((sector) => `
    <div class="market-tile"><div class="market-name">${escapeHtml(sector.name)}</div><div class="market-price">${sector.price}</div></div>`).join('');
}

function renderPlayers() {
  const current = currentPlayer(game);
  const rank = new Map(game.order.map((uid, index) => [uid, index + 1]));
  const sorted = [...game.players].sort((a, b) => rank.get(a.uid) - rank.get(b.uid));
  elements.gamePlayers.innerHTML = sorted.map((player) => {
    const holdings = Object.values(player.holdings).reduce((sum, amount) => sum + amount, 0);
    const online = roomData?.presence?.[player.uid]?.online;
    return `<div class="game-player${current?.uid === player.uid ? ' current' : ''}">
      <span class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
      <div class="game-player-info"><div class="game-player-name">${escapeHtml(player.name)}</div><div class="game-player-stats">${holdings} saham · ${online === true ? 'online' : online === false ? 'offline' : 'menghubungkan'}${player.uid === user.uid && privatePlayer ? ` · ${privatePlayer.coins} koin` : ''}</div></div>
      <span class="game-player-order">#${rank.get(player.uid) || '–'}</span>
    </div>`;
  }).join('');
  const currentIsOffline = current && roomData?.presence?.[current.uid]?.online === false;
  elements.hostTools.hidden = !isHost || !currentIsOffline || !['action', 'sell'].includes(game.phase);
  elements.hostTools.innerHTML = elements.hostTools.hidden ? '' : '<button class="button button-secondary" id="btn-skip-turn" type="button">Lewati giliran pemain offline</button>';
  $('#btn-skip-turn')?.addEventListener('click', async () => {
    try {
      const nextGame = structuredClone(fullGame);
      skipCurrentTurn(nextGame);
      fullGame = nextGame;
      await publishGameState(db, roomCode, nextGame);
    } catch (error) { toast(error.message, true); }
  });
}

function renderPoolPreview() {
  const groups = new Map();
  for (const card of game.pool) {
    if (!groups.has(card.theme)) groups.set(card.theme, {});
    const counts = groups.get(card.theme);
    counts[card.effect] = (counts[card.effect] || 0) + 1;
  }
  const rows = [...groups.entries()].map(([theme, counts]) => `<div class="pool-group"><span class="action-sector">${escapeHtml(SECTOR_NAMES[theme])}</span><span class="pool-effects">${Object.entries(counts).map(([effect, count]) => `<span class="pool-chip">${escapeHtml(ACTION_LABELS[effect])}${count > 1 ? ` ×${count}` : ''}</span>`).join('')}</span></div>`).join('');
  return `<div class="pool-preview"><h3>Kartu Aksi ronde ini · ${game.pool.length} kartu</h3><p class="phase-copy">Kartu ini akan dipilih bergiliran di Fase Aksi sesuai urutan hasil bidding. Gunakan sebagai bahan strategi tawaran Anda.</p>${rows}</div>`;
}

function renderPortfolioDashboard() {
  const ids = [...game.sectors.map((sector) => sector.id), 'reksadana'];
  const rank = new Map(game.order.map((uid, index) => [uid, index + 1]));
  const sorted = [...game.players].sort((a, b) => rank.get(a.uid) - rank.get(b.uid));
  const head = ids.map((id) => `<th>${escapeHtml(SECTOR_NAMES[id].replace('Saham ', ''))}<small>${sectorPrice(game, id)} koin</small></th>`).join('');
  const body = sorted.map((player) => {
    const value = ids.reduce((sum, id) => sum + (player.holdings[id] || 0) * sectorPrice(game, id), 0);
    const cells = ids.map((id) => `<td class="${player.holdings[id] ? '' : 'zero'}">${player.holdings[id] || 0}</td>`).join('');
    return `<tr class="${player.uid === user.uid ? 'me' : ''}"><th scope="row">${escapeHtml(player.name)}${player.uid === user.uid ? ' (Anda)' : ''}</th>${cells}<td class="value">${value}</td><td>${player.utang ? `${player.utang} utang` : '–'}</td></tr>`;
  }).join('');
  const totals = ids.map((id) => `<td>${game.players.reduce((sum, player) => sum + (player.holdings[id] || 0), 0)}</td>`).join('');
  elements.portfolioDashboard.innerHTML = `<div class="sidebar-heading"><h2>Dashboard Portofolio</h2><span>TERBUKA UNTUK SEMUA</span></div><div class="table-scroll"><table class="portfolio-table"><thead><tr><th>Pemain</th>${head}<th>Nilai saham<small>koin</small></th><th>Utang</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Total beredar</th>${totals}<td></td><td></td></tr></tfoot></table></div>`;
}

function renderBidding() {
  const player = playerByUid(game, user.uid);
  const coins = Number(privatePlayer?.coins ?? 0);
  const ownSubmitted = Number(ownBid?.round) === game.round;
  const submitted = isHost ? bidsSubmitted(game, bids) : ownSubmitted ? 1 : 0;
  const progress = isHost ? `${submitted}/${game.players.length} tawaran terkunci` : 'Tawaran pemain lain dirahasiakan sampai moderator membuka hasil.';
  const minimumBid = coins > 0 ? 1 : 0;
  const bidForm = ownSubmitted
    ? `<div class="status-item"><strong>Tawaran terkunci</strong><span>Menunggu moderator membuka semua tawaran.</span></div>`
    : !privatePlayer
      ? '<div class="status-item"><strong>Menyiapkan saldo privat…</strong><span>Form tawaran akan aktif sebentar lagi.</span></div>'
    : `<form id="bid-form" class="bid-form"><label for="bid-amount">Tawaran rahasia · saldo ${coins} koin</label><input id="bid-amount" type="number" min="${minimumBid}" max="${coins}" value="${minimumBid}" required /><button class="button button-primary">Kunci tawaran</button></form>
       ${game.utangRemaining > 0 ? '<button class="button button-secondary" id="btn-loan" type="button">Pinjam 10 koin dari Bank</button>' : ''}`;
  const hostAction = isHost ? `<div class="status-item"><strong>${submitted}/${game.players.length} masuk</strong><span>${submitted === game.players.length ? 'Semua siap dibuka' : 'Tunggu semua tawaran'}</span></div><button class="button button-primary button-wide" id="btn-reveal-bids" type="button" ${submitted !== game.players.length || !fullGame ? 'disabled' : ''}>Buka tawaran & mulai fase aksi →</button>` : '';
  elements.phasePanel.innerHTML = `<h2>Fase Bidding · Ronde ${game.round}</h2><p class="phase-copy">Masukkan tawaran dari perangkat Anda. Nilai tawaran tidak terlihat oleh peserta lain; saldo dibayar ke Bank saat hasil dibuka.</p>${renderPoolPreview()}${bidForm}<div class="status-list"><div class="status-item"><span>${escapeHtml(progress)}</span><strong>${game.utangRemaining} kartu utang</strong></div></div>${hostAction}`;
  $('#bid-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number($('#bid-amount').value);
    if (!Number.isInteger(amount) || amount < minimumBid || amount > coins) return toast(`Tawaran harus bilangan bulat dari ${minimumBid} sampai saldo Anda.`, true);
    try {
      await submitBid(db, roomCode, user.uid, game.round, amount);
      ownBid = { round: game.round, bid: amount };
      renderGame();
      toast('Tawaran terkunci secara rahasia.');
    } catch (error) { toast(error.message, true); }
  });
  $('#btn-loan')?.addEventListener('click', () => submitPlayerCommand('loan'));
  $('#btn-reveal-bids')?.addEventListener('click', revealBids);
}

function actionEffectForm(card) {
  if (card.effect === 'info') return `<p class="phase-copy">Pilih dua sektor berbeda untuk melihat kartu ekonomi teratas secara privat. Anda juga mendapat 2 koin dari Bank.</p><div class="phase-controls"><select id="effect-info-sectors" multiple size="4" aria-label="Pilih dua sektor untuk diintip">${game.sectors.map((sector) => `<option value="${sector.id}">${escapeHtml(sector.name)}</option>`).join('')}</select></div>`;
  if (card.effect === 'rumor') {
    const sectors = game.sectors.map((sector) => `<option value="${sector.id}">${escapeHtml(sector.name)} · ${sector.price}</option>`).join('');
    return `<p class="phase-copy">Gerakkan harga sampai dua kali, satu poin setiap kali. Pergerakan kedua opsional.</p><div class="phase-controls"><select id="effect-sector-1" aria-label="Sektor pergerakan pertama">${sectors}</select><select id="effect-direction-1" aria-label="Arah pergerakan pertama"><option value="up">Naik 1</option><option value="down">Turun 1</option></select></div><div class="phase-controls"><select id="effect-sector-2" aria-label="Sektor pergerakan kedua"><option value="">Tidak ada pergerakan kedua</option>${sectors}</select><select id="effect-direction-2" aria-label="Arah pergerakan kedua"><option value="up">Naik 1</option><option value="down">Turun 1</option></select></div>`;
  }
  if (card.effect === 'quickbuy') return `<p class="phase-copy">Pilih sampai 2 kartu tambahan untuk langsung disimpan. Jika tidak memilih, Quickbuy hanya mengakhiri giliran.</p><div class="phase-controls"><select id="effect-quickbuy" multiple size="4" aria-label="Pilih kartu Quickbuy">${game.pool.filter((item) => item.id !== card.id).map((item) => `<option value="${item.id}">${escapeHtml(SECTOR_NAMES[item.theme])}</option>`).join('')}</select></div>`;
  if (card.effect === 'fee') return `<p class="phase-copy">Biaya: ${1 + (playerByUid(game, user.uid).holdings[card.theme] || 0)} koin. Setelah membayar, Anda dapat menjual satu jenis saham.</p><div class="phase-controls"><select id="effect-sector">${Object.keys(playerByUid(game, user.uid).holdings).filter((id) => playerByUid(game, user.uid).holdings[id] > 0).map((id) => `<option value="${id}">${escapeHtml(SECTOR_NAMES[id])} · ${playerByUid(game, user.uid).holdings[id]} lembar</option>`).join('')}</select><input id="effect-quantity" type="number" min="0" placeholder="Jumlah jual" aria-label="Jumlah saham untuk dijual" /></div>`;
  const player = playerByUid(game, user.uid);
  const eligible = game.players.filter((target) => target.uid !== user.uid && SECTORS_FOR_GAME.some((id) => target.holdings[id] > 0 && player.holdings[id] >= target.holdings[id]));
  const choices = eligible.flatMap((target) => SECTORS_FOR_GAME.filter((id) => target.holdings[id] > 0 && player.holdings[id] >= target.holdings[id]).map((id) => `<option value="${target.uid}|${id}">${escapeHtml(target.name)} · ${escapeHtml(SECTOR_NAMES[id])}</option>`)).join('');
  return choices ? `<p class="phase-copy">Pilih target dan saham yang memenuhi syarat akuisisi.</p><div class="phase-controls"><select id="effect-target" aria-label="Target dan saham">${choices}</select></div>` : '<p class="phase-copy">Tidak ada target yang memenuhi syarat untuk diakuisisi saat ini.</p>';
}

const SECTORS_FOR_GAME = ['tambang', 'konsumer', 'keuangan', 'agrikultur'];

function renderAction() {
  const player = currentPlayer(game);
  const isMyTurn = player?.uid === user.uid;
  const currentTurnKey = `${game.round}-${game.turnIndex}-${player?.uid || ''}`;
  if (turnKey !== currentTurnKey) { turnKey = currentTurnKey; selectedCardId = ''; }
  const message = isMyTurn ? `Giliran Anda, ${escapeHtml(player.name)}. Ambil satu kartu terbuka.` : `Menunggu ${escapeHtml(player?.name || 'pemain')} memilih kartu dari perangkatnya.`;
  const cards = game.pool.map((card) => `<button class="action-card${selectedCardId === card.id ? ' selected' : ''}" type="button" data-card-id="${escapeHtml(card.id)}" ${!isMyTurn ? 'disabled' : ''}><span class="action-sector">${escapeHtml(SECTOR_NAMES[card.theme])}</span><span class="action-effect">${escapeHtml(ACTION_LABELS[card.effect])}</span></button>`).join('');
  const selected = game.pool.find((card) => card.id === selectedCardId);
  const choice = selected && isMyTurn ? `<div class="choice-panel"><h3>${escapeHtml(ACTION_LABELS[selected.effect])} · ${escapeHtml(SECTOR_NAMES[selected.theme])}</h3><div class="phase-controls"><button class="button button-secondary" id="btn-save-card">Simpan jadi saham</button><button class="button button-primary" id="btn-activate-card">Aktifkan efek</button></div><div id="effect-form" hidden></div></div>` : '';
  elements.phasePanel.innerHTML = `<h2>Fase Aksi · Ronde ${game.round}</h2><p class="phase-copy">${message} Tersisa ${game.pool.length} kartu. Simpan kartu sebagai saham atau aktifkan efeknya.</p><div class="card-options">${cards}</div>${choice}`;
  elements.phasePanel.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => { selectedCardId = button.dataset.cardId; renderGame(); }));
  $('#btn-save-card')?.addEventListener('click', () => submitPlayerCommand('action', { cardId: selectedCardId, mode: 'save' }));
  $('#btn-activate-card')?.addEventListener('click', () => {
    const container = $('#effect-form');
    container.hidden = false;
    container.innerHTML = `${actionEffectForm(selected)}<button class="button button-primary" id="btn-confirm-effect" type="button">Konfirmasi efek</button>`;
    $('#btn-confirm-effect').addEventListener('click', () => {
      const effectData = {};
      if (selected.effect === 'info') effectData.sectors = Array.from($('#effect-info-sectors').selectedOptions).map((option) => option.value);
      if (selected.effect === 'rumor') {
        effectData.moves = [{ sector: $('#effect-sector-1').value, direction: $('#effect-direction-1').value }];
        if ($('#effect-sector-2').value) effectData.moves.push({ sector: $('#effect-sector-2').value, direction: $('#effect-direction-2').value });
      }
      if (selected.effect === 'quickbuy') effectData.additionalIds = Array.from($('#effect-quickbuy').selectedOptions).slice(0, 2).map((option) => option.value);
      if (selected.effect === 'fee') { effectData.sector = $('#effect-sector').value; effectData.quantity = Number($('#effect-quantity').value || 0); }
      if (selected.effect === 'akuisisi') { const [targetUid, sector] = ($('#effect-target')?.value || '').split('|'); effectData.targetUid = targetUid; effectData.sector = sector; }
      submitPlayerCommand('action', { cardId: selectedCardId, mode: 'activate', effectData });
    });
  });
}

function renderSale() {
  const player = currentPlayer(game);
  const isMyTurn = player?.uid === user.uid;
  const owned = Object.keys(player?.holdings || {}).filter((id) => player.holdings[id] > 0);
  const controls = isMyTurn ? (owned.length
    ? `<form id="sale-form" class="phase-controls"><select id="sale-sector" aria-label="Pilih saham untuk dijual">${owned.map((id) => `<option value="${id}">${escapeHtml(SECTOR_NAMES[id])} · ${player.holdings[id]} × ${sectorPrice(game, id)} koin</option>`).join('')}</select><input id="sale-quantity" type="number" min="0" max="${player.holdings[owned[0]]}" value="${player.holdings[owned[0]]}" aria-label="Jumlah saham" /><button class="button button-primary">Jual saham</button><button class="button button-secondary" id="btn-skip-sale" type="button">Lewati</button></form>`
    : '<p class="phase-copy">Anda tidak memiliki saham untuk dijual.</p><button class="button button-secondary" id="btn-skip-sale" type="button">Lanjutkan</button>')
    : `<p class="phase-copy">Menunggu ${escapeHtml(player?.name || 'pemain')} menyelesaikan giliran jual.</p>`;
  elements.phasePanel.innerHTML = `<h2>Fase Jual · Ronde ${game.round}</h2><p class="phase-copy">${isMyTurn ? 'Jual satu jenis saham dalam jumlah yang diinginkan, atau lewati.' : `Pemain saat ini: ${escapeHtml(player?.name || '')}.`}</p>${controls}`;
  $('#sale-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPlayerCommand('sell', { sectorId: $('#sale-sector').value, quantity: Number($('#sale-quantity').value) });
  });
  $('#btn-skip-sale')?.addEventListener('click', () => submitPlayerCommand('sell', {}));
  $('#sale-sector')?.addEventListener('change', () => {
    const sector = $('#sale-sector').value;
    $('#sale-quantity').max = String(player.holdings[sector]);
    $('#sale-quantity').value = String(player.holdings[sector]);
  });
}

function renderEconomy() {
  const log = game.economyLog?.length ? `<div class="status-list">${game.economyLog.map((line) => `<div class="status-item"><span>${escapeHtml(line)}</span></div>`).join('')}</div>` : '';
  const cards = game.lastEconomyCards?.length ? `<div class="status-list">${game.lastEconomyCards.map((card) => `<div class="status-item"><span>${escapeHtml(card.sectorName)}</span><strong>${escapeHtml(card.label)}</strong></div>`).join('')}</div>` : '';
  if (game.phase === 'economy') {
    elements.phasePanel.innerHTML = `<h2>Semua pemain selesai menjual</h2><p class="phase-copy">Moderator membuka Kartu Ekonomi untuk menggerakkan seluruh sektor.</p>${isHost ? '<button class="button button-primary" id="btn-run-economy">Buka Kartu Ekonomi →</button>' : '<div class="status-item"><strong>Menunggu moderator</strong><span>Harga akan diperbarui serentak.</span></div>'}`;
    $('#btn-run-economy')?.addEventListener('click', runEconomy);
  } else if (game.phase === 'between') {
    elements.phasePanel.innerHTML = `<h2>Ringkasan Ekonomi · Ronde ${game.round}</h2><p class="phase-copy">${game.lastMessage}</p>${cards}${log}${isHost ? '<button class="button button-primary" id="btn-next-round">Mulai ronde berikutnya →</button>' : '<div class="status-item"><strong>Menunggu moderator</strong><span>Ronde berikutnya segera dimulai.</span></div>'}`;
    $('#btn-next-round')?.addEventListener('click', nextRound);
  } else {
    const scores = game.publicScores || [];
    elements.phasePanel.innerHTML = `<h2>Investor Terbaik: ${escapeHtml(scores[0]?.name || '—')}</h2><p class="phase-copy">Skor akhir = koin + nilai saham − utang.</p><div class="status-list">${scores.map((score, index) => `<div class="status-item"><span>#${index + 1} · ${escapeHtml(score.name)} (${score.coins} + ${score.shareValue} − ${score.debt})</span><strong>${score.total}</strong></div>`).join('')}</div>`;
  }
}

function renderGame() {
  if (!game) return;
  const [phaseLabel, phaseTitle] = phaseCopy(game.phase);
  elements.gameRoundLabel.textContent = game.phase === 'complete' ? phaseLabel : `RONDE ${game.round} · ${phaseLabel}`;
  elements.gamePhaseTitle.textContent = phaseTitle;
  elements.gameRoomCode.textContent = roomCode;
  elements.sidebarRound.textContent = `RONDE ${game.round}`;
  elements.gameMessage.textContent = game.lastMessage || '';
  elements.gameMessage.classList.toggle('error', false);
  renderMarket();
  renderPlayers();
  renderPortfolioDashboard();
  if (game.phase === 'bidding') renderBidding();
  else if (game.phase === 'action') renderAction();
  else if (game.phase === 'sell') renderSale();
  else renderEconomy();
}

async function handleRoomForm(event) {
  event.preventDefault();
  showHomeError('');
  const name = elements.name.value.trim();
  const code = elements.code.value.trim().toUpperCase();
  elements.submit.disabled = true;
  elements.submit.textContent = selectedMode === 'create' ? 'Membuat room…' : 'Bergabung…';
  try {
    if (!name) throw new Error('Masukkan nama pemain.');
    const room = selectedMode === 'create' ? await createRoom(db, user.uid, name) : await joinRoom(db, user.uid, name, code);
    localStorage.setItem('stocklab-name', name);
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    openRoom(room);
  } catch (error) {
    showHomeError(error.message);
  } finally {
    elements.submit.disabled = false;
    updateSubmitLabel();
  }
}

function updateSubmitLabel() {
  elements.submit.innerHTML = selectedMode === 'create' ? 'Buat room baru <span>→</span>' : 'Gabung ke room <span>→</span>';
}

async function exitRoom() {
  const code = roomCode;
  try {
    await leaveRoom(db, code, user.uid, isHost);
    await removePresence(db, code, user.uid);
  } catch (error) {
    toast(`Keluar dari room: ${error.message}`, true);
  }
  stopRoomListeners();
  roomCode = '';
  game = null;
  roomData = null;
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  setScreen(elements.home);
}

function setMode(mode) {
  selectedMode = mode;
  const create = mode === 'create';
  elements.createTab.classList.toggle('active', create);
  elements.joinTab.classList.toggle('active', !create);
  elements.createTab.setAttribute('aria-selected', String(create));
  elements.joinTab.setAttribute('aria-selected', String(!create));
  elements.codeWrap.classList.toggle('field-hidden', create);
  elements.code.required = !create;
  updateSubmitLabel();
  showHomeError('');
}

elements.createTab.addEventListener('click', () => setMode('create'));
elements.joinTab.addEventListener('click', () => setMode('join'));
elements.roomForm.addEventListener('submit', handleRoomForm);
elements.startGame.addEventListener('click', startGame);
elements.leaveRoom.addEventListener('click', exitRoom);
elements.copyLink.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(elements.shareUrl.textContent); toast('Tautan room disalin.'); }
  catch { toast('Salin tautan dari kolom alamat browser.', true); }
});
elements.returnHome.addEventListener('click', async () => {
  if (roomCode && user) {
    try { await removePresence(db, roomCode, user.uid); } catch { /* The room may already have been removed. */ }
  }
  stopRoomListeners();
  roomCode = '';
  game = null;
  fullGame = null;
  roomData = null;
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  setScreen(elements.home);
});

async function initializeAppSession() {
try {
  const storedName = localStorage.getItem('stocklab-name');
  if (storedName) elements.name.value = storedName;
  const requestedRoom = new URLSearchParams(window.location.search).get('room');
  if (requestedRoom) {
    setMode('join');
    elements.code.value = requestedRoom.toUpperCase();
  }
  const credential = await authenticate();
  user = credential.user;
  onValue(ref(db, '.info/connected'), (snapshot) => {
    const connected = snapshot.val() === true;
    elements.connection.textContent = connected ? '● TERHUBUNG' : '○ MENGHUBUNGKAN';
    elements.connection.classList.toggle('connected', connected);
    elements.connection.classList.toggle('offline', !connected);
  });
  if (requestedRoom && storedName) {
    try {
      const resumedRoom = await joinRoom(db, user.uid, storedName, requestedRoom);
      openRoom(resumedRoom);
    } catch (error) {
      showHomeError(error.message);
      elements.code.focus();
    }
  } else if (requestedRoom) {
    elements.code.focus();
  }
} catch (error) {
  showFatal('Firebase belum siap', error.message);
}
}

initializeAppSession();
