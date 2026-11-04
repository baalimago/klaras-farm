// Several shapes glued into one drawing (Draw step and thing card Redraw). Pure: no DOM.
// The parent draws closed shapes one stroke at a time (a body, then a head, then ears); they are
// kept at drawing size in board coords and merged into ONE outline (geometry/union.js), so a Thing
// still has a single outline and everything downstream is unchanged. Each shape stays editable
// (playtest 2): move, resize, redraw or delete one, and Undo takes back the last change of any kind.
// An open stroke whose ends lie in drawn shapes joins them (geometry/join.js). Unit tested in drawing.test.js.
import { unionOutlines } from "../../geometry/union.js";
import { joinOpenStroke, shapeAt } from "../../geometry/join.js";
import { BOARD_ASPECT, fitOutline, bbox } from "../../geometry/stroke.js";

export const MAX_SHAPES = 6;

/** Size an existing (thing-sized) outline is shown at when it becomes shape 1 of a redraw. */
export const DRAWING_SIZE = Object.freeze({ w: 0.5, h: 0.62, cx: 0.5, cy: 0.48 });

/** Smallest and largest a resized shape may get (the longer side of its box, board units). */
const MIN_SIDE = 0.04;
const MAX_SIDE = 1.2;
const MAX_HISTORY = 50;

const copy = (poly) => poly.map(([x, y]) => [x, y]);
const valid = (poly) => Array.isArray(poly) && poly.length >= 3;

/**
 * Scales a shape by k about its box centre, then moves it by (dx, dy). Uniform in board units, so
 * the on-screen aspect is kept.
 * @param {import('../../types.js').Point[]} poly
 * @param {{dx?: number, dy?: number, k?: number}} t
 */
export function transformPoints(poly, { dx = 0, dy = 0, k = 1 } = {}) {
  if (!dx && !dy && k === 1) return copy(poly);
  const b = bbox(poly);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return poly.map(([x, y]) => [cx + (x - cx) * k + dx, cy + (y - cy) * k + dy]);
}

/** Limits a scale factor so the shape's longer side stays between MIN_SIDE and MAX_SIDE. */
export function clampScale(poly, k) {
  if (!Number.isFinite(k) || k <= 0) return 1;
  const b = bbox(poly);
  const side = Math.max(b.w, b.h, 1e-6);
  return Math.max(MIN_SIDE / side, Math.min(MAX_SIDE / side, k));
}

export class ShapeDrawing {
  /** @param {import('../../types.js').Point[][]} [shapes] */
  constructor(shapes = []) {
    this.shapes = shapes.filter(valid).slice(0, MAX_SHAPES).map(copy);
    this._history = [];
    this._merged = null;
    this._without = new Map();
  }

  /** Starts a drawing from a thing's outline, scaled up to drawing size, as shape 1. */
  static fromOutline(outline) {
    if (!valid(outline)) return new ShapeDrawing();
    const { w, h, cx, cy } = DRAWING_SIZE;
    return new ShapeDrawing([fitOutline(outline, { maxW: w, maxH: h, cx, cy })]);
  }

  get count() { return this.shapes.length; }
  get full() { return this.shapes.length >= MAX_SHAPES; }
  get canUndo() { return this._history.length > 0; }

  /** Adds a closed shape. False when there are already MAX_SHAPES or the shape is degenerate. */
  add(points) {
    if (this.full || !valid(points)) return false;
    return this._commit([...this.shapes, copy(points)]);
  }

  /**
   * An open stroke: added (or put in place of shape `replace`) when both its ends lie in other drawn
   * shapes, closed through them. False when an end is outside every shape.
   */
  addOpen(points, { replace = -1 } = {}) {
    const others = this.shapes.map((s, i) => (i === replace ? null : s));
    const joined = joinOpenStroke(points, others);
    if (!joined) return false;
    return replace >= 0 ? this.replace(replace, joined.points) : this.add(joined.points);
  }

  /** Puts a newly drawn shape in place of shape i ("Draw it again"). */
  replace(i, points) {
    if (!this.shapes[i] || !valid(points)) return false;
    return this._commit(this.shapes.map((s, k) => (k === i ? copy(points) : s)));
  }

  remove(i) {
    if (!this.shapes[i]) return false;
    return this._commit(this.shapes.filter((_, k) => k !== i));
  }

  /** Moves and/or resizes shape i (see transformPoints). False when nothing changes. */
  transform(i, { dx = 0, dy = 0, k = 1 } = {}) {
    const s = this.shapes[i];
    if (!s) return false;
    const kk = clampScale(s, k);
    if (!dx && !dy && kk === 1) return false;
    return this._commit(this.shapes.map((p, n) => (n === i ? transformPoints(p, { dx, dy, k: kk }) : p)));
  }

  /** Index of the smallest shape under pt (within tol of its edge), or -1. */
  hit(pt, tol = 0) {
    return shapeAt(pt, this.shapes, tol);
  }

  /** Takes back the last change of any kind. */
  undo() {
    if (!this._history.length) return false;
    this._set(this._history.pop());
    return true;
  }

  /** Start over (undoable). */
  clear() {
    if (!this.shapes.length) return false;
    return this._commit([]);
  }

  /** The merged outline at drawing size (board coords); [] when empty. Cached. */
  get merged() {
    this._merged ??= unionOutlines(this.shapes, { aspect: BOARD_ASPECT });
    return this._merged;
  }

  /** The merged outline of every shape but i, for a cheap preview while shape i is dragged. Cached. */
  mergedWithout(i) {
    if (!this._without.has(i)) this._without.set(i, unionOutlines(this.shapes.filter((_, k) => k !== i), { aspect: BOARD_ASPECT }));
    return this._without.get(i);
  }

  _commit(next) {
    this._history.push(this.shapes);
    if (this._history.length > MAX_HISTORY) this._history.shift();
    this._set(next);
    return true;
  }

  _set(shapes) {
    this.shapes = shapes;
    this._merged = null;
    this._without.clear();
  }
}
