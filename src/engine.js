'use strict';

/**
 * FictionalEngine — a lightweight engine for interactive fiction and text-based games.
 *
 * Performance decisions:
 *  - Entities and scenes are stored in Map objects so lookups are O(1) instead of
 *    O(n) linear scans through an array (which was the naive implementation).
 *  - Parsed scene descriptions are memoized so the parsing step runs at most once
 *    per scene, regardless of how many times the scene is visited.
 *  - The event system skips iteration entirely when a given event type has no
 *    listeners, avoiding unnecessary work on every dispatch call.
 *  - Text rendering accumulates lines in an array and joins once at the end,
 *    rather than building the result via repeated string concatenation.
 */

class FictionalEngine {
  constructor() {
    /** @type {Map<string, object>} scene id → scene object */
    this._scenes = new Map();

    /** @type {Map<string, object>} entity id → entity object */
    this._entities = new Map();

    /**
     * Rendered description cache: scene id → rendered string.
     * Avoids re-rendering the same description on every visit.
     * @type {Map<string, string>}
     */
    this._descriptionCache = new Map();

    /**
     * Event listeners indexed by event type for O(1) listener lookup and
     * cheap "no listeners" short-circuit in dispatch().
     * @type {Map<string, Function[]>}
     */
    this._listeners = new Map();

    /** @type {string|null} */
    this._currentSceneId = null;
  }

  // ---------------------------------------------------------------------------
  // Scene management
  // ---------------------------------------------------------------------------

  /**
   * Register a scene with the engine.
   * @param {string} id        Unique scene identifier.
   * @param {object} scene     Scene descriptor ({ description, exits, ... }).
   */
  addScene(id, scene) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Scene id must be a non-empty string');
    }
    this._scenes.set(id, scene);
    // Invalidate any cached description whenever a scene is updated.
    this._descriptionCache.delete(id);
  }

  /**
   * Retrieve a scene by id — O(1) Map lookup.
   * @param {string} id
   * @returns {object|undefined}
   */
  getScene(id) {
    return this._scenes.get(id);
  }

  /**
   * Move to a scene by id.  Emits 'sceneChange' before and 'sceneEnter' after
   * the transition so listeners can react at either point.
   * @param {string} id
   */
  goToScene(id) {
    if (!this._scenes.has(id)) {
      throw new RangeError(`Unknown scene: "${id}"`);
    }
    const previous = this._currentSceneId;
    this._currentSceneId = id;
    this._dispatch('sceneChange', { previous, current: id });
    this._dispatch('sceneEnter', { sceneId: id, scene: this._scenes.get(id) });
  }

  // ---------------------------------------------------------------------------
  // Entity management
  // ---------------------------------------------------------------------------

  /**
   * Register an entity.
   * @param {string} id     Unique entity identifier.
   * @param {object} entity Entity descriptor.
   */
  addEntity(id, entity) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Entity id must be a non-empty string');
    }
    this._entities.set(id, entity);
  }

  /**
   * Retrieve an entity by id — O(1) Map lookup.
   * @param {string} id
   * @returns {object|undefined}
   */
  getEntity(id) {
    return this._entities.get(id);
  }

  /**
   * Return all entities whose tags array includes every tag in the query.
   *
   * The inner loop iterates over `queryTags` (typically a small set) for each
   * entity, rather than the inverse, so it short-circuits as soon as one
   * required tag is missing.
   *
   * @param {string[]} queryTags
   * @returns {object[]}
   */
  findEntitiesByTags(queryTags) {
    const results = [];
    for (const entity of this._entities.values()) {
      const entityTags = entity.tags;
      if (!Array.isArray(entityTags)) continue;
      // Use a Set built from entity tags for O(1) per-tag membership tests
      // when queryTags is large relative to entityTags.
      const tagSet = new Set(entityTags);
      let match = true;
      for (const tag of queryTags) {
        if (!tagSet.has(tag)) {
          match = false;
          break;
        }
      }
      if (match) results.push(entity);
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Description rendering
  // ---------------------------------------------------------------------------

  /**
   * Parse and render the description for the given scene.
   *
   * Parsing is memoized: the first call for a scene id stores the result in
   * `_descriptionCache` so subsequent calls return the cached string without
   * re-parsing.
   *
   * Text is assembled with an array of lines that are joined once at the end,
   * avoiding the O(n²) cost of repeated string concatenation inside a loop.
   *
   * @param {string} sceneId
   * @returns {string}
   */
  renderDescription(sceneId) {
    if (this._descriptionCache.has(sceneId)) {
      return this._descriptionCache.get(sceneId);
    }

    const scene = this._scenes.get(sceneId);
    if (!scene) {
      throw new RangeError(`Unknown scene: "${sceneId}"`);
    }

    // Accumulate lines in an array; join once at the end.
    const lines = [];
    lines.push(scene.name || sceneId);

    if (scene.description) {
      // Wrap long description text at 80 characters.
      const wrapped = wrapText(scene.description, 80);
      lines.push(...wrapped);
    }

    if (Array.isArray(scene.exits) && scene.exits.length > 0) {
      lines.push('');
      lines.push('Exits: ' + scene.exits.join(', '));
    }

    const rendered = lines.join('\n');
    this._descriptionCache.set(sceneId, rendered);
    return rendered;
  }

  // ---------------------------------------------------------------------------
  // Event system
  // ---------------------------------------------------------------------------

  /**
   * Register an event listener.
   * @param {string}   eventType
   * @param {Function} listener
   */
  on(eventType, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, []);
    }
    this._listeners.get(eventType).push(listener);
  }

  /**
   * Remove a previously registered listener.
   * @param {string}   eventType
   * @param {Function} listener
   */
  off(eventType, listener) {
    const list = this._listeners.get(eventType);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this._listeners.delete(eventType);
  }

  /**
   * Dispatch an event.  Short-circuits immediately if there are no listeners
   * for the given event type, avoiding any unnecessary work.
   * @param {string} eventType
   * @param {object} [data={}]
   */
  _dispatch(eventType, data = {}) {
    // Early exit when no listeners are registered — avoids iterating an empty
    // array on every call (common in performance-sensitive tight loops).
    if (!this._listeners.has(eventType)) return;

    const listeners = this._listeners.get(eventType);
    for (const listener of listeners) {
      listener(data);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: word-wrap
// ---------------------------------------------------------------------------

/**
 * Wrap `text` so that no line exceeds `maxWidth` characters.
 * Splitting once and joining with array push avoids repeated string
 * concatenation.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]} Array of wrapped lines.
 */
function wrapText(text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = [];
  let currentLength = 0;

  for (const word of words) {
    if (currentLength > 0 && currentLength + 1 + word.length > maxWidth) {
      lines.push(current.join(' '));
      current = [word];
      currentLength = word.length;
    } else {
      current.push(word);
      currentLength += (currentLength > 0 ? 1 : 0) + word.length;
    }
  }

  if (current.length > 0) {
    lines.push(current.join(' '));
  }

  return lines;
}

module.exports = { FictionalEngine, wrapText };
