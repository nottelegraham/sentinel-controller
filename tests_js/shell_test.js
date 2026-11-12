const { JSDOM } = require("jsdom"); const fs = require("fs");
const fx = JSON.parse(fs.readFileSync("/tmp/jsd/fixture.json"));
const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window; const errs = [];
w.addEventListener("error", (e) => errs.push(e.message));
const card = fs.readFileSync(process.argv[2] + "/sentinel-controller-card.js", "utf8");
let loader = fs.readFileSync(process.argv[2] + "/sentinel-controller-loader.js", "utf8");
// jsdom has no dynamic import(): stand in with a slow eval of the card file
loader = loader.replace(/await import\(`[^`]+`\);/, "await new Promise((r) => setTimeout(r, 300)); window.eval(window.__CARD__);");
w.__CARD__ = card;
w.fetch = async () => ({ ok: true, json: async () => ({ version: "0.2.6-test" }) });
w.eval(loader);
const hass = { states: {}, services: {}, callWS: async (m) => (m.type === "sentinel_controller/get" ? fx : []), connection: { subscribeMessage: async () => () => {} } };
(async () => {
  if (!w.customElements.get("sentinel-controller-card")) errs.push("card not registered synchronously by loader");
  const el = w.document.createElement("sentinel-controller-card"); el.setConfig({}); w.document.body.appendChild(el); el.hass = hass;
  if (!el.textContent.includes("Loading")) errs.push("no loading placeholder");
  await new Promise((r) => setTimeout(r, 600));
  const impl = el.querySelector("sentinel-controller-card-impl");
  if (!impl) errs.push("impl not mounted"); else if (!impl.shadowRoot.querySelector(".tabs")) errs.push("impl did not render tabs");
  el.hass = { ...hass }; // later hass updates pass through
  if (impl && impl._hass !== el._h) errs.push("hass not forwarded");
  console.log(errs.length ? "ERRORS: " + errs.join(" | ") : "SHELL OK");
  process.exit(errs.length ? 1 : 0);
})();
