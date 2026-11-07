// The watercolour pictures on the welcome card: bunting, a meadow with a fluffy sheep and a
// pink pig, mushrooms, acorns and the autumn leaves that drift down onto the grass.
// Promise: every function returns fresh, static, aria-hidden SVG built with createElementNS
// (no innerHTML). The only motion is CSS on the card, the leaves and the sheep's and pig's
// hops (kf-welcome.css), and every animation has
// a finite iteration count, so the card goes back to 0 fps once the leaves have landed.

const NS = "http://www.w3.org/2000/svg";

/** s('circle', {cx: 1}, [children]): an SVG element with attributes. */
export function s(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

function picture(viewBox, className, children) {
  return s("svg", { viewBox, class: className, "aria-hidden": "true", focusable: "false" }, children);
}

// The card's colours, taken from the watercolour card.
export const PAINT = {
  string: "#8a6a55",
  flags: ["#9db58a", "#a0705a", "#dd8d95", "#ec9a62", "#f0c86e", "#a87a5c", "#e5b25c", "#c99b98", "#e48993", "#f2cf73", "#9db58a"],
  wool: "#f6f1e8", woolLine: "#ab927d", face: "#faf6f0", faceLine: "#9d948d", ear: "#c2b8b0", hoof: "#6f6865",
  pig: "#f4c7cd", pigLine: "#d27c8f", snout: "#efabb8",
  blush: "#f0a9a9", eye: "#3b2a22",
  hill: "#f0e1a2", hillShade: "#e5cf83", tuft: "#d1a95e",
  capBrown: "#b38a6d", capPink: "#e38f98", stem: "#f3e7d6", stemLine: "#b39a84",
  acorn: "#a8754e", acornCap: "#6e4a33",
  dots: ["#9db58a", "#f0c86e", "#ec9a62", "#e48993", "#c99b98"],
};

const LEAF_SHAPES = {
  // A round leaf with a midrib (the birch leaf on the card).
  round: "M0 -12 C9 -8 10 4 0 12 C-10 4 -9 -8 0 -12 Z",
  // A long, thin leaf.
  long: "M0 -13 C6 -6 6 6 0 13 C-6 6 -6 -6 0 -13 Z",
  // A maple-ish leaf with five soft points.
  maple: "M0 -13 L3 -6 L10 -8 L7 -1 L12 2 L5 4 L6 11 L0 7 L-6 11 L-5 4 L-12 2 L-7 -1 L-10 -8 L-3 -6 Z",
};

/** One leaf, centred on 0,0 in a 32x32 box. */
export function leaf(shape, fill) {
  const line = "rgb(110 70 45 / 0.55)";
  return picture("-16 -16 32 32", "kf-welcome-leaf-art", [
    s("path", { d: LEAF_SHAPES[shape] ?? LEAF_SHAPES.round, fill, stroke: line, "stroke-width": 1, "stroke-linejoin": "round" }),
    s("path", { d: "M0 -11 L0 14", stroke: line, "stroke-width": 1, "stroke-linecap": "round" }),
  ]);
}

export function acorn(x, y, scale = 1, tilt = 0) {
  return s("g", { transform: `translate(${x} ${y}) rotate(${tilt}) scale(${scale})` }, [
    s("ellipse", { cx: 0, cy: 3, rx: 6.5, ry: 8, fill: PAINT.acorn, stroke: PAINT.acornCap, "stroke-width": 1 }),
    s("path", { d: "M-8 -1 C-8 -9 8 -9 8 -1 Z", fill: PAINT.acornCap }),
    s("path", { d: "M0 -7 C1 -10 3 -12 5 -12", stroke: PAINT.acornCap, "stroke-width": 1.6, fill: "none", "stroke-linecap": "round" }),
    s("ellipse", { cx: -2.5, cy: 3, rx: 1.5, ry: 3, fill: "#fff", opacity: 0.25 }),
  ]);
}

function mushroom(x, y, size, cap) {
  const w = size, hgt = size * 0.95;
  return s("g", { transform: `translate(${x} ${y})` }, [
    s("path", { d: `M${-w * 0.16} 0 C${-w * 0.2} ${-hgt * 0.4} ${-w * 0.12} ${-hgt * 0.7} ${-w * 0.1} ${-hgt * 0.75} L${w * 0.1} ${-hgt * 0.75} C${w * 0.12} ${-hgt * 0.7} ${w * 0.2} ${-hgt * 0.4} ${w * 0.16} 0 Z`, fill: PAINT.stem, stroke: PAINT.stemLine, "stroke-width": 1 }),
    s("path", { d: `M${-w / 2} ${-hgt * 0.68} C${-w / 2} ${-hgt * 1.25} ${w / 2} ${-hgt * 1.25} ${w / 2} ${-hgt * 0.68} C${w * 0.2} ${-hgt * 0.78} ${-w * 0.2} ${-hgt * 0.78} ${-w / 2} ${-hgt * 0.68} Z`, fill: cap, stroke: "rgb(110 70 45 / 0.5)", "stroke-width": 1 }),
    s("ellipse", { cx: -w * 0.16, cy: -hgt * 0.98, rx: w * 0.09, ry: w * 0.05, fill: "#fff", opacity: 0.45 }),
  ]);
}

function tuft(x, y, h = 14) {
  return s("path", {
    d: `M${x} ${y} q-3 ${-h * 0.7} -9 ${-h} M${x + 2} ${y} q0 ${-h * 0.8} 2 ${-h * 1.2} M${x + 4} ${y} q4 ${-h * 0.6} 10 ${-h * 0.9}`,
    stroke: PAINT.tuft, "stroke-width": 2, fill: "none", "stroke-linecap": "round", opacity: 0.8,
  });
}

/** Two strings of watercolour flags hanging from the top corners, plus acorns and paint dots. */
export function bunting() {
  const flags = [];
  const garland = (from, to, sag, colours) => {
    const [x1, y1] = from, [x2, y2] = to;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + sag;
    flags.push(s("path", { d: `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`, stroke: PAINT.string, "stroke-width": 1.6, fill: "none" }));
    const n = colours.length;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.15) / n, t1 = (i + 0.85) / n;
      const at = (t) => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t * t * y2];
      const [ax, ay] = at(t0), [bx, by] = at(t1);
      const cx = (ax + bx) / 2, cy = (ay + by) / 2 + 26;
      flags.push(s("path", { d: `M${ax} ${ay} L${bx} ${by} L${cx} ${cy} Z`, fill: colours[i], stroke: "rgb(110 70 45 / 0.35)", "stroke-width": 1, "stroke-linejoin": "round", opacity: 0.92 }));
    }
  };
  garland([-6, 54], [250, -4], 34, PAINT.flags.slice(0, 6));
  garland([310, -4], [566, 54], 34, PAINT.flags.slice(5));
  const dots = [[70, 128], [492, 120], [110, 176], [452, 170], [40, 210], [520, 214], [150, 150], [410, 146]].map(([cx, cy], i) =>
    s("circle", { cx, cy, r: 2.6, fill: PAINT.dots[i % PAINT.dots.length], opacity: 0.8 }));
  return picture("0 0 560 230", "kf-welcome-bunting", [...flags, ...dots, acorn(46, 92, 1, -12), acorn(512, 92, 1, 14)]);
}

