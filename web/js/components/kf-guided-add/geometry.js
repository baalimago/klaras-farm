// Geometry for F1: package A's geometry/stroke.js when it is there, else the private fallback in shape.js.
// Integration: once geometry/stroke.js lands, this loader picks it up with no change; shape.js can then go.
import * as local from "./shape.js";

let loading = null;

export function loadGeometry() {
  loading ??= import("../../geometry/stroke.js")
    .then((m) => {
      const geo = { ...local };
      for (const k of ["bbox", "centroid", "pointInPolygon", "snapInside", "fitOutline", "polygonArea"]) if (typeof m[k] === "function") geo[k] = m[k];
      return geo;
    })
    .catch(() => ({ ...local }));
  return loading;
}

/** snapInside returning a Point whatever shape the implementation returns. */
export function snapPoint(geo, pt, poly) {
  const r = geo.snapInside(pt, poly);
  return Array.isArray(r) ? [r[0], r[1]] : [r.x, r.y];
}
