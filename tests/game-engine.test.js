import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  applySale,
  createGame,
  currentPlayer,
  finalScores,
  requestLoan,
  resolveBids,
  resolveEconomy,
  startNextRound
} from '../src/game-engine.js';

function setupGame() {
  const game = createGame([
    { uid: 'a', name: 'A' },
    { uid: 'b', name: 'B' },
    { uid: 'c', name: 'C' }
  ]);
  game.order = ['a', 'b', 'c'];
  return game;
}

function economyCard(key, label, steps = 0, side) {
  return { key, label, steps, ...(side ? { side } : {}) };
}

function setupEconomy(cardsBySector) {
  const game = setupGame();
  game.sectors = ['tambang', 'konsumer', 'keuangan', 'agrikultur'].map((id) => game.sectors.find((sector) => sector.id === id));
  game.phase = 'economy';
  game.economyPiles = Object.fromEntries(game.sectors.map((sector) => [sector.id, cardsBySector[sector.id] ? [cardsBySector[sector.id]] : []]));
  return game;
}

function setHolding(game, uid, sector, quantity) {
  game.players.find((player) => player.uid === uid).holdings[sector] = quantity;
}

function setCoins(game, uid, amount) {
  game.players.find((player) => player.uid === uid).coins = amount;
}

test('game starts with a valid market and private decks', () => {
  const game = setupGame();
  assert.equal(game.players.length, 3);
  assert.equal(game.sectors.length, 4);
  assert.equal(game.economyPiles.tambang.length, 6);
  assert.equal(game.phase, 'bidding');
});

test('bidding resolves by highest bid and charges balances', () => {
  const game = setupGame();
  resolveBids(game, {
    a: { round: 1, bid: 1 },
    b: { round: 1, bid: 3 },
    c: { round: 1, bid: 2 }
  });
  assert.deepEqual(game.order, ['b', 'c', 'a']);
  assert.equal(game.players.find((player) => player.uid === 'b').coins, 12);
  assert.equal(game.phase, 'action');
});

test('action and sale phases advance only for the current player', () => {
  const game = setupGame();
  game.phase = 'action';
  game.pool = [{ id: 'one', theme: 'tambang', effect: 'info' }];
  applyAction(game, 'a', { cardId: 'one', mode: 'save' });
  assert.equal(game.players.find((player) => player.uid === 'a').holdings.tambang, 1);
  assert.equal(game.phase, 'sell');
  applySale(game, 'a', 'tambang', 1);
  applySale(game, 'b');
  applySale(game, 'c');
  assert.equal(game.phase, 'economy');
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 20);
});

test('Info Bursa privately validates its two chosen sectors and adds coins', () => {
  const game = setupGame();
  game.phase = 'action';
  game.pool = [{ id: 'info', theme: 'tambang', effect: 'info' }];
  applyAction(game, 'a', { cardId: 'info', mode: 'activate', effectData: { sectors: ['tambang', 'konsumer'] } });
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 17);
  assert.throws(() => {
    const invalid = setupGame();
    invalid.phase = 'action';
    invalid.pool = [{ id: 'info', theme: 'tambang', effect: 'info' }];
    applyAction(invalid, 'a', { cardId: 'info', mode: 'activate', effectData: { sectors: ['tambang', 'tambang'] } });
  }, /dua sektor berbeda/);
});

