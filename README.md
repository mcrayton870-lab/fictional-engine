# fictional-engine

A lightweight JavaScript engine for interactive fiction and text-based games.

## Features

- **Scene management** – register scenes and navigate between them
- **Entity management** – store and query game entities by tag
- **Event system** – subscribe to engine events (scene changes, etc.)
- **Description rendering** – word-wrapped text output

## Performance decisions

| Pattern | Naive approach | This implementation |
|---|---|---|
| Scene / entity lookup | `Array.find()` — O(n) per call | `Map.get()` — O(1) per call |
| Description rendering | Re-parse on every visit | Memoized: parse once, cache forever (cache is invalidated when a scene is updated) |
| Event dispatch | Iterate array even when empty | Short-circuit immediately when no listeners are registered |
| Text assembly | Repeated `+=` string concatenation | Accumulate into an array, `join()` once |

## Quick start

```js
const { FictionalEngine } = require('./src');

const engine = new FictionalEngine();

engine.addScene('forest', {
  name: 'Forest',
  description: 'Tall trees surround you. The path continues north.',
  exits: ['north'],
});

engine.on('sceneEnter', ({ sceneId }) => {
  console.log(engine.renderDescription(sceneId));
});

engine.goToScene('forest');
```

## Running tests

```bash
node --test test/engine.test.js
```
