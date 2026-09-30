export const SECTORS = [
  { id: 'tambang', name: 'Tambang', track: [2, 3, 5, 6, 8, 9] },
  { id: 'konsumer', name: 'Konsumer', track: [1, 2, 3, 4, 5, 6, 7, 8] },
  { id: 'keuangan', name: 'Keuangan', track: [1, 3, 4, 5, 6, 7, 9] },
  { id: 'agrikultur', name: 'Agrikultur', track: [1, 2, 4, 5, 6, 8, 9] }
];

const ACTION_MIX = { info: 3, rumor: 3, quickbuy: 2, fee: 2, akuisisi: 2 };
const ACTION_NAMES = { info: 'Info Bursa', rumor: 'Rumor', quickbuy: 'Quickbuy', fee: 'Trading Fee', akuisisi: 'Akuisisi' };
const ECONOMY_TYPES = [
  { key: 'naik', label: 'Naik', steps: 1 }, { key: 'melaju', label: 'Melaju', steps: 2 },
  { key: 'boom', label: 'Boom', steps: 3 }, { key: 'sideways', label: 'Sideways', steps: 0 },
  { key: 'anjlok', label: 'Anjlok', steps: -1 }, { key: 'terjun', label: 'Terjun', steps: -2 },
  { key: 'crash', label: 'Crash', steps: -3 }, { key: 'dividen', label: 'Dividen', steps: 0, side: 'dividen' },
  { key: 'extrafee', label: 'Extra Fee', steps: 0, side: 'extrafee' },
  { key: 'penerbitan', label: 'Penerbitan Saham Baru', steps: -1, side: 'penerbitan' },
  { key: 'pajak', label: 'Pajak Jalan', steps: 0, side: 'pajak' },
  { key: 'taxamnesty', label: 'Tax Amnesty', steps: 1, side: 'taxamnesty' },
  { key: 'worldoil', label: 'World Oil Regulation', steps: 0, side: 'worldoil' },
  { key: 'restrukturisasi', label: 'Restrukturisasi Ekonomi', steps: 0, side: 'restrukturisasi' },
  { key: 'resesi', label: 'Resesi', steps: 0, side: 'resesi' },
  { key: 'stimulus', label: 'Stimulus Ekonomi', steps: 0, side: 'stimulus' },
  { key: 'merger', label: 'Merger', steps: 0, side: 'merger' },
  { key: 'buyback', label: 'Buyback', steps: 1, side: 'buyback' }
];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createActionDeck() {
  const cards = [];
  for (const sector of [...SECTORS.map(({ id }) => id), 'reksadana']) {
    const mix = sector === 'reksadana' ? { rumor: 3, quickbuy: 3, fee: 3, akuisisi: 3 } : ACTION_MIX;
    for (const [effect, count] of Object.entries(mix)) {
      for (let i = 0; i < count; i += 1) cards.push({ id: `${sector}-${effect}-${i}-${Math.random().toString(36).slice(2, 7)}`, theme: sector, effect });
    }
  }
  return shuffle(cards);
}

function createEconomyPiles() {
  const deck = shuffle(ECONOMY_TYPES.flatMap((card) => [{ ...card }, { ...card }]));
  return Object.fromEntries(SECTORS.map(({ id }) => [id, deck.splice(0, 6)]));
}

export function createGame(players) {
  if (players.length < 3 || players.length > 5) throw new Error('StockLab membutuhkan 3–5 pemain.');
  const orderedPlayers = shuffle(players);
  const sectors = shuffle(SECTORS).map((sector) => ({ ...sector, price: 5 }));
  const playerStates = orderedPlayers.map((player) => ({
    uid: player.uid,
    name: player.name,
    coins: 15,
    holdings: { tambang: 0, konsumer: 0, keuangan: 0, agrikultur: 0, reksadana: 0 },
    utang: 0
  }));

  return {
    round: 1,
    phase: 'bidding',
    players: playerStates,
    order: playerStates.map((player) => player.uid),
    sectors,
    reksaNeighbors: [sectors[1].id, sectors[2].id],
    economyPiles: createEconomyPiles(),
    economyLog: [],
    actionDeck: createActionDeck(),
    pool: [],
    turnIndex: 0,
    quickbuySkipped: [],
    sellIndex: 0,
    lastBids: null,
    utangRemaining: 5
  };
}

