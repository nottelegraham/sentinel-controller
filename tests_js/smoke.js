// Headless test of the Sentinel Controller card: every tab, every editor, save payloads, validation.
const { JSDOM } = require("jsdom"); const fs = require("fs");
const fx = JSON.parse(fs.readFileSync(process.argv[3] || "/tmp/jsd/fixture.json"));
const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window; const errs = []; const toasts = [];
w.confirm = () => true; w.addEventListener("error", (e) => errs.push("window error: " + e.message));
w.eval(fs.readFileSync(process.argv[2], "utf8"));
const calls = [];
const states = { "switch.kp303_1": { state: "off", attributes: { friendly_name: "KP303 Socket 1" } }, "switch.heater": { state: "on", attributes: { friendly_name: "Heater" } },
  "sensor.t": { state: "77", attributes: { friendly_name: "Tank temp", unit_of_measurement: "°F" } }, "sensor.ph": { state: "8.6", attributes: { friendly_name: "pH" } },
  "binary_sensor.float": { state: "on", attributes: { friendly_name: "Sump float" } },
  "binary_sensor.main_reef_ghl_im100_outlet_1": { state: "off", attributes: { friendly_name: "Main Reef GHL IM100 Outlet 1" } },
  "binary_sensor.main_reef_ghl_im100_outlet_2": { state: "on", attributes: { friendly_name: "Main Reef GHL IM100 Outlet 2" } },
  "switch.hydros_control_x2_100l_heat": { state: "off", attributes: { friendly_name: "100L heat" } },
  "sensor.ghl_doser_calcium_volume": { state: "54", attributes: { friendly_name: "GHL Doser Calcium volume", unit_of_measurement: "%" } },
  "sensor.ghl_doser_calcium_state": { state: "Normal", attributes: { friendly_name: "GHL Doser Calcium state" } },
  "sensor.ghl_doser_pump_1_calcium_volume_ml": { state: "36.28", attributes: { friendly_name: "GHL Doser Pump 1 Calcium volume ml", unit_of_measurement: "fl. oz." } },
  "sensor.ghl_doser_naoh_volume": { state: "12", attributes: { friendly_name: "GHL Doser NaOH volume", unit_of_measurement: "%" } },
  "sensor.ghl_doser_pump_2_naoh_volume_ml": { state: "23.7", attributes: { unit_of_measurement: "fl. oz." } },
  "sensor.ghl_doser_connection": { state: "Connected", attributes: {} },
  "binary_sensor.ghl_doser_dosing_paused": { state: "off", attributes: {} },
  "binary_sensor.doser_pump_1_dosing": { state: "on", attributes: {} },
  "switch.hydros_control_x2_child_lock": { state: "off", attributes: { friendly_name: "Child lock" } },
  "switch.dash_sentry_mode": { state: "off", attributes: { friendly_name: "Dash Sentry mode" } },
  "switch.hydros_control_x2_usb_light": { state: "on", attributes: { friendly_name: "USB light" } } };
const hass = { states, services: { notify: { pushover: {} } },
  callWS: async (m) => { calls.push(m);
    if (m.type === "sentinel_controller/get") return fx;
    if (m.type === "config/entity_registry/list") return [{ entity_id: "switch.kp303_1", device_id: "d1", platform: "tplink" }, { entity_id: "sensor.t", device_id: "d2", platform: "mqtt" },
      { entity_id: "binary_sensor.main_reef_ghl_im100_outlet_1", device_id: "d2", platform: "mqtt" }, { entity_id: "binary_sensor.main_reef_ghl_im100_outlet_2", device_id: "d2", platform: "mqtt" },
      { entity_id: "switch.hydros_control_x2_100l_heat", device_id: "d3", platform: "mqtt" }, { entity_id: "switch.hydros_control_x2_usb_light", device_id: "d3", platform: "mqtt" },
      { entity_id: "switch.dash_sentry_mode", device_id: "d5", platform: "tesla_fleet" }, { entity_id: "switch.hydros_control_x2_child_lock", device_id: "d3", platform: "mqtt", entity_category: "config" },
      ...["sensor.ghl_doser_calcium_volume", "sensor.ghl_doser_calcium_state", "sensor.ghl_doser_pump_1_calcium_volume_ml", "sensor.ghl_doser_naoh_volume", "sensor.ghl_doser_pump_2_naoh_volume_ml", "sensor.ghl_doser_connection", "binary_sensor.ghl_doser_dosing_paused"].map((e) => ({ entity_id: e, device_id: "d4", platform: "mqtt" }))];
    if (m.type === "config/device_registry/list") return [{ id: "d1", name: "Kasa KP303" }, { id: "d2", name: "Main Reef GHL IM100" }, { id: "d3", name: "HYDROS Control X2" }, { id: "d4", name: "GHL Doser" }, { id: "d5", name: "Dash", model: "Model 3", manufacturer: "Tesla" }];
    if (m.type === "sentinel_controller/preview") return { out: true, reason: "temperature" };
    if (m.type === "sentinel_controller/save") { fx.config[m.section] = m.value; return { config: fx.config, status: fx.status }; }
    return { config: fx.config, status: fx.status }; },
  connection: { subscribeMessage: async (cb) => { setTimeout(() => cb({ status: fx.status }), 5); return () => {}; } } };
