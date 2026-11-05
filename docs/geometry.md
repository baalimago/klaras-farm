# Geometry domain

Keep this file current: update it in the same commit as any change to this domain.

## Purpose

The geometry domain is the pure math behind drawing and tapping: cleaning up finger strokes, closing a drawn outline, joining a stroke onto the shapes it touches, merging several drawn shapes into one outline, polygon measures, keeping eyes inside a shape, fitting the 4:3 board into the screen, and deciding which thing a tap hits. It knows nothing about the farm data model beyond `Point`.

## Files

- `web/js/geometry/stroke.js`: stroke and polygon helpers, board and screen conversion, `closeGap`, `BOARD_ASPECT`.
- `web/js/geometry/union.js`: `unionOutlines`, the raster union of several drawn shapes into one simple closed outline.
- `web/js/geometry/join.js`: `touches`, whether a stroke or shape touches a drawn shape, and `joinOpenStroke`, closing an open stroke that touches drawn shapes, so it joins them.
- `web/js/geometry/hit.js`: `hitTest`, tap hit testing over things in drawing order.
- `web/js/geometry/transform.js`: moving and resizing drawings: `translationBetween`, `clampDelta`, `translatePoints`, `scaleAbout`, `clampScale`, `movedThingPatch`, `MIN_SIDE`, and for resizing things `thingSize`, `footPoint`, `clampThingScale`, `scaledThingPatch`.

## Units

- Points are `[x, y]` arrays (`Point` in `types.js`). They are usually board coordinates: x and y in 0..1 of the board's width and height, y down.
- The board is 4:3 (`BOARD_ASPECT = 4 / 3`). One unit of y is 3/4 the on-screen length of one unit of x. Functions work in plain board units unless they take an `aspect` option.
- Client pixels only appear in `toBoard`, `fromBoard` and `fitRect`.

## Public API

`stroke.js`
- `BOARD_ASPECT`: 4/3.
- `distToSegment(p, a, b)`, `nearestOnSegment(p, a, b)` returns `[point, t]`.
- `simplify(points, tol)`: Ramer-Douglas-Peucker, iterative, keeps first and last points.
- `smooth(points, iterations = 1, closed = false)`: Chaikin. Open strokes keep endpoints; each pass doubles the points.
- `pathLength(points, closed)`.
- `signedArea(poly)` (positive for counter-clockwise in a y-up frame, which is clockwise on screen), `polygonArea(poly)`, `centroid(poly)` (vertex mean when the area is near zero), `bbox(points)` returns `{x, y, w, h}`.
- `pointInPolygon(pt, poly)`: even-odd ray casting.
- `nearestOnPolygon(pt, poly)` returns `{d, point, edge}`.
- `snapInside(pt, poly, {margin = 0.01})`: nearest point strictly inside, at least `margin` from the edge where the shape is thick enough. Points already that deep stay put. Used for eye stamping.
- `deepestPoint(poly, steps = 24)`: coarse grid search for the point farthest from the edge.
- `fitOutline(points, {maxW, maxH, cx, cy})`: uniform scale to fit the box, centred on `(cx, cy)` or its own centre.
- `translate(points, dx, dy)`.
- `toBoard(clientX, clientY, rect)`, `fromBoard(x, y, rect)`: rect is `{left, top, width, height}` of the drawn board.
- `fitRect(containerW, containerH, aspect, left, top)`: largest centred rect of that aspect. Letterboxed, never cropped.
- `closeGap(points, {maxGapRatio = 0.08})` returns `{closed, points, gap}`. Closes the loop when the ends (searched in the first and last 15% of the stroke) are within `maxGapRatio` of the loop length, trimming any overshoot. Otherwise returns `closed: false` with `gap: {a, b}` so the UI can show both ends. A back-and-forth scribble with no area is refused.