export function playerByUid(game, uid) {
  return game.players.find((player) => player.uid === uid);
}

export function currentPlayer(game) {
  const uid = game.phase === 'action' ? game.order[game.turnIndex % game.order.length]
    : game.phase === 'sell' ? game.order[game.sellIndex]
      : null;
  return playerByUid(game, uid);
}

export function sectorPrice(game, sectorId) {
  if (sectorId === 'reksadana') {
    const left = game.sectors.find((sector) => sector.id === game.reksaNeighbors[0]);
    const right = game.sectors.find((sector) => sector.id === game.reksaNeighbors[1]);
    return Math.floor((left.price + right.price) / 2);
  }
  return game.sectors.find((sector) => sector.id === sectorId)?.price ?? 5;
}

export function bidsSubmitted(game, bids) {
  return game.players.filter((player) => Number(bids[player.uid]?.round) === game.round).length;
}

export function requestLoan(game, uid) {
  assert(game.phase === 'bidding', 'Pinjaman hanya dapat diambil saat fase bidding.');
  const player = playerByUid(game, uid);
  assert(player, 'Pemain tidak ditemukan.');
  assert(game.utangRemaining > 0, 'Kartu utang sudah habis.');
  player.coins += 10;
  player.utang += 1;
  game.utangRemaining -= 1;
  return game;
}

export function resolveBids(game, bids) {
  assert(game.phase === 'bidding', 'Fase bidding sudah berakhir.');
  assert(bidsSubmitted(game, bids) === game.players.length, 'Semua pemain harus mengunci tawaran terlebih dahulu.');
  for (const player of game.players) {
    const amount = Number(bids[player.uid].bid);
    const minimum = player.coins > 0 ? 1 : 0;
    assert(Number(bids[player.uid].round) === game.round && Number.isInteger(amount) && amount >= minimum && amount <= player.coins, `Tawaran ${player.name} tidak valid.`);
  }
  const previousRank = new Map(game.order.map((uid, index) => [uid, index]));
  const ranked = [...game.players].sort((a, b) => {
    const bidA = Number(bids[a.uid].bid);
    const bidB = Number(bids[b.uid].bid);
    return bidB - bidA || previousRank.get(a.uid) - previousRank.get(b.uid);
  });
  for (const player of ranked) {
    const amount = Number(bids[player.uid].bid);
    player.coins -= amount;
  }
  game.order = ranked.map((player) => player.uid);
  game.lastBids = ranked.map((player, index) => ({ uid: player.uid, name: player.name, bid: Number(bids[player.uid].bid), rank: index + 1 }));
  const n = game.players.length * 2;
  if (game.actionDeck.length < n) game.actionDeck = [...game.actionDeck, ...createActionDeck()];
  game.pool = game.actionDeck.splice(0, n);
  game.phase = 'action';
  game.turnIndex = 0;
  game.lastMessage = 'Tawaran dibuka. Urutan main ronde ini sudah ditentukan.';
  return game;
}

function applyRumor(game, sectorId, direction) {
  const sector = game.sectors.find((item) => item.id === sectorId);
  assert(sector, 'Pilih sektor yang valid.');
  assert(direction === 'up' || direction === 'down', 'Arah Rumor tidak valid.');
  const index = sector.track.indexOf(sector.price);
  const next = index + (direction === 'up' ? 1 : -1);
  assert(next >= 0 && next < sector.track.length, 'Harga sudah berada di batas tangga.');
  sector.price = sector.track[next];
}