const sleep = (t = 10) => new Promise((r) => setTimeout(r, t));
(async () => {
  const el = w.document.createElement("sentinel-controller-card"); el.setConfig({}); w.document.body.appendChild(el); el.hass = hass;
  await sleep(60); const sr = el.shadowRoot; const q = (s) => sr.querySelector(s);
  const origToast = el._toast.bind(el); el._toast = (t, bad) => { toasts.push((bad ? "BAD " : "") + t); origToast(t, bad); };
  const tabs = ["overview", "outlets", "probes", "schedules", "modes", "water", "logic", "alerts", "setup"];
  for (const t of tabs) { try { q(`[data-tab="${t}"]`).click(); await sleep(); if (q(".page").textContent.trim().length < 20) errs.push("empty tab " + t); } catch (e) { errs.push(t + ": " + e.message); } }
  // open every editor kind
  const kinds = [["channel", 1], ["channel", 2], ["probe", "p1"], ["probe", "new"], ["timer", 1], ["timer", 3], ["light", 1], ["fp", 1], ["mt", 1], ["circuit", 1], ["circuit", 3], ["lsensor", 1], ["lsensor", 2], ["gate", 1], ["reminder", 1], ["reminder", 2]];
  for (const [k, n] of kinds) { try { el._openDrawer(k, n); await sleep(); if (!q(".drawer .dbody") || q(".drawer .dbody").textContent.length < 20) errs.push("empty drawer " + k + n); el.drawer.dirty = false; await el._closeDrawer(); } catch (e) { errs.push(`drawer ${k} ${n}: ${e.stack.split("\n").slice(0, 2).join(" ")}`); } }
  // channel: validation then a real save
  q('[data-tab="outlets"]').click(); await sleep();
  el._openDrawer("channel", 2); await sleep();
  q('[data-act="save"]').click(); await sleep();
  if (!toasts.some((t) => t.includes("Choose the device"))) errs.push("no validation for missing device");
  q('.pk-i[data-v="switch.kp303_1"]').click(); await sleep();
  q('.ftile[data-key="heater"]').click(); await sleep(300);
  if (!q("[data-preview]").textContent.includes("ON")) errs.push("preview not shown: " + q("[data-preview]").textContent);
  const nm = q('input[data-d="name"]'); nm.value = "Heater 2"; nm.dispatchEvent(new w.Event("input", { bubbles: true }));
  q('[data-act="save"]').click(); await sleep(30);
  const sv = calls.filter((c) => c.type === "sentinel_controller/save" && c.section === "channels").pop();
  const ch2 = sv && sv.value.find((c) => c.n === 2);
  if (!ch2 || ch2.entity !== "switch.kp303_1" || ch2.fn.type !== "temperature" || ch2.fn.mode !== "heater" || ch2.fn.param !== "p1" || ch2.name !== "Heater 2") errs.push("channel save wrong " + JSON.stringify(ch2));
  if (q(".drawer")) errs.push("drawer still open after save");
  // picker search filters in place
  el._openDrawer("channel", 3); await sleep();
  const pq = q(".pk-q"); pq.value = "kp303"; pq.dispatchEvent(new w.Event("input", { bubbles: true }));
  const vis = [...sr.querySelectorAll(".pk-i[data-s]")].filter((i) => i.style.display !== "none").map((i) => i.dataset.v);
  if (vis.length !== 1 || vis[0] !== "switch.kp303_1") errs.push("picker search wrong " + vis);
  el.drawer.dirty = false; await el._closeDrawer();
  // timer: add a period, pick days, save
  q('[data-tab="schedules"]').click(); await sleep();
  el._openDrawer("timer", 3); await sleep();
  q('[data-act="entry_add"]').click(); await sleep();
  q('[data-act="wdpreset"][data-p="wk"]').click(); await sleep();
  q('[data-act="save"]').click(); await sleep(30);
  const tsv = calls.filter((c) => c.section === "timers").pop(); const t3 = tsv && tsv.value.find((t) => t.n === 3);
  if (!t3 || t3.entries.length !== 1 || t3.weekdays.join() !== "0,1,2,3,4") errs.push("timer save wrong " + JSON.stringify(t3));
  // gate: change input type via select
  el._openDrawer("gate", 2); await sleep();
  const s1 = q('select[data-d="in1.key"]'); s1.value = "filter"; s1.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep();
  q('.seg button[data-d="in1.invert"][data-v="1"]').click(); await sleep();
  q('[data-act="save"]').click(); await sleep(30);
  const gsv = calls.filter((c) => c.section === "logic").pop(); const g2 = gsv && gsv.value.find((g) => g.n === 2);
  if (!g2 || g2.in1.type !== "filter" || g2.in1.invert !== true || g2.in1.key) errs.push("gate save wrong " + JSON.stringify(g2 && g2.in1));
  // page form: setup save
  q('[data-tab="setup"]').click(); await sleep();
  const dt = q('input[data-f="setup|data_timeout_min"]'); dt.value = "7"; dt.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep();
  if (!q('[data-formbar="setup"].on')) errs.push("form bar not shown");
  q('[data-act="form_save"]').click(); await sleep(30);
  if (!calls.some((c) => c.section === "data_timeout_min" && c.value === 7)) errs.push("setup save missing");
  // notify checkbox
  q('[data-tab="alerts"]').click(); await sleep();
  const cb = q('input[data-notify="notify.pushover"]'); cb.checked = !cb.checked; cb.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep();
  q('[data-act="form_save"]').click(); await sleep(30);
  if (!calls.some((c) => c.section === "notify")) errs.push("notify save missing");
  // shortcut buttons ("Add a probe", "Open probe"…) switch tab AND open the editor
  q('[data-tab="overview"]').click(); await sleep();
  const go = q('[data-act="goto"][data-kind]');
  if (!go) errs.push("no goto-with-editor button on overview"); else { go.click(); await sleep(30); if (!q(".drawer")) errs.push("goto did not open the editor"); el.drawer.dirty = false; await el._closeDrawer(); }
  if (sr.querySelector('[data-act="goto"][data-tab]')) errs.push("goto button carries data-tab");
  // controller outlets: GHL (read-only) + HYDROS (adoptable) on the Outlets tab
  q('[data-tab="outlets"]').click(); await sleep();
  const pg = q(".page").textContent;
  if (!pg.includes("Main Reef GHL IM100") || !pg.includes("HYDROS Control X2") || !pg.includes("Outlet 1") || !pg.includes("100L heat")) errs.push("controller outlets missing");
  if (!pg.includes("read-only")) errs.push("GHL outlets not marked read-only");
  if (pg.includes("Child lock")) errs.push("settings switch shown as an outlet");
  const ad = q('[data-act="adopt"][data-e="switch.hydros_control_x2_100l_heat"]');
  if (!ad) errs.push("no Control with Sentinel button for HYDROS"); else { ad.click(); await sleep(30); if (el.drawer?.draft.entity !== "switch.hydros_control_x2_100l_heat") errs.push("adopt did not prefill"); el.drawer.dirty = false; await el._closeDrawer(); }
  if (q('[data-act="adopt"][data-e^="binary_sensor"]')) errs.push("read-only outlet offered for control");
  // setup: controllers chooser saves an explicit list
  q('[data-tab="setup"]').click(); await sleep();
  const stxt = q(".page").textContent;
  if (!stxt.includes("Outlet sources") || stxt.includes("Controllers")) errs.push("setup section not renamed");
  if (q('input[data-ctrl="d5"]')) errs.push("car offered as an outlet source");
  if (!q('input[data-ctrl="d1"]')) errs.push("Kasa strip not offered");
  q('[data-act="other_src"]').click(); await sleep();
  if (!q('input[data-ctrl="d5"]')) errs.push("show other devices did not reveal the car");
  const usb = q('input[data-ctrlout="switch.hydros_control_x2_usb_light"]');
  if (!usb) errs.push("no per-outlet tick boxes"); else { usb.checked = false; usb.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(); q('[data-act="form_save"]').click(); await sleep(30);
    const cs = calls.filter((c) => c.section === "controllers").pop(); const h = cs && cs.value.find((c) => c.device_id === "d3");
    if (!h || JSON.stringify(h.outlets) !== JSON.stringify(["switch.hydros_control_x2_100l_heat"])) errs.push("per-outlet save wrong " + JSON.stringify(cs && cs.value)); }
  q('[data-tab="outlets"]').click(); await sleep();
  if (q(".page").textContent.includes("USB light")) errs.push("unticked outlet still shown");
  q('[data-tab="setup"]').click(); await sleep();
  const cc = q('input[data-ctrl="d3"]'); if (!cc || !cc.checked) errs.push("HYDROS not pre-selected"); else { cc.checked = false; cc.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(); q('[data-act="form_save"]').click(); await sleep(30);
    const cs = calls.filter((c) => c.section === "controllers").pop(); if (!cs || cs.value.some((c) => c.device_id === "d3") || !cs.value.some((c) => c.device_id === "d2")) errs.push("controllers save wrong " + JSON.stringify(cs && cs.value)); }
  // dosers tab
  q('[data-tab="dosers"]').click(); await sleep();
  const dt2 = q(".page").textContent;
  if (!dt2.includes("GHL Doser") || !dt2.includes("Calcium") || !dt2.includes("54%") || !dt2.includes("1.07 L") || !dt2.includes("Dosing") || !dt2.includes("Refill") || !dt2.includes("Online")) errs.push("dosers tab wrong: " + dt2.replace(/\s+/g, " ").slice(0, 300));
  q('[data-tab="overview"]').click(); await sleep();
  if (!q(".page").textContent.includes("NaOH")) errs.push("dosers missing on overview");
  // live updates don't throw
  el._onStatus(fx.status); await sleep();
  console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "SMOKE OK", "| toasts:", toasts.join(" / "));
  process.exit(errs.length ? 1 : 0);
})();