test('Rumor applies at most two movements and Quickbuy stores two extra cards', () => {
  const rumorGame = setupGame();
  rumorGame.phase = 'action';
  rumorGame.pool = [{ id: 'rumor', theme: 'tambang', effect: 'rumor' }];
  const mining = rumorGame.sectors.find((sector) => sector.id === 'tambang');
  applyAction(rumorGame, 'a', { cardId: 'rumor', mode: 'activate', effectData: { moves: [{ sector: 'tambang', direction: 'up' }, { sector: 'tambang', direction: 'down' }] } });
  assert.equal(mining.price, 5);

  const quickGame = setupGame();
  quickGame.phase = 'action';
  quickGame.pool = [
    { id: 'quick', theme: 'reksadana', effect: 'quickbuy' },
    { id: 'extra-a', theme: 'tambang', effect: 'rumor' },
    { id: 'extra-b', theme: 'konsumer', effect: 'fee' },
    { id: 'extra-c', theme: 'agrikultur', effect: 'info' }
  ];
  applyAction(quickGame, 'a', { cardId: 'quick', mode: 'activate', effectData: { additionalIds: ['extra-a', 'extra-b'] } });
  const investor = quickGame.players.find((player) => player.uid === 'a');
  assert.equal(investor.holdings.tambang, 1);
  assert.equal(investor.holdings.konsumer, 1);
  assert.equal(quickGame.phase, 'action');
  assert.equal(currentPlayer(quickGame).uid, 'b');
});

test('Quickbuy migrates a saved game without skip tracking', () => {
  const game = setupGame();
  game.phase = 'action';
  delete game.quickbuySkipped;
  game.pool = [
    { id: 'quick', theme: 'reksadana', effect: 'quickbuy' },
    { id: 'extra-a', theme: 'tambang', effect: 'rumor' },
    { id: 'extra-b', theme: 'konsumer', effect: 'fee' },
    { id: 'extra-c', theme: 'agrikultur', effect: 'info' }
  ];
  assert.doesNotThrow(() => applyAction(game, 'a', {
    cardId: 'quick',
    mode: 'activate',
    effectData: { additionalIds: ['extra-a', 'extra-b'] }
  }));
  assert.deepEqual(game.quickbuySkipped, ['a']);
  assert.equal(currentPlayer(game).uid, 'b');
});

test('Quickbuy skips its owner once in the current action phase and never into the next round', () => {
  const game = setupGame();
  game.phase = 'action';
  game.pool = [
    { id: 'quick', theme: 'reksadana', effect: 'quickbuy' },
    { id: 'b-card', theme: 'tambang', effect: 'info' },
    { id: 'c-card', theme: 'konsumer', effect: 'fee' },
    { id: 'later-1', theme: 'keuangan', effect: 'rumor' },
    { id: 'later-2', theme: 'agrikultur', effect: 'akuisisi' }
  ];
  applyAction(game, 'a', { cardId: 'quick', mode: 'activate', effectData: { additionalIds: [] } });
  applyAction(game, 'b', { cardId: 'b-card', mode: 'save' });
  applyAction(game, 'c', { cardId: 'c-card', mode: 'save' });
  assert.equal(currentPlayer(game).uid, 'b');
  assert.deepEqual(game.quickbuySkipped, []);
  applyAction(game, 'b', { cardId: 'later-1', mode: 'save' });
  applyAction(game, 'c', { cardId: 'later-2', mode: 'save' });
  assert.equal(game.phase, 'sell');
  assert.deepEqual(game.quickbuySkipped, []);
});

test('Trading Fee remains valid when the player has nothing to sell', () => {
  const game = setupGame();
  game.phase = 'action';
  game.pool = [{ id: 'fee', theme: 'keuangan', effect: 'fee' }];
  applyAction(game, 'a', { cardId: 'fee', mode: 'activate', effectData: {} });
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 14);
  assert.equal(game.phase, 'sell');
});

