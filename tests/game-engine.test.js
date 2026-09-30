import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  applySale,
  createGame,
  currentPlayer,
  finalScores,
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

test('Trading Fee remains valid when the player has nothing to sell', () => {
  const game = setupGame();
  game.phase = 'action';
  game.pool = [{ id: 'fee', theme: 'keuangan', effect: 'fee' }];
  applyAction(game, 'a', { cardId: 'fee', mode: 'activate', effectData: {} });
  assert.equal(game.players.find((player) => player.uid === 'a').coins, 14);
  assert.equal(game.phase, 'sell');
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