function applyActionEffect(game, player, card, data) {
  switch (card.effect) {
    case 'info':
      assert(Array.isArray(data.sectors) && data.sectors.length === 2 && new Set(data.sectors).size === 2 && data.sectors.every((id) => SECTORS.some((sector) => sector.id === id)), 'Info Bursa membutuhkan dua sektor berbeda.');
      player.coins += 2;
      game.lastMessage = `${player.name} mengaktifkan Info Bursa dan menerima 2 koin.`;
      break;
    case 'rumor':
      {
        const moves = Array.isArray(data.moves) ? data.moves.slice(0, 2) : [{ sector: data.sector, direction: data.direction }];
        assert(moves.length >= 1, 'Rumor harus melakukan minimal satu pergerakan.');
        for (const move of moves) applyRumor(game, move.sector, move.direction);
        game.lastMessage = `${player.name} menggunakan Rumor (${moves.length} pergerakan harga).`;
      }
      break;
    case 'quickbuy': {
      const ids = data.additionalIds === undefined ? [] : data.additionalIds;
      assert(Array.isArray(ids) && ids.length <= 2 && new Set(ids).size === ids.length, 'Quickbuy dapat memilih maksimal dua kartu berbeda.');
      assert(ids.every((id) => game.pool.some((item) => item.id === id)), 'Kartu Quickbuy tambahan tidak tersedia.');
      for (const id of ids) {
        const index = game.pool.findIndex((item) => item.id === id);
        if (index >= 0) {
          const [extra] = game.pool.splice(index, 1);
          player.holdings[extra.theme] += 1;
        }
      }
      if (!game.quickbuySkipped.includes(player.uid)) game.quickbuySkipped.push(player.uid);
      game.lastMessage = `${player.name} menggunakan Quickbuy untuk menyimpan kartu tambahan.`;
      break;
    }
    case 'fee': {
      const cost = (player.holdings[card.theme] || 0) + 1;
      const sectorId = data.sector;
      const quantity = data.quantity === undefined ? 0 : Number(data.quantity);
      if (sectorId) {
        assert(Object.hasOwn(player.holdings, sectorId), 'Sektor untuk dijual tidak valid.');
        assert(Number.isInteger(quantity) && quantity >= 0, 'Jumlah saham yang dijual tidak valid.');
        assert(player.holdings[sectorId] >= quantity, 'Jumlah saham untuk dijual melebihi kepemilikan.');
      } else {
        assert(quantity === 0, 'Pilih sektor untuk menjual saham.');
      }
      player.coins = Math.max(0, player.coins - cost);
      if (sectorId) {
        player.holdings[sectorId] -= quantity;
        player.coins += quantity * sectorPrice(game, sectorId);
      }
      game.lastMessage = `${player.name} membayar trading fee ${cost} koin dan menjual ${quantity} saham.`;
      break;
    }
    case 'akuisisi': {
      const target = playerByUid(game, data.targetUid);
      const sectorId = data.sector;
      assert(target && target.uid !== player.uid, 'Pilih target akuisisi yang valid.');
      assert(SECTORS.some((sector) => sector.id === sectorId), 'Akuisisi hanya berlaku untuk Saham, bukan Reksa Dana.');
      assert(target.holdings[sectorId] > 0 && player.holdings[sectorId] >= target.holdings[sectorId], 'Syarat jumlah saham untuk akuisisi belum terpenuhi.');
      target.holdings[sectorId] -= 1;
      player.holdings[sectorId] += 1;
      const compensation = Math.floor(sectorPrice(game, sectorId) / 2);
      target.coins += compensation;
      game.lastMessage = `${player.name} mengambil 1 saham ${sectorId} dari ${target.name}; kompensasi ${compensation} koin.`;
      break;
    }
    default:
      throw new Error('Efek kartu tidak dikenali.');
  }
}

function applyActionInPlace(game, uid, payload) {
  assert(game.phase === 'action', 'Bukan fase aksi.');
  assert(payload.mode === 'save' || payload.mode === 'activate', 'Pilih untuk menyimpan atau mengaktifkan kartu.');
  if (!Array.isArray(game.quickbuySkipped)) game.quickbuySkipped = [];
  const player = currentPlayer(game);
  assert(player?.uid === uid, 'Sekarang bukan giliran Anda.');
  const cardIndex = game.pool.findIndex((card) => card.id === payload.cardId);
  assert(cardIndex >= 0, 'Kartu sudah diambil pemain lain.');
  const [card] = game.pool.splice(cardIndex, 1);

  if (payload.mode === 'save') {
    player.holdings[card.theme] += 1;
    game.lastMessage = `${player.name} menyimpan 1 saham ${card.theme}.`;
  } else {
    applyActionEffect(game, player, card, payload.effectData || {});
  }

  if (game.pool.length === 0) {
    game.phase = 'sell';
    game.sellIndex = 0;
    game.quickbuySkipped = [];
  } else {
    game.turnIndex = (game.turnIndex + 1) % game.order.length;
    let guard = 0;
    while (game.quickbuySkipped.includes(game.order[game.turnIndex]) && guard < game.order.length) {
      const skippedUid = game.order[game.turnIndex];
      game.quickbuySkipped = game.quickbuySkipped.filter((uid) => uid !== skippedUid);
      game.turnIndex = (game.turnIndex + 1) % game.order.length;
      guard += 1;
    }
  }
  return game;
}