function sheep() {
  const puffs = [[92, 104, 20], [108, 86, 20], [132, 80, 21], [156, 86, 20], [168, 104, 19], [152, 122, 20], [126, 126, 21], [100, 122, 19], [130, 104, 26]];
  const legs = [104, 118, 146, 160].map((x) => s("rect", { x, y: 120, width: 8, height: 36, rx: 4, fill: PAINT.hoof }));
  return s("g", { class: "kf-welcome-sheep" }, [
    ...legs,
    // Outline first, then the same puffs filled on top: only the fluffy outer edge stays drawn.
    s("g", { fill: PAINT.wool, stroke: PAINT.woolLine, "stroke-width": 3 }, puffs.map(([cx, cy, r]) => s("circle", { cx, cy, r }))),
    s("g", { fill: PAINT.wool }, puffs.map(([cx, cy, r]) => s("circle", { cx, cy, r }))),
    s("path", { d: "M104 98 q6 -6 12 0 M128 92 q6 -6 12 0 M140 112 q6 -6 12 0 M112 114 q6 -6 12 0", stroke: "rgb(171 146 125 / 0.6)", "stroke-width": 1.5, fill: "none", "stroke-linecap": "round" }),
    // Head, turned towards the pig.
    s("ellipse", { cx: 170, cy: 72, rx: 8, ry: 5, fill: PAINT.ear, transform: "rotate(-25 170 72)" }),
    s("ellipse", { cx: 212, cy: 70, rx: 8, ry: 5, fill: PAINT.ear, transform: "rotate(20 212 70)" }),
    s("ellipse", { cx: 192, cy: 84, rx: 17, ry: 21, fill: PAINT.face, stroke: PAINT.faceLine, "stroke-width": 1.5 }),
    s("circle", { cx: 184, cy: 64, r: 9, fill: PAINT.wool, stroke: PAINT.woolLine, "stroke-width": 1.5 }),
    s("circle", { cx: 198, cy: 62, r: 9, fill: PAINT.wool, stroke: PAINT.woolLine, "stroke-width": 1.5 }),
    s("circle", { cx: 191, cy: 67, r: 8, fill: PAINT.wool }),
    s("circle", { cx: 186, cy: 84, r: 2.3, fill: PAINT.eye }),
    s("circle", { cx: 199, cy: 84, r: 2.3, fill: PAINT.eye }),
    s("circle", { cx: 181, cy: 93, r: 4, fill: PAINT.blush, opacity: 0.6 }),
    s("circle", { cx: 204, cy: 93, r: 4, fill: PAINT.blush, opacity: 0.6 }),
    s("path", { d: "M189 96 q3 3 6 0", stroke: PAINT.faceLine, "stroke-width": 1.4, fill: "none", "stroke-linecap": "round" }),
  ]);
}