test('all five Action card effects resolve and validate invalid choices atomically', () => {
  const info = setupGame();
  info.phase = 'action';
  info.pool = [{ id: 'info', theme: 'tambang', effect: 'info' }];
  applyAction(info, 'a', { cardId: 'info', mode: 'activate', effectData: { sectors: ['tambang', 'agrikultur'] } });
  assert.equal(info.players.find((player) => player.uid === 'a').coins, 17);

  const rumor = setupGame();
  rumor.phase = 'action';
  rumor.pool = [{ id: 'rumor', theme: 'tambang', effect: 'rumor' }];
  assert.throws(() => applyAction(rumor, 'a', { cardId: 'rumor', mode: 'activate', effectData: { moves: [
    { sector: 'tambang', direction: 'up' }, { sector: 'unknown', direction: 'down' }
  ] } }), /sektor yang valid/);
  assert.equal(rumor.pool.length, 1);
  assert.equal(rumor.sectors.find((sector) => sector.id === 'tambang').price, 5);
  applyAction(rumor, 'a', { cardId: 'rumor', mode: 'activate', effectData: { moves: [{ sector: 'tambang', direction: 'up' }] } });
  assert.equal(rumor.sectors.find((sector) => sector.id === 'tambang').price, 6);

  const quickbuy = setupGame();
  quickbuy.phase = 'action';
  quickbuy.pool = [
    { id: 'quick', theme: 'reksadana', effect: 'quickbuy' },
    { id: 'extra', theme: 'tambang', effect: 'rumor' },
    { id: 'last', theme: 'konsumer', effect: 'info' },
    { id: 'last-2', theme: 'agrikultur', effect: 'fee' }
  ];
  assert.throws(() => applyAction(quickbuy, 'a', { cardId: 'quick', mode: 'activate', effectData: { additionalIds: ['extra', 'extra'] } }), /maksimal dua kartu berbeda/);
  assert.equal(quickbuy.pool.length, 4);
  applyAction(quickbuy, 'a', { cardId: 'quick', mode: 'activate', effectData: { additionalIds: ['extra'] } });
  assert.equal(quickbuy.players.find((player) => player.uid === 'a').holdings.tambang, 1);

  const fee = setupGame();
  fee.phase = 'action';
  fee.pool = [{ id: 'fee', theme: 'keuangan', effect: 'fee' }];
  setHolding(fee, 'a', 'tambang', 1);
  assert.throws(() => applyAction(fee, 'a', { cardId: 'fee', mode: 'activate', effectData: { sector: 'tambang', quantity: 2 } }), /melebihi kepemilikan/);
  assert.equal(fee.players.find((player) => player.uid === 'a').coins, 15);
  assert.equal(fee.players.find((player) => player.uid === 'a').holdings.tambang, 1);
  applyAction(fee, 'a', { cardId: 'fee', mode: 'activate', effectData: { sector: 'tambang', quantity: 1 } });
  assert.equal(fee.players.find((player) => player.uid === 'a').coins, 19);

  const acquisition = setupGame();
  acquisition.phase = 'action';
  acquisition.pool = [{ id: 'takeover', theme: 'tambang', effect: 'akuisisi' }];
  setHolding(acquisition, 'a', 'tambang', 2);
  setHolding(acquisition, 'b', 'tambang', 2);
  applyAction(acquisition, 'a', { cardId: 'takeover', mode: 'activate', effectData: { targetUid: 'b', sector: 'tambang' } });
  assert.equal(acquisition.players.find((player) => player.uid === 'a').holdings.tambang, 3);
  assert.equal(acquisition.players.find((player) => player.uid === 'b').holdings.tambang, 1);
  assert.equal(acquisition.players.find((player) => player.uid === 'b').coins, 17);
  const invalidAcquisition = setupGame();
  invalidAcquisition.phase = 'action';
  invalidAcquisition.pool = [{ id: 'takeover', theme: 'tambang', effect: 'akuisisi' }];
  setHolding(invalidAcquisition, 'a', 'tambang', 1);
  setHolding(invalidAcquisition, 'b', 'tambang', 2);
  assert.throws(() => applyAction(invalidAcquisition, 'a', { cardId: 'takeover', mode: 'activate', effectData: { targetUid: 'b', sector: 'tambang' } }), /Syarat jumlah saham/);
  assert.equal(invalidAcquisition.pool.length, 1);
});