export function applyAction(game, uid, payload) {
  const draft = structuredClone(game);
  applyActionInPlace(draft, uid, payload);
  Object.assign(game, draft);
  return game;
}

export function applySale(game, uid, sectorId, quantity) {
  assert(game.phase === 'sell', 'Bukan fase jual.');
  const player = currentPlayer(game);
  assert(player?.uid === uid, 'Sekarang bukan giliran Anda.');
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  if (sectorId) {
    assert(Object.hasOwn(player.holdings, sectorId), 'Sektor tidak valid.');
    assert(qty <= player.holdings[sectorId], 'Jumlah jual melebihi saham yang dimiliki.');
    player.holdings[sectorId] -= qty;
    player.coins += qty * sectorPrice(game, sectorId);
  }
  game.sellIndex += 1;
  if (game.sellIndex >= game.order.length) game.phase = 'economy';
  game.lastMessage = sectorId ? `${player.name} menyelesaikan penjualan saham.` : `${player.name} melewati fase jual.`;
  return game;
}

export function skipCurrentTurn(game) {
  if (game.phase === 'action') {
    const player = currentPlayer(game);
    game.turnIndex += 1;
    game.lastMessage = `Moderator melewati giliran aksi ${player?.name || 'pemain'} yang terputus.`;
  } else if (game.phase === 'sell') {
    const player = currentPlayer(game);
    game.sellIndex += 1;
    if (game.sellIndex >= game.order.length) game.phase = 'economy';
    game.lastMessage = `Moderator melewati giliran jual ${player?.name || 'pemain'} yang terputus.`;
  } else {
    throw new Error('Tidak ada giliran yang dapat dilewati pada fase ini.');
  }
  return game;
}

function moveSector(game, sector, steps, log) {
  while (steps !== 0) {
    const index = sector.track.indexOf(sector.price);
    const direction = Math.sign(steps);
    const next = index + direction;
    if (next < 0) {
      for (const player of game.players) player.holdings[sector.id] = 0;
      sector.price = 5;
      log.push(`${sector.name}: Stock Crash — seluruh saham kembali ke Bank; harga reset ke 5.`);
    } else if (next >= sector.track.length) {
      for (const player of game.players) player.holdings[sector.id] *= 2;
      sector.price = 5;
      log.push(`${sector.name}: Stock Split — saham berlipat ganda; harga reset ke 5.`);
    } else {
      sector.price = sector.track[next];
    }
    steps -= direction;
  }
}

function realSectorOrder(game) {
  return game.sectors;
}

