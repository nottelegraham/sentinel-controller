// Outlet sources on installations that look nothing like the author's: how the card sorts devices
// into reef controllers, power strips / plugs and other devices, and which switches count as outlets.
// Run: node tests_js/sources_test.js custom_components/sentinel_controller/www/sentinel-controller-card.js
const { JSDOM } = require("jsdom"); const fs = require("fs");
const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window; w.eval(fs.readFileSync(process.argv[2], "utf8"));
const Card = w.customElements.get("sentinel-controller-card-impl") || w.customElements.get("sentinel-controller-card");
const errs = [];

// device: [id, name, model, manufacturer, [[entity_id, platform, attrs, category]]]
const DEVICES = [
  // Neptune Apex through Apex Fusion (Local): outlets are selects with Off / Auto / On
  ["apex1", "Reef Tank", "AC6J", "Neptune Systems", [
    ["select.reef_tank_return", "apex_fusion", { options: ["Off", "Auto", "On"] }], ["select.reef_tank_heater", "apex_fusion", { options: ["Off", "Auto", "On"] }],
    ["switch.reef_tank_feed_a", "apex_fusion", {}]]],
  // Apex through the neptuneapex-hass-mqtt bridge: only the name says what it is
  ["apex2", "Apex Classic", "", "", [["switch.apex_classic_skimmer", "mqtt", {}], ["switch.apex_classic_ato", "mqtt", {}]]],
  // itchannel apex-ha
  ["apex3", "Fish Room", "", "", [["switch.fish_room_lights", "apex", {}]]],
  // reef-pi
  ["rp", "My Reef Pi", "reef-pi", "", [["switch.my_reef_pi_heater", "reef_pi", {}]]],
  // Zigbee plug with the outlet device class
  ["zb", "Skimmer", "TS011F", "_TZ3000", [["switch.skimmer", "zha", { device_class: "outlet" }], ["select.skimmer_power_on_state", "zha", { options: ["Off", "On", "Previous"] }]]],
  // Matter plug, German name, no device class
  ["mt", "Steckdose Abschäumer", "Eve Energy", "Eve", [["switch.steckdose_abschaumer", "matter", {}]]],
  // Tuya strip with a power-on-behaviour select that also has Off / On / Auto-like options
  ["tu", "Sump Strip", "Smart Power Strip", "Tuya", [["switch.sump_strip_socket_1", "tuya", {}], ["switch.sump_strip_socket_2", "tuya", {}],
    ["select.sump_strip_power_on_behavior", "tuya", { options: ["off", "on", "auto"] }]]],
  // Things that have switches but are not outlets
  ["car", "Dash", "Model 3", "Tesla", [["switch.dash_sentry_mode", "tesla_fleet", {}], ["switch.dash_charge", "tesla_fleet", {}]]],
  ["eco", "IM100", "RIVER_2_PRO", "EcoFlow", [["switch.im100_ac_enabled", "ecoflow_cloud", {}]]],
  ["wall", "Basement light", "LightSwitch", "Belkin", [["switch.basement_light", "wemo", {}]]],
  ["relay", "Garage relay board", "ESP32 4ch", "Espressif", [["switch.garage_relay_1", "esphome", {}]]],
  ["pump", "DMP-20", "", "", [["switch.dmp_20_feeding", "jebao_aqua", {}]]],
  // The author's own gear, as it reports itself
  ["ghl", "Main Reef GHL IM100", "ProfiLux Mini WiFi", "GHL", [["binary_sensor.main_reef_ghl_im100_outlet_1", "mqtt", {}]]],
  ["hyd", "HYDROS Control X2", "HYDROS Control X2", "CoralVue", [["switch.hydros_control_x2_100l_heat", "mqtt", {}]]],
  ["def", "Hydros Defector 01", "Smart Power Strip", "Tuya", [["switch.hydros_defector_01_defector01_1", "tuya", {}]]],
];
const EXPECT = { apex1: "controller", apex2: "controller", apex3: "controller", rp: "controller", zb: "strip", mt: "strip", tu: "strip",
  car: "other", eco: "other", wall: "other", relay: "other", pump: "other", ghl: "controller", hyd: "controller", def: "strip" };

function card(cfg = {}) {
  const c = new Card(); const states = {}; c.reg = {}; c.devs = {}; c.devInfo = {}; c.devEnts = {};
  for (const [id, name, model, mfr, ents] of DEVICES) {
    c.devs[id] = name; c.devInfo[id] = { model, mfr }; c.devEnts[id] = [];
    for (const [e, platform, attrs, category] of ents) {
      states[e] = { state: e.startsWith("select.") ? "Auto" : "off", attributes: { friendly_name: `${name} ${e.split(".")[1]}`, ...attrs } };
      c.reg[e] = { device: name, device_id: id, platform, category: category || "" }; c.devEnts[id].push(e);
    }
  }
  c._hass = { states }; c.cfg = { controllers: [], source_kinds: {}, ...cfg }; c.forms = {};
  return c;
}

const c = card();
for (const [id, want] of Object.entries(EXPECT)) { const got = c.srcKind(id); if (got !== want) errs.push(`${id} (${c.devs[id]}): ${got}, expected ${want}`); }
const ap = c.ctrlOutletEnts("apex1");
if (!ap.includes("select.reef_tank_return")) errs.push("Apex Fusion select outlet not counted");
if (c.ctrlOutletEnts("zb").some((e) => e.startsWith("select."))) errs.push("Zigbee power-on select counted as an outlet");
if (c.ctrlOutletEnts("tu").some((e) => e.startsWith("select."))) errs.push("Tuya power-on behaviour select counted as an outlet");
// first run with nothing saved: only reef controllers are pre-selected
const auto = c.controllers().map((x) => x.device_id).sort().join(",");
if (auto !== "apex1,apex2,apex3,ghl,hyd,rp") errs.push("auto-selected sources wrong: " + auto);
// the user's fix wins over the guess
const f = card({ source_kinds: { relay: "strip", def: "controller" } });
if (f.srcKind("relay") !== "strip" || f.srcKind("def") !== "controller") errs.push("source_kinds override ignored");
// a saved outlet list limits what is shown; no list = all outlets
if (c.ctrlShown({ device_id: "tu" }).length !== 2) errs.push("all outlets not shown without a list");
if (c.ctrlShown({ device_id: "tu", outlets: ["switch.sump_strip_socket_2"] }).join() !== "switch.sump_strip_socket_2") errs.push("outlet list not applied");

console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "SOURCES OK");
process.exit(errs.length ? 1 : 0);
