'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { FictionalEngine, wrapText } = require('../src/engine');

// ---------------------------------------------------------------------------
// wrapText utility
// ---------------------------------------------------------------------------

describe('wrapText', () => {
  test('returns empty array for empty string', () => {
    assert.deepEqual(wrapText('', 80), ['']);
  });

  test('does not split a line shorter than maxWidth', () => {
    assert.deepEqual(wrapText('hello world', 80), ['hello world']);
  });

  test('wraps long text at word boundaries', () => {
    const text = 'one two three four five';
    const lines = wrapText(text, 10);
    for (const line of lines) {
      assert.ok(line.length <= 10, `Line too long: "${line}"`);
    }
    // Rejoining should give back the original words.
    assert.equal(lines.join(' '), text);
  });

  test('handles a single very long word', () => {
    const word = 'superlongword';
    const lines = wrapText(word, 5);
    assert.deepEqual(lines, [word]);
  });
});

// ---------------------------------------------------------------------------
// Scene management
// ---------------------------------------------------------------------------

describe('FictionalEngine — scenes', () => {
  /** @type {FictionalEngine} */
  let engine;
  beforeEach(() => { engine = new FictionalEngine(); });

  test('addScene / getScene round-trip', () => {
    const scene = { name: 'Forest', description: 'A dark forest.', exits: ['north'] };
    engine.addScene('forest', scene);
    assert.equal(engine.getScene('forest'), scene);
  });

  test('getScene returns undefined for unknown id', () => {
    assert.equal(engine.getScene('nowhere'), undefined);
  });

  test('addScene rejects empty string id', () => {
    assert.throws(() => engine.addScene('', {}), TypeError);
  });

  test('addScene rejects non-string id', () => {
    assert.throws(() => engine.addScene(42, {}), TypeError);
  });

  test('goToScene sets current scene and emits events', () => {
    engine.addScene('start', { name: 'Start' });
    engine.addScene('end', { name: 'End' });

    const changeEvents = [];
    const enterEvents = [];
    engine.on('sceneChange', (d) => changeEvents.push(d));
    engine.on('sceneEnter', (d) => enterEvents.push(d));

    engine.goToScene('start');
    assert.equal(changeEvents.length, 1);
    assert.equal(changeEvents[0].current, 'start');
    assert.equal(changeEvents[0].previous, null);

    engine.goToScene('end');
    assert.equal(changeEvents[1].previous, 'start');
    assert.equal(enterEvents[1].sceneId, 'end');
  });

  test('goToScene throws for unknown scene', () => {
    assert.throws(() => engine.goToScene('missing'), RangeError);
  });
});

// ---------------------------------------------------------------------------
// Entity management
// ---------------------------------------------------------------------------

describe('FictionalEngine — entities', () => {
  /** @type {FictionalEngine} */
  let engine;
  beforeEach(() => { engine = new FictionalEngine(); });

  test('addEntity / getEntity round-trip', () => {
    const entity = { name: 'Wizard', tags: ['npc', 'magic'] };
    engine.addEntity('wizard', entity);
    assert.equal(engine.getEntity('wizard'), entity);
  });

  test('getEntity returns undefined for unknown id', () => {
    assert.equal(engine.getEntity('ghost'), undefined);
  });

  test('addEntity rejects empty id', () => {
    assert.throws(() => engine.addEntity('', {}), TypeError);
  });

  test('findEntitiesByTags returns matching entities', () => {
    engine.addEntity('wizard', { name: 'Wizard', tags: ['npc', 'magic'] });
    engine.addEntity('knight', { name: 'Knight', tags: ['npc', 'warrior'] });
    engine.addEntity('chest', { name: 'Chest', tags: ['item'] });

    const npcs = engine.findEntitiesByTags(['npc']);
    assert.equal(npcs.length, 2);

    const magicNpcs = engine.findEntitiesByTags(['npc', 'magic']);
    assert.equal(magicNpcs.length, 1);
    assert.equal(magicNpcs[0].name, 'Wizard');
  });

  test('findEntitiesByTags returns empty array when nothing matches', () => {
    engine.addEntity('rock', { name: 'Rock', tags: ['item'] });
    assert.deepEqual(engine.findEntitiesByTags(['npc']), []);
  });

  test('findEntitiesByTags skips entities without tags array', () => {
    engine.addEntity('phantom', { name: 'Phantom' }); // no tags property
    assert.deepEqual(engine.findEntitiesByTags(['npc']), []);
  });
});

// ---------------------------------------------------------------------------
// Description rendering and memoization
// ---------------------------------------------------------------------------

describe('FictionalEngine — renderDescription', () => {
  /** @type {FictionalEngine} */
  let engine;
  beforeEach(() => { engine = new FictionalEngine(); });

  test('renders scene name and description', () => {
    engine.addScene('cave', {
      name: 'Dark Cave',
      description: 'Dripping water echoes.',
      exits: ['south'],
    });
    const output = engine.renderDescription('cave');
    assert.ok(output.includes('Dark Cave'), 'Should include scene name');
    assert.ok(output.includes('Dripping water echoes.'), 'Should include description');
    assert.ok(output.includes('south'), 'Should include exits');
  });

  test('memoizes: second call returns the exact same string instance', () => {
    engine.addScene('meadow', { name: 'Meadow', description: 'Green grass.' });
    const first = engine.renderDescription('meadow');
    const second = engine.renderDescription('meadow');
    // Strict reference equality confirms the cached value is returned, not a
    // newly generated string that happens to be identical.
    assert.strictEqual(first, second);
  });

  test('cache is invalidated when addScene is called with the same id', () => {
    engine.addScene('room', { name: 'Room', description: 'Plain.' });
    const before = engine.renderDescription('room');

    engine.addScene('room', { name: 'Room', description: 'Redecorated.' });
    const after = engine.renderDescription('room');

    assert.ok(before.includes('Plain.'));
    assert.ok(after.includes('Redecorated.'));
    assert.notEqual(before, after);
  });

  test('throws for unknown scene', () => {
    assert.throws(() => engine.renderDescription('nowhere'), RangeError);
  });

  test('renders without exits when exits is missing', () => {
    engine.addScene('void', { name: 'Void', description: 'Nothing here.' });
    const output = engine.renderDescription('void');
    assert.ok(!output.includes('Exits:'), 'Should not include Exits line');
  });
});

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

describe('FictionalEngine — events', () => {
  /** @type {FictionalEngine} */
  let engine;
  beforeEach(() => { engine = new FictionalEngine(); });

  test('on / off wires and removes listeners correctly', () => {
    const calls = [];
    const handler = (d) => calls.push(d);

    engine.on('test', handler);
    engine._dispatch('test', { value: 1 });
    assert.equal(calls.length, 1);

    engine.off('test', handler);
    engine._dispatch('test', { value: 2 });
    assert.equal(calls.length, 1); // handler was removed
  });

  test('dispatch with no listeners does not throw', () => {
    assert.doesNotThrow(() => engine._dispatch('nothing'));
  });

  test('on rejects non-function listeners', () => {
    assert.throws(() => engine.on('event', 'not-a-function'), TypeError);
  });

  test('off on unknown event type is a no-op', () => {
    assert.doesNotThrow(() => engine.off('ghost', () => {}));
  });

  test('multiple listeners all receive the event', () => {
    const a = [];
    const b = [];
    engine.on('ping', (d) => a.push(d));
    engine.on('ping', (d) => b.push(d));
    engine._dispatch('ping', { n: 42 });
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].n, 42);
  });
});