test('all 18 Economy card types have their intended base movement and side effect', () => {
  const cases = [
    ['naik', 'Naik', 1, undefined, 6],
    ['melaju', 'Melaju', 2, undefined, 8],
    ['boom', 'Boom', 3, undefined, 9],
    ['sideways', 'Sideways', 0, undefined, 5],
    ['anjlok', 'Anjlok', -1, undefined, 3],
    ['terjun', 'Terjun', -2, undefined, 2],
    ['crash', 'Crash', -3, undefined, 5],
    ['dividen', 'Dividen', 0, 'dividen', 5],
    ['extrafee', 'Extra Fee', 0, 'extrafee', 5],
    ['penerbitan', 'Penerbitan Saham Baru', -1, 'penerbitan', 3],
    ['pajak', 'Pajak Jalan', 0, 'pajak', 5],
    ['taxamnesty', 'Tax Amnesty', 1, 'taxamnesty', 6],
    ['worldoil', 'World Oil Regulation', 0, 'worldoil', 6],
    ['restrukturisasi', 'Restrukturisasi Ekonomi', 0, 'restrukturisasi', 5],
    ['resesi', 'Resesi', 0, 'resesi', 5],
    ['stimulus', 'Stimulus Ekonomi', 0, 'stimulus', 5],
    ['merger', 'Merger', 0, 'merger', 5],
    ['buyback', 'Buyback', 1, 'buyback', 5]
  ];

  for (const [key, label, steps, side, expectedPrice] of cases) {
    const game = setupEconomy({ tambang: economyCard(key, label, steps, side) });
    game.order = ['a', 'b', 'c'];
    setHolding(game, 'a', 'tambang', 2);
    setHolding(game, 'b', 'tambang', 1);
    setCoins(game, 'a', 2);
    setCoins(game, 'b', 0);
    for (const sector of game.sectors) sector.price = 5;
    if (key === 'dividen' || key === 'extrafee' || key === 'penerbitan' || key === 'buyback') {
      // Shares remain in the selected sector for each effect's payout/issuance.
    }
    if (key === 'pajak') game.order = ['b', 'a', 'c'];
    resolveEconomy(game);
    assert.equal(game.sectors.find((sector) => sector.id === 'tambang').price, expectedPrice, `${label}: price`);
    assert.ok(game.sectors.every((sector) => sector.track.includes(sector.price)), `${label}: price remains on track`);
    if (key === 'dividen') {
      assert.equal(game.players.find((player) => player.uid === 'a').coins, 4);
      assert.equal(game.players.find((player) => player.uid === 'b').coins, 1);
    }
    if (key === 'extrafee') {
      assert.equal(game.players.find((player) => player.uid === 'a').coins, 0);
      assert.equal(game.players.find((player) => player.uid === 'b').coins, 0);
    }
    if (key === 'penerbitan') {
      assert.equal(game.players.find((player) => player.uid === 'a').holdings.tambang, 3);
      assert.equal(game.players.find((player) => player.uid === 'b').holdings.tambang, 2);
    }
    if (key === 'pajak') {
      assert.equal(game.players.find((player) => player.uid === 'b').coins, 0);
      assert.equal(game.players.find((player) => player.uid === 'a').coins, 0);
    }
    if (key === 'worldoil') assert.equal(game.sectors.find((sector) => sector.id === 'tambang').price, 6);
    if (key === 'restrukturisasi') assert.ok(game.sectors.every((sector) => sector.price === 5));
    if (key === 'buyback') {
      assert.equal(game.players.find((player) => player.uid === 'a').coins, 14);
      assert.equal(game.players.find((player) => player.uid === 'b').coins, 6);
      assert.equal(game.players.find((player) => player.uid === 'a').holdings.tambang, 0);
      assert.equal(game.players.find((player) => player.uid === 'b').holdings.tambang, 0);
    }
    assert.equal(game.phase, 'complete', `${label}: economy resolves and advances`);
  }
});

