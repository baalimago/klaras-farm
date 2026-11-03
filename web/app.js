// Proof of concept: tap the pig, it jumps, chimes and says its name.
// Nothing runs between taps: the jump is a CSS animation, so an idle board costs nothing.

let audio = null;

function chime() {
  audio ??= new AudioContext();
  if (audio.state === "suspended") audio.resume();
  const now = audio.currentTime;
  for (const [i, freq] of [523.25, 783.99].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.09);
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.09 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.5);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.09);
    osc.stop(now + i * 0.09 + 0.55);
  }
}

// Placeholder until the parent's own recording exists (M1).
function sayName(name) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(name);
  u.rate = 0.8;
  u.pitch = 1.3;
  speechSynthesis.speak(u);
}

function tap(thing) {
  thing.classList.remove("jump");
  void thing.getBoundingClientRect(); // restart the animation on rapid taps
  thing.classList.add("jump");
  chime();
  setTimeout(() => sayName(thing.dataset.name), 250);
}

for (const thing of document.querySelectorAll(".thing")) {
  thing.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    tap(thing);
  });
  thing.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") tap(thing);
  });
  thing.addEventListener("animationend", () => thing.classList.remove("jump"));
}
