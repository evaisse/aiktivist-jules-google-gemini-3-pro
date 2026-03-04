import { logEvent } from "./src/logger"; logEvent({ type: "system", payload: { msg: "Hello" } }).then(() => console.log("Done"));