test('economic Stock Split doubles holdings, resets to IPO, then continues remaining steps', () => {
  const game = setupEconomy({ tambang: economyCard('boom', 'Boom', 3) });
  const mining = game.sectors.find((sector) => sector.id === 'tambang');
  mining.price = 9;
  setHolding(game, 'a', 'tambang', 2);
  setHolding(game, 'b', 'tambang', 1);
  resolveEconomy(game);
  assert.equal(mining.price, 8);
  assert.equal(game.players.find((player) => player.uid === 'a').holdings.tambang, 4);
  assert.equal(game.players.find((player) => player.uid === 'b').holdings.tambang, 2);
});

test('economic Stock Crash wipes holdings, resets to IPO, then continues remaining steps', () => {
  const game = setupEconomy({ tambang: economyCard('crash', 'Crash', -3) });
  const mining = game.sectors.find((sector) => sector.id === 'tambang');
  mining.price = 2;
  setHolding(game, 'a', 'tambang', 2);
  setHolding(game, 'b', 'tambang', 1);
  resolveEconomy(game);
  assert.equal(mining.price, 2);
  assert.equal(game.players.find((player) => player.uid === 'a').holdings.tambang, 0);
  assert.equal(game.players.find((player) => player.uid === 'b').holdings.tambang, 0);
});

test('Crash and Split boundaries behave correctly on every sector price ladder', () => {
  for (const id of ['tambang', 'konsumer', 'keuangan', 'agrikultur']) {
    const splitGame = setupEconomy({ [id]: economyCard('boom', 'Boom', 3) });
    const splitSector = splitGame.sectors.find((sector) => sector.id === id);
    splitSector.price = splitSector.track.at(-1);
    setHolding(splitGame, 'a', id, 2);
    resolveEconomy(splitGame);
    const ipoIndex = splitSector.track.indexOf(5);
    assert.equal(splitSector.price, splitSector.track[ipoIndex + 2], `${id} split remainder`);
    assert.equal(splitGame.players.find((player) => player.uid === 'a').holdings[id], 4, `${id} split shares`);
    assert.ok(splitGame.sectors.every((sector) => sector.price > 0), `${id} split has no zero-price asset`);

    const crashGame = setupEconomy({ [id]: economyCard('crash', 'Crash', -3) });
    const crashSector = crashGame.sectors.find((sector) => sector.id === id);
    crashSector.price = crashSector.track[0];
    setHolding(crashGame, 'a', id, 2);
    resolveEconomy(crashGame);
    assert.equal(crashSector.price, crashSector.track[ipoIndex - 2], `${id} crash remainder`);
    assert.equal(crashGame.players.find((player) => player.uid === 'a').holdings[id], 0, `${id} crash shares`);
    assert.ok(crashGame.sectors.every((sector) => sector.price > 0), `${id} crash has no zero-price asset`);
  }
});

test('Restrukturisasi cancels same-round cards without paying dividends or fees', () => {
  const game = setupEconomy({
    tambang: economyCard('restrukturisasi', 'Restrukturisasi Ekonomi', 0, 'restrukturisasi'),
    konsumer: economyCard('dividen', 'Dividen', 0, 'dividen'),
    keuangan: economyCard('naik', 'Naik', 1)
  });
  game.sectors.forEach((sector) => { sector.price = sector.id === 'konsumer' ? 8 : 2; });
  setHolding(game, 'a', 'konsumer', 3);
  setCoins(game, 'a', 2);
  resolveEconomy(game);
  assert.ok(game.sectors.every((sector) => sector.price === 5));
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 2);
  assert.equal(game.players.find((player) => player.uid === 'a').holdings.konsumer, 3);
});

