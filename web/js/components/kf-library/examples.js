// The animal library's pre-made examples: web/data/library.json (made by tools/make-starter.mjs),
// fetched once per page (the service worker serves it offline) and shared by <kf-library> and the
// new-scene seeding in <kf-scenes>.
// Contract: loadExamples(services) resolves to an array of Things and never rejects. A test or a
// host can hand them in as `services.examples`; a failed fetch resolves [] and is tried again next time.

let loading = null;

/** @returns {Promise<import('../../types.js').Thing[]>} */
export function loadExamples(services) {
  if (Array.isArray(services?.examples)) return Promise.resolve(services.examples);
  loading ??= fetch("data/library.json")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`library.json: HTTP ${res.status}`))))
    .then((data) => (Array.isArray(data?.examples) ? data.examples : []))
    .catch((e) => {
      console.warn("kf-library: examples not loaded", e);
      loading = null;
      return [];
    });
  return loading;
}