export function resolveEconomy(game) {
  assert(game.phase === 'economy', 'Fase ekonomi belum dapat dijalankan.');
  const drawn = realSectorOrder(game).map((sector) => ({ sector, card: game.economyPiles[sector.id].shift() || null }));
  const log = [];
  const restructure = drawn.find((item) => item.card?.side === 'restrukturisasi');

  if (restructure) {
    for (const sector of game.sectors) sector.price = 5;
    log.push(`${restructure.sector.name}: Restrukturisasi — semua harga kembali ke 5; efek lain dibatalkan.`);
    for (const item of drawn) if (item !== restructure && item.card) log.push(`${item.sector.name}: ${item.card.label} dibatalkan.`);
  } else {
    for (const item of drawn) {
      if (item.card?.side === 'resesi') {
        for (const sector of game.sectors) if (sector.track.indexOf(sector.price) > sector.track.indexOf(5)) moveSector(game, sector, -1, log);
        log.push(`${item.sector.name}: Resesi — saham di atas IPO turun 1 poin.`);
      }
    }

    const baseSteps = {};
    for (const { sector, card } of drawn) {
      if (!card || ['resesi', 'stimulus', 'merger'].includes(card.side)) continue;
      if (card.side === 'worldoil') {
        const mining = game.sectors.find((item) => item.id === 'tambang');
        moveSector(game, mining, 1, log);
        baseSteps[mining.id] = (baseSteps[mining.id] || 0) + 1;
        if (sector.id !== mining.id) baseSteps[sector.id] = 0;
      } else {
        moveSector(game, sector, card.steps, log);
        baseSteps[sector.id] = (baseSteps[sector.id] || 0) + card.steps;
      }

      if (card.side === 'dividen') {
        for (const player of game.players) player.coins += player.holdings[sector.id] || 0;
      } else if (card.side === 'extrafee') {
        for (const player of game.players) player.coins = Math.max(0, player.coins - (player.holdings[sector.id] || 0));
      } else if (card.side === 'penerbitan') {
        for (const player of game.players) if (player.holdings[sector.id] > 0) player.holdings[sector.id] += 1;
      } else if (card.side === 'pajak') {
        for (const player of game.players) player.coins = Math.max(0, player.coins - (game.order.indexOf(player.uid) + 1));
      } else if (card.side === 'buyback') {
        const price = sector.price;
        for (const player of game.players) {
          player.coins += player.holdings[sector.id] * price;
          player.holdings[sector.id] = 0;
        }
        sector.price = 5;
      }
      log.push(`${sector.name}: ${card.label}${card.side ? ` — ${card.side}` : ` (${card.steps >= 0 ? '+' : ''}${card.steps})`}.`);
    }

    const taxAmnesty = drawn.find((item) => item.card?.side === 'taxamnesty');
    if (taxAmnesty) {
      for (const item of drawn) if (item !== taxAmnesty && (baseSteps[item.sector.id] || 0) > 0) moveSector(game, item.sector, 1, log);
      log.push('Tax Amnesty: kenaikan sektor lain mendapat bonus +1.');
    }
    for (const item of drawn) {
      if (item.card?.side === 'merger') {
        const index = game.sectors.indexOf(item.sector);
        const neighbor = game.sectors[index === game.sectors.length - 1 ? index - 1 : index + 1];
        const steps = baseSteps[neighbor.id] || 0;
        moveSector(game, item.sector, steps, log);
        log.push(`${item.sector.name}: Merger mengikuti langkah dasar ${neighbor.name} (${steps}).`);
      }
    }
    for (const item of drawn) {
      if (item.card?.side === 'stimulus') {
        for (const sector of game.sectors) if (sector.track.indexOf(sector.price) < sector.track.indexOf(5)) moveSector(game, sector, 1, log);
        log.push('Stimulus: saham di bawah IPO naik 1 poin.');
      }
    }
  }

  game.economyLog = log;
  game.lastEconomyCards = drawn.map(({ sector, card }) => ({ sectorId: sector.id, sectorName: sector.name, label: card?.label || '(dek habis)' }));
  const exhausted = game.sectors.every((sector) => game.economyPiles[sector.id].length === 0);
  game.phase = exhausted ? 'complete' : 'between';
  game.lastMessage = `Fase ekonomi ronde ${game.round} selesai.`;
  return game;
}

export function startNextRound(game) {
  assert(game.phase === 'between', 'Permainan belum siap memulai ronde berikutnya.');
  game.round += 1;
  game.phase = 'bidding';
  game.lastBids = null;
  game.lastMessage = `Ronde ${game.round} dimulai. Masukkan tawaran secara rahasia.`;
  return game;
}

export function finalScores(game) {
  return [...game.players].map((player) => {
    const shareValue = Object.entries(player.holdings).reduce((sum, [sectorId, quantity]) => sum + quantity * sectorPrice(game, sectorId), 0);
    const debt = player.utang * 13;
    return { uid: player.uid, name: player.name, coins: player.coins, shareValue, debt, total: player.coins + shareValue - debt };
  }).sort((a, b) => b.total - a.total);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export const ACTION_LABELS = ACTION_NAMES;
export const SECTOR_NAMES = Object.fromEntries([...SECTORS.map(({ id, name }) => [id, `Saham ${name}`]), ['reksadana', 'Reksa Dana']]);