test('Resesi and Stimulus move only eligible sectors and keep every price above zero', () => {
  const recession = setupEconomy({ tambang: economyCard('resesi', 'Resesi', 0, 'resesi') });
  recession.sectors.find((sector) => sector.id === 'tambang').price = 9;
  recession.sectors.find((sector) => sector.id === 'konsumer').price = 3;
  resolveEconomy(recession);
  assert.equal(recession.sectors.find((sector) => sector.id === 'tambang').price, 8);
  assert.equal(recession.sectors.find((sector) => sector.id === 'konsumer').price, 3);

  const stimulus = setupEconomy({ tambang: economyCard('stimulus', 'Stimulus Ekonomi', 0, 'stimulus') });
  stimulus.sectors.find((sector) => sector.id === 'tambang').price = 3;
  stimulus.sectors.find((sector) => sector.id === 'konsumer').price = 5;
  resolveEconomy(stimulus);
  assert.equal(stimulus.sectors.find((sector) => sector.id === 'tambang').price, 5);
  assert.equal(stimulus.sectors.find((sector) => sector.id === 'konsumer').price, 5);
  assert.ok(stimulus.sectors.every((sector) => sector.price > 0));
});

test('Tax Amnesty adds a bonus move to positive sectors; World Oil on Tambang retains its move', () => {
  const game = setupEconomy({
    tambang: economyCard('worldoil', 'World Oil Regulation', 0, 'worldoil'),
    konsumer: economyCard('taxamnesty', 'Tax Amnesty', 1, 'taxamnesty'),
    keuangan: economyCard('sideways', 'Sideways', 0)
  });
  resolveEconomy(game);
  assert.equal(game.sectors.find((sector) => sector.id === 'tambang').price, 8);
  assert.equal(game.sectors.find((sector) => sector.id === 'konsumer').price, 6);
});

test('Merger follows its right neighbor movement, including World Oil drawn on Tambang', () => {
  const game = setupEconomy({
    tambang: economyCard('worldoil', 'World Oil Regulation', 0, 'worldoil'),
    konsumer: economyCard('merger', 'Merger', 0, 'merger')
  });
  game.sectors = ['konsumer', 'tambang', 'keuangan', 'agrikultur'].map((id) => game.sectors.find((sector) => sector.id === id));
  resolveEconomy(game);
  assert.equal(game.sectors.find((sector) => sector.id === 'tambang').price, 6);
  assert.equal(game.sectors.find((sector) => sector.id === 'konsumer').price, 6);
});

test('loans, taxes, fees, and final scoring never create a zero-price asset or negative cash', () => {
  const game = setupGame();
  requestLoan(game, 'a');
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 25);
  assert.equal(game.players.find((player) => player.uid === 'a').utang, 1);
  assert.equal(game.utangRemaining, 4);
  const scores = finalScores(game);
  assert.equal(scores.find((score) => score.uid === 'a').debt, 13);
  assert.ok(game.sectors.every((sector) => sector.price > 0));

  const noLoan = setupGame();
  noLoan.utangRemaining = 0;
  assert.throws(() => requestLoan(noLoan, 'a'), /habis/);
  assert.equal(noLoan.players.find((player) => player.uid === 'a').coins, 15);
});

test('six economy rounds finish and produce finite scores', () => {
  const game = setupGame();
  while (game.phase !== 'complete') {
    if (game.phase === 'between') startNextRound(game);
    if (game.phase === 'bidding') {
      const bids = Object.fromEntries(game.players.map((player) => [player.uid, { round: game.round, bid: player.coins > 0 ? 1 : 0 }]));
      resolveBids(game, bids);
    }
    while (game.phase === 'action') {
      const player = currentPlayer(game);
      applyAction(game, player.uid, { cardId: game.pool[0].id, mode: 'save' });
    }
    while (game.phase === 'sell') applySale(game, currentPlayer(game).uid);
    if (game.phase === 'economy') resolveEconomy(game);
  }
  const scores = finalScores(game);
  assert.equal(scores.length, 3);
  assert.ok(scores.every((score) => Number.isFinite(score.total)));
});