function pig() {
  const legs = [394, 408, 448, 462].map((x) => s("rect", { x, y: 116, width: 10, height: 40, rx: 4, fill: PAINT.pig, stroke: PAINT.pigLine, "stroke-width": 1.5 }));
  return s("g", { class: "kf-welcome-pig" }, [
    ...legs,
    s("path", { d: "M486 96 c10 -2 12 -12 5 -14 c-6 -1 -7 7 0 8 c7 1 12 -4 13 -10", stroke: PAINT.pigLine, "stroke-width": 2, fill: "none", "stroke-linecap": "round" }),
    s("g", { fill: PAINT.pig, stroke: PAINT.pigLine, "stroke-width": 2.5 }, [
      s("ellipse", { cx: 436, cy: 102, rx: 52, ry: 32 }),
      s("circle", { cx: 386, cy: 92, r: 25 }),
    ]),
    s("g", { fill: PAINT.pig }, [s("ellipse", { cx: 436, cy: 102, rx: 52, ry: 32 }), s("circle", { cx: 386, cy: 92, r: 25 })]),
    s("path", { d: "M378 70 L382 52 L394 68 Z", fill: PAINT.snout, stroke: PAINT.pigLine, "stroke-width": 1.6, "stroke-linejoin": "round" }),
    s("path", { d: "M396 72 L404 56 L410 74 Z", fill: PAINT.snout, stroke: PAINT.pigLine, "stroke-width": 1.6, "stroke-linejoin": "round" }),
    s("ellipse", { cx: 363, cy: 98, rx: 9, ry: 11, fill: PAINT.snout, stroke: PAINT.pigLine, "stroke-width": 1.6 }),
    s("ellipse", { cx: 360, cy: 95, rx: 1.6, ry: 2.6, fill: PAINT.pigLine }),
    s("ellipse", { cx: 366, cy: 101, rx: 1.6, ry: 2.6, fill: PAINT.pigLine }),
    s("circle", { cx: 380, cy: 86, r: 2.4, fill: PAINT.eye }),
    s("circle", { cx: 392, cy: 100, r: 4.5, fill: PAINT.blush, opacity: 0.7 }),
    s("path", { d: "M432 82 q10 -8 22 -2", stroke: "#fff", "stroke-width": 3, fill: "none", "stroke-linecap": "round", opacity: 0.45 }),
  ]);
}

/** The grassy hill with the sheep and the pig face to face, mushrooms and an acorn. */
export function meadow() {
  return picture("0 0 560 190", "kf-welcome-meadow", [
    s("path", { d: "M0 150 C120 128 220 134 300 140 C400 146 480 128 560 136 L560 190 L0 190 Z", fill: PAINT.hill, opacity: 0.95 }),
    s("path", { d: "M0 172 C140 160 260 170 360 166 C450 162 520 168 560 164 L560 190 L0 190 Z", fill: PAINT.hillShade, opacity: 0.55 }),
    tuft(60, 152), tuft(220, 146, 12), tuft(250, 150), tuft(330, 152, 12), tuft(500, 146), tuft(30, 176, 10), tuft(540, 174, 10),
    mushroom(26, 160, 26, PAINT.capBrown),
    mushroom(226, 152, 20, PAINT.capPink),
    mushroom(242, 158, 13, PAINT.capPink),
    mushroom(340, 154, 17, PAINT.capBrown),
    sheep(),
    pig(),
    acorn(530, 168, 0.9, 20),
  ]);
}