`union.js`
- `unionOutlines(polys, {aspect = 1, cells = 192, glue = 2, tol = 0.003, round = true})` returns one simple closed polygon in board units, or `[]` when nothing is valid.
  - Polygons with fewer than 3 points or zero area are ignored.
  - One valid polygon is returned as a plain copy (not rounded or simplified).
  - Several polygons are rasterised (even-odd) on a grid of `cells` across the larger side, in a frame where x is scaled by `aspect` so cells are square on screen. Then: morphological closing by `glue` cells; connected components, with specks dropped and separate blobs joined by a thick capsule bridge so the result is always one piece; holes and diagonal saddles filled; outer boundary traced, smoothed (Chaikin) and simplified (RDP, `tol` of the drawing size); rounded to 3 decimals when `round`.
  - Deterministic. About 3 to 4 ms for five shapes at 192 cells.
  - Callers on the board must pass `aspect: BOARD_ASPECT`. The default of 1 is only right for square frames.

`join.js`
- `JOIN_TOL = 0.04`: how far outside a shape (board units) a stroke end may stop and still count as inside.
- `shapeAt(pt, shapes, tol = JOIN_TOL)`: index of the smallest shape holding the point or within `tol` of its edge, or -1. Shapes with fewer than 3 points are skipped.
- `touches(points, shape, {tol = JOIN_TOL, closed = false})`: true when a point of `points` is inside `shape` or within `tol` of its edge, one of its segments crosses an edge of `shape`, or (`closed`) `points` holds the shape. A bounding box test rejects far shapes first. `touchedShapes(points, shapes, opts)` lists the indexes touched (null entries skipped).
- `joinOpenStroke(points, shapes, {tol})` returns `{points, from, to}` or `null`. An open stroke that touches any shape (playtest 3: not only one that starts and ends inside) is closed by the straight segment back to its start; that polygon, unioned with the shapes, adds an ear, a horn or a head drawn over the body, or bridges two shapes. `from` and `to` are the shapes the ends lie in (`shapeAt`), -1 for an end outside every shape. A stroke with almost no area (closed area under 2% of its length squared, such as a straight neck or horn) is returned as a band instead (`thickenStroke`, half-width 6% of its length, at least 0.012). `null` when the stroke touches no shape, has fewer than 2 points, or there are no shapes.
- `thickenStroke(points, w)`: a closed band of half-width `w` around a polyline (left side out, right side back; normals averaged at each point). `[]` when it has no length.
`transform.js`
- `translationBetween(a, b, eps = 0.0015)`: `[dx, dy]` when `b` is `a` moved by one offset (within `eps`, which absorbs the store's 3-decimal rounding), else `null`. The renderer uses it to keep a moved drawing's felt sprite.
- `clampDelta(box, dx, dy)`: the move limited so a `{x, y, w, h}` box stays on the board.
- `translatePoints(points, dx, dy)`, `scaleAbout(points, s, cx, cy)`.
- `clampScale(box, s, cx, cy)`: the nearest scale that keeps the box on the board with its smaller side at least `MIN_SIDE = 0.02` (a piece already smaller never shrinks further).
- `movedThingPatch(thing, dx, dy)`: `{outline, eyes, legs?}` all moved together, limited to the board. Used by the board's edit-mode drag for `store.updateThing`.
- Resizing a thing (the edit-mode resize handle): `THING_BOX = {w: 0.24, h: 0.32}` (a new thing fills it one way), `thingSize(outline)` (the larger of width / 0.24 and height / 0.32; 0 for an empty outline), `footPoint(outline)` (bottom centre of the box: the pivot, so the feet stay put), `clampThingScale(thing, s)` (the nearest scale keeping the size between `THING_SCALE_MIN = 0.4` and `THING_SCALE_MAX = 1.8` and the box on the board; a thing already outside the limits is never forced to change; 1 for a bad `s`), and `scaledThingPatch(thing, s)`: `{outline, eyes, legs?}` scaled by the clamped `s` about the foot point, other eye and leg fields kept.

`hit.js`
- `hitTest(targets, pt, {scale = 1.3, minRadius = 0, aspect = BOARD_ASPECT})` returns a target id or `null`.
  - `targets` are `{id, poly, x, y}` in drawing order (back to front): `poly` is the outline where the thing is now, `(x, y)` its anchor.
  - A point on a drawing hits the topmost drawing (last in the list).
  - Otherwise, among targets whose hit area holds the point, the nearest centre wins. The hit area is the drawing scaled `scale` times about its centre, plus a circle of `minRadius` around the centre.
  - `minRadius` is in board-width units (CSS px divided by the board's CSS width). Distances are measured on screen, so y is scaled by `1 / aspect`.

## How it fits

- `geometry/` is a pure domain. It imports only other pure domains and `types.js` (today it imports nothing but itself). No DOM, browser globals, time, randomness, timers or `fetch`. `tests/unit/boundaries.test.js` enforces this.
- Callers:
  - `components/kf-guided-add/drawing.js` (`ShapeDrawing`): merges the shapes with `unionOutlines(shapes, {aspect: BOARD_ASPECT})` (the host then uses `fitOutline` to thing size), joins open strokes with `joinOpenStroke`, refuses a closed shape that `touchedShapes` finds touching nothing, hit tests shapes with `shapeAt`, and uses `bbox` for moving and resizing a shape.
  - `components/kf-guided-add/shape-editor.js`: `toBoard`, `fromBoard`, `fitRect`, `bbox`, `BOARD_ASPECT`.
  - `components/kf-draw-pad/KfDrawPadElement.js`: `simplify`, `smooth`, `closeGap`, `pathLength`, `toBoard`, `fromBoard`, `fitRect`.
  - `components/kf-board/KfBoardElement.js`: `toBoard`, `fromBoard` for tap and drag coordinates.
  - `io/renderer.js`, `io/felt.js`: `bbox`, `centroid`, `signedArea` for painting.
  - Other `kf-guided-add` modules (`shape.js`, `geometry.js`): `fitOutline`, `bbox`, `pointInPolygon` and a lazy import of `stroke.js`.
  - `tools/make-starter.mjs`: `simplify`, `smooth`, `snapInside`, `pointInPolygon`, `signedArea` (it has its own shape tracer, not `unionOutlines`).
- `farm/legs.js` has its own small bbox and crossing helpers rather than importing geometry.

## Rules and gotchas

- Keep functions pure and allocation-light. Nothing here may read the clock or random numbers; `union.js` is deterministic on purpose so the same shapes always give the same outline.
- A `Thing` has exactly one outline. Multi-shape drawing must go through `unionOutlines`, so nothing downstream changes.
- Outlines that reach storage are rounded to 3 decimals by the farm intents (`roundPoints`). Do not depend on more precision.
- `signedArea` sign depends on winding; use `polygonArea` when only the size matters. `snapInside` handles both windings.
- `geometry/hit.js` is not used by the app at runtime. `play-engine.js` imports `play/hit.js`, a private copy with the same contract (its header says to reconcile at integration). Change both together, or retire one.
- Up to 6 shapes are allowed in guided add (enforced in the component, not here).
- `unionOutlines` costs a few ms: callers run it when a change is committed, never per pointer move (see `ShapeDrawing.mergedWithout` for drag previews).

## Tests

- `web/js/geometry/stroke.test.js`: `simplify`, `smooth`, `pathLength`, `closeGap` (including property tests on random gaps, overshoot, scribbles), area and centroid, `pointInPolygon` on concave shapes, `snapInside` properties, `fitOutline`, `toBoard`/`fromBoard`, `fitRect` letterboxing.
- `web/js/geometry/union.test.js`: single shape passthrough, overlap area, touching and disjoint shapes become one piece, nested shapes, filled rings, self-intersecting scribbles, aspect, determinism, validity in a snapshot, speed, and a property test on random wobbly shapes.
- `web/js/geometry/join.test.js`: `shapeAt` (tolerance, smallest wins, degenerate shapes), an ear drawn from inside the body joins it, a neck between two shapes is thickened and joins them, a horn starting outside and a stroke crossing the body join it, a stroke touching nothing is refused, `touches` (inside, near, crossing, holding, apart), a stroke inside the body changes nothing, `thickenStroke`.
- `web/js/geometry/transform.test.js`: moves within rounding, reshapes refused, clamping to the board, scale limits, thing patches; resizing a thing about its feet with eyes and legs, its min and max size and the board edges.
- `web/js/geometry/hit.test.js`: inside hits, misses, the 1.3 times area, `minRadius` with aspect, topmost wins, nearest centre in overlapping margins, and a property test.
- `tests/browser/shapes.test.js`: two shapes drawn with the pad save as one outline and reload; redraw on the thing card glues a shape on; a stroke drawn over the body joins it wherever it starts and ends; a shape drawn apart warns.
