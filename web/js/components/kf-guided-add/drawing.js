// Several shapes glued into one drawing (Draw step and thing card Redraw). Pure: no DOM.
// The parent draws closed shapes one stroke at a time (a body, then a head, then ears); they are
// kept at drawing size in board coords and merged into ONE outline (geometry/union.js), so a Thing
// still has a single outline and everything downstream is unchanged. Unit tested in drawing.test.js.
import { unionOutlines } from "../../geometry/union.js";
import { BOARD_ASPECT, fitOutline } from "../../geometry/stroke.js";

export const MAX_SHAPES = 6;

/** Size an existing (thing-sized) outline is shown at when it becomes shape 1 of a redraw. */
export const DRAWING_SIZE = Object.freeze({ w: 0.5, h: 0.62, cx: 0.5, cy: 0.48 });

const copy = (poly) => poly.map(([x, y]) => [x, y]);

export class ShapeDrawing {
  /** @param {import('../../types.js').Point[][]} [shapes] */
  constructor(shapes = []) {
    this.shapes = shapes.filter((s) => Array.isArray(s) && s.length >= 3).slice(0, MAX_SHAPES).map(copy);
    this._merged = null;
  }

  /** Starts a drawing from a thing's outline, scaled up to drawing size, as shape 1. */
  static fromOutline(outline) {
    if (!Array.isArray(outline) || outline.length < 3) return new ShapeDrawing();
    const { w, h, cx, cy } = DRAWING_SIZE;
    return new ShapeDrawing([fitOutline(outline, { maxW: w, maxH: h, cx, cy })]);
  }

  get count() { return this.shapes.length; }
  get full() { return this.shapes.length >= MAX_SHAPES; }

  /** Adds a closed shape. False when there are already MAX_SHAPES or the shape is degenerate. */
  add(points) {
    if (this.full || !Array.isArray(points) || points.length < 3) return false;
    this.shapes.push(copy(points));
    this._merged = null;
    return true;
  }

  undo() {
    if (!this.shapes.length) return false;
    this.shapes.pop();
    this._merged = null;
    return true;
  }

  clear() {
    this.shapes = [];
    this._merged = null;
  }

  /** The merged outline at drawing size (board coords); [] when empty. Cached. */
  get merged() {
    this._merged ??= unionOutlines(this.shapes, { aspect: BOARD_ASPECT });
    return this._merged;
  }
}
