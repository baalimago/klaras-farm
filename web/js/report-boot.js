// Loaded as its own module before main.js, so even a module that fails to load or parse on the
// device is reported (io/report.js).
import { installErrorReporting } from "./io/report.js";
installErrorReporting();
