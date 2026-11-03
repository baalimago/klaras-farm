import { KfRecorderElement } from "./KfRecorderElement.js";

if (!customElements.get("kf-recorder")) customElements.define("kf-recorder", KfRecorderElement);

export { KfRecorderElement };
