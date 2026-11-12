/* Sentinel Controller card.
 * Control scheme follows the GHL ProfiLux 4 resource guide; look follows the Reef Ecosystem dashboard. */
(() => {
const VERSION = "0.2.17";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : String(Number(Number(v).toFixed(d))));
const setp = (o, path, v) => { const ks = path.split("."); let x = o; ks.slice(0, -1).forEach((k) => { const kk = /^\d+$/.test(k) ? Number(k) : k; if (x[kk] == null) x[kk] = {}; x = x[kk]; }); const l = ks[ks.length - 1]; x[/^\d+$/.test(l) ? Number(l) : l] = v; };

const TABS = [
  ["overview", "Overview", "mdi:view-dashboard-outline"],
  ["outlets", "Outlets", "mdi:power-socket-us"],
  ["probes", "Probes", "mdi:thermometer"],
  ["schedules", "Schedules", "mdi:calendar-clock"],
  ["modes", "Feed & Maintenance", "mdi:fish"],
  ["water", "Water", "mdi:waves-arrow-up"],
  ["dosers", "Dosers", "mdi:beaker-outline"],
  ["logic", "Logic", "mdi:gate-and"],
  ["alerts", "Alerts", "mdi:bell-outline"],
  ["setup", "Setup", "mdi:cog-outline"],
];

const FUNCS = [
  { key: "always_on", type: "always_on", icon: "mdi:power", label: "Always on", desc: "Return pump, powerheads" },
  { key: "heater", type: "temperature", mode: "heater", icon: "mdi:radiator", label: "Heater", desc: "On below the temperature setpoint" },
  { key: "cooler", type: "temperature", mode: "cooler", icon: "mdi:fan", label: "Cooler / fan", desc: "On above the temperature setpoint" },
  { key: "ph_up", type: "ph", mode: "up", icon: "mdi:arrow-up-bold-circle-outline", label: "pH up", desc: "On below the pH setpoint (control upwards)" },
  { key: "ph_down", type: "ph", mode: "down", icon: "mdi:arrow-down-bold-circle-outline", label: "pH down", desc: "On above the pH setpoint (CO2 for a calcium reactor)" },
  { key: "timer", type: "timer", icon: "mdi:timer-outline", label: "Schedule", desc: "On during a timer's periods" },
  { key: "illumination", type: "illumination", icon: "mdi:lightbulb-on-outline", label: "Light", desc: "Non-dimmable light schedule" },
  { key: "filter", type: "filter", icon: "mdi:fish-off", label: "Feed pause", desc: "Off while a feed pause runs" },
  { key: "fill_water", type: "fill_water", icon: "mdi:water-alert-outline", label: "Leak / level shutoff", desc: "Off while a leak or level circuit alarms" },
  { key: "fill_ato", type: "fill_ato", icon: "mdi:water-plus-outline", label: "ATO pump", desc: "Top-off pump for a level circuit" },
  { key: "fill_awc", type: "fill_awc", icon: "mdi:water-sync", label: "AWC fill pump", desc: "Refills during a water change" },
  { key: "drain_water", type: "drain_water", icon: "mdi:water-minus-outline", label: "AWC drain pump", desc: "Drains during a water change" },
  { key: "maintenance", type: "maintenance", icon: "mdi:wrench-outline", label: "Maintenance", desc: "On while a maintenance mode runs" },
  { key: "logic", type: "logic", icon: "mdi:gate-and", label: "Logic gate", desc: "Combine functions (AND, OR, delays)" },
  { key: "always_off", type: "always_off", icon: "mdi:power-off", label: "Always off", desc: "Keep this outlet off" },
];
const funcOf = (fn) => {
  const t = fn?.type || "always_off";
  const m = fn?.mode || (t === "temperature" ? "heater" : t === "ph" ? "up" : "");
  return FUNCS.find((f) => f.type === t && (!f.mode || f.mode === m)) || FUNCS[FUNCS.length - 1];
};

const LEVEL = {
  off: { icon: "mdi:minus-circle-outline", label: "Not used", desc: "" },
  ato: { icon: "mdi:water-plus-outline", label: "Auto top off", desc: "One sensor. Pump runs while the sensor is dry." },
  minmax: { icon: "mdi:arrow-expand-vertical", label: "Min / Max", desc: "Two sensors. Starts when the lower sensor goes dry, stops when the upper sensor sees water." },
  ato2: { icon: "mdi:water-check-outline", label: "ATO, 2 sensors", desc: "Two sensors side by side. Runs only when both are dry." },
  wc: { icon: "mdi:water-sync", label: "Water change", desc: "Drains until the lower sensor is dry, then fills until the upper sensor sees water." },
  ato_wc: { icon: "mdi:water-sync", label: "ATO + water change", desc: "Water change, and the upper sensor also runs the ATO." },
  leak: { icon: "mdi:water-alert-outline", label: "Leak detection", desc: "Alarm and outlets off while the sensor sees water." },
};
const OPS = {
  and: { label: "AND", desc: "On only when both inputs are on." },
  or: { label: "OR", desc: "On when either input is on." },
  delayed_on: { label: "Delayed ON", desc: "Turns on only after the input has been on for the duration; turns off at once." },
  delayed_off: { label: "Delayed OFF", desc: "Turns on at once; stays on for the duration after the input goes off." },
};
// Container fill colors by pump number (same as the Reef Ecosystem dashboard)
const PUMP_COLORS = ["#4f8fc9", "#7a6bc4", "#3aa6a0", "#c46b9a", "#8a7a5c", "#5aa5dc", "#7a8fd0", "#c56b5a"];
// Integrations whose devices are reef controllers (outputs = outlets)
const CTRL_PLATFORMS = ["apex", "apex_fusion", "neptune_apex", "reef_pi", "hydros", "ghl", "profilux"];
// Reef controllers recognised by model, maker or name (gear that arrives through MQTT bridges)
const CTRL_RE = /ghl|profilux|hydros control|neptune|coralvue|reef-?pi/i;
// …and by device name, but only for MQTT devices (bridges such as neptuneapex-hass-mqtt)
const CTRL_NAME_RE = /ghl|profilux|hydros control|apex|neptune|reef-?pi/i;
// Integrations whose switches are smart plugs or power-strip sockets
const PLUG_PLATFORMS = ["tplink", "kasa", "tapo", "shelly", "wemo", "tuya", "localtuya", "tuya_local", "meross_lan", "meross_cloud", "sonoff", "tasmota", "switchbot", "govee", "vesync", "eufy"];
// "plug / socket / outlet / power strip" in the languages Home Assistant users most often run
const PLUG_RE = /plug|socket|outlet|power ?strip|steckdose|stecker|prise|enchufe|regleta|presa|ciabatta|stopcontact|contactdoos|gniazd|tomada|uttag|stikkontakt|pistorasia|zásuvka|розетк|コンセント|插座/i;
// Not outlets even when they have a switch: wall switches, dimmers, lights
const NOT_PLUG_RE = /light ?switch|wall ?switch|dimmer|in-?wall|lichtschalter|interrupteur/i;
const LEVEL_TYPES = ["fill_water", "fill_ato", "fill_awc", "drain_water"];

class SentinelControllerCard extends HTMLElement {
  setConfig(c) { this._config = c || {}; }
  getCardSize() { return 14; }
  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._init(); }

  async _init() {
    this.attachShadow({ mode: "open" });
    this.tab = this._config?.tab || "overview";
    this.drawer = null;
    this.forms = {};
    const sr = this.shadowRoot;
    sr.addEventListener("click", (e) => this._click(e));
    sr.addEventListener("change", (e) => this._input(e, true));
    sr.addEventListener("input", (e) => this._input(e, false));
    sr.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.drawer) this._closeDrawer(); });
    try {
      const r = await this._hass.callWS({ type: "sentinel_controller/get" });
      this.cfg = r.config; this.status = r.status; this.L = r.limits; this.running = r.version || "";
      try {
        const [ents, devs] = await Promise.all([this._hass.callWS({ type: "config/entity_registry/list" }), this._hass.callWS({ type: "config/device_registry/list" })]);
        const dn = {}; this.devInfo = {}; devs.forEach((d) => { dn[d.id] = d.name_by_user || d.name; this.devInfo[d.id] = { model: d.model || "", mfr: d.manufacturer || "" }; });
        this.devs = dn; this.devEnts = {};
        this.reg = {}; ents.forEach((e) => {
          this.reg[e.entity_id] = { device: dn[e.device_id] || "", device_id: e.device_id, platform: e.platform, hidden: !!(e.hidden_by || e.disabled_by), category: e.entity_category || "" };
          if (e.device_id && !e.disabled_by) (this.devEnts[e.device_id] = this.devEnts[e.device_id] || []).push(e.entity_id);
        });
      } catch (e) { this.reg = {}; }
      this._unsub = await this._hass.connection.subscribeMessage((m) => this._onStatus(m.status), { type: "sentinel_controller/subscribe" });
    } catch (err) { this.err = err.message || String(err); }
    this._render();
    this._clock = setInterval(() => this._live(), 1000);
  }
  disconnectedCallback() { this._unsub && this._unsub(); this._unsub = null; clearInterval(this._clock); }
  _onStatus(st) { this.status = st; this._live(); }

  // ------------------------------------------------------------------ data helpers
  st(path, d) { let v = this.status; for (const k of path) { if (v == null) return d; v = v[String(k)]; } return v ?? d; }
  item(sec, n) { return this.cfg[sec].find((x) => x.n === Number(n)); }
  probe(id) { return this.cfg.probes.find((p) => p.id === id); }
  ename(e) { const s = this._hass.states[e]; return s?.attributes?.friendly_name || e || ""; }
  edev(e) { return this.reg?.[e]?.device || ""; }
  usedChannels() { return this.cfg.channels.filter((c) => c.entity || c.name || (c.fn?.type && c.fn.type !== "always_off")); }
  timerUsed(t) { return !!(t.name || (t.entries || []).length); }
  gateUsed(g) { return !!(g.name || g.in1?.type !== "always_off" || g.in2?.type !== "always_off"); }
  nextFree(sec, used) { const f = this.cfg[sec].find((x) => !used(x)); return f ? f.n : null; }
  usersOf(type, n) { return this.cfg.channels.filter((c) => c.fn?.type === type && Number(c.fn?.param) === Number(n)); }
  remaining(iso) { if (!iso) return 0; return Math.max(0, (new Date(iso) - Date.now()) / 1000); }
  mmss(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  unit(p) { return p?.unit || (p?.kind === "ph" ? "" : this._hass.states[p?.entity]?.attributes?.unit_of_measurement || ""); }
  points(p) { const n = Number(p?.nominal || 0), h = Number(p?.hysteresis || 0) / 2; return [n - h, n + h]; }
  // ---- outlets that belong to connected controllers (GHL, HYDROS, Apex…)
  ctrlOutletEnts(devId) {
    return (this.devEnts?.[devId] || []).filter((e) => {
      const st = this._hass.states[e]; if (!st) return false;
      if (this.reg[e]?.category || /child_lock|_lock$|beeper|_led$|indicator/i.test(e)) return false;  // settings, not outlets
      const dom = e.split(".")[0];
      if (dom === "switch") return true;
      if (dom === "select") return this.isOutletSelect(e);
      if (dom === "binary_sensor") return /outlet|socket|output/i.test(e) || ["power", "plug", "outlet"].includes(st.attributes?.device_class);
      return false;
    }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  // an Apex-style outlet: a select whose options include On and Off (usually Off / Auto / On)
  isOutletSelect(e) {
    if (/power_on|restore|behavio|indicator|backlight|_led|light_mode/i.test(e)) return false;  // plug settings, not outlets
    const o = (this._hass.states[e]?.attributes?.options || []).map((x) => String(x).trim().toLowerCase());
    return o.includes("on") && o.includes("off") && o.includes("auto");
  }
  // ---- dosers: any device with "pump_<n>_<name>_volume_ml" sensors (GHL Doser 2.1 / Maxi via the bridge)
  dosers() {
    const out = [];
    for (const [devId, ents] of Object.entries(this.devEnts || {})) {
      const pumps = [];
      for (const e of ents) {
        const m = /^sensor\.(.+)_pump_(\d+)_(.+)_volume_ml$/.exec(e); if (!m) continue;
        const [, prefix, n, slug] = m;
        const find = (suffix) => ents.find((x) => x === `sensor.${prefix}_${slug}_${suffix}`);
        const dosing = Object.keys(this._hass.states).find((x) => x.startsWith("binary_sensor.") && new RegExp(`pump_${n}_.*dosing|pump_${n}_dosing`).test(x) && /doser/.test(x));
        pumps.push({ n: Number(n), slug, vol: e, pct: find("volume"), state: find("state"), dosing });
      }
      if (!pumps.length) continue;
      pumps.sort((a, b) => a.n - b.n);
      const pick = (re) => ents.find((x) => re.test(x));
      out.push({ device_id: devId, name: this.devs[devId] || "Doser", pumps,
        conn: pick(/^sensor\..*_connection$/), wd: pick(/^sensor\..*_watchdog$/), age: pick(/^sensor\..*_live_data_age$/), paused: pick(/^binary_sensor\..*dosing_paused$/) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  pumpName(d, p) {
    const own = String(((this.cfg.doser_names || {})[d.device_id] || {})[p.n] || "").trim(); if (own) return own;
    return this.autoPumpName(d, p);
  }
  autoPumpName(d, p) {
    const src = p.pct || p.state || p.vol; let n = this.ename(src);
    if (n.toLowerCase().startsWith(d.name.toLowerCase() + " ")) n = n.slice(d.name.length + 1);
    n = n.replace(/\s*(volume|state)(\s*ml)?$/i, "").replace(/^pump \d+\s*/i, "");
    return n || p.slug.replace(/_/g, " ");
  }
  pumpCard(d, p) {
    return `<div class="card pump" data-live="pump:${esc(d.device_id)}:${p.n}"></div>`;
  }
  // Doser heads grouped into sections: the user's section name per pump, else the doser's name.
  // Consecutive pumps with the same section share one heading (e.g. Doser 2.1 = 1–4, Maxi EXT = 5–6).
  doserGroups(d) {
    const names = (this.cfg.doser_sections || {})[d.device_id] || {}; const out = [];
    for (const p of d.pumps) {
      const nm = String(names[p.n] || "").trim() || d.name; const last = out[out.length - 1];
      if (last && last.name === nm) last.pumps.push(p); else out.push({ name: nm, pumps: [p] });
    }
    return out;
  }
  doserSections(ds) {
    const groups = ds.flatMap((d) => this.doserGroups(d).map((g, i) => ({ ...g, d, first: i === 0 })));
    return `<div class="dgroups">${groups.map((g) => `<div class="dgroup" style="flex:${g.pumps.length} 1 ${g.pumps.length * 200}px">
      ${this.sec(`Dosing · ${g.name}`, g.first ? `<span class="hdrchips" data-live="doserhead:${esc(g.d.device_id)}"></span>` : "")}
      <div class="dgrid">${g.pumps.map((p) => this.pumpCard(g.d, p)).join("")}</div></div>`).join("")}</div>`;
  }
  // mL dosed in the last 24 h: the sum of every drop in the container volume (refills ignored), from
  // Home Assistant history, refreshed every 15 minutes.
  doseDay(e) {
    const C = this._dose || (this._dose = {}); const c = C[e] || {};
    if (!c.busy && (!c.t || Date.now() - c.t > 900000) && this._hass?.callWS) {
      C[e] = { ...c, busy: true };
      const u = this._hass.states[e]?.attributes?.unit_of_measurement || "mL";
      const f = /oz/i.test(u) ? 29.5735 : /^l$/i.test(u) ? 1000 : /gal/i.test(u) ? 3785.41 : 1;
      const end = new Date(), start = new Date(end - 864e5);
      Promise.resolve(this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [e], minimal_response: true, no_attributes: true }))
        .then((r) => { const rows = ((r || {})[e] || []).map((x) => parseFloat(x.s) * f).filter((x) => !isNaN(x)); let d = 0;
          for (let i = 1; i < rows.length; i++) { const x = rows[i] - rows[i - 1]; if (x < 0) d -= x; }
          C[e] = { t: Date.now(), v: rows.length > 1 ? d : null }; })
        .catch(() => { C[e] = { t: Date.now(), v: null }; });
    }
    return (C[e] || {}).v ?? null;
  }
  _pumpLive(devId, n) {
    const d = this.dosers().find((x) => x.device_id === devId); const p = d?.pumps.find((x) => x.n === Number(n)); if (!p) return "";
    const S = this._hass.states;
    const pct = parseFloat(S[p.pct]?.state);
    const raw = parseFloat(S[p.vol]?.state), unit = S[p.vol]?.attributes?.unit_of_measurement || "";
    const ml = isNaN(raw) ? null : /oz/i.test(unit) ? raw * 29.5735 : /^l$/i.test(unit) ? raw * 1000 : /gal/i.test(unit) ? raw * 3785.41 : raw;
    const vol = ml == null ? "—" : ml >= 1000 ? `${(ml / 1000).toFixed(2)} L` : `${Math.round(ml)} mL`;
    const lvl = isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
    const fill = isNaN(pct) ? "#c9d4de" : pct < 15 ? "#d9312b" : pct < 30 ? "#e8a317" : PUMP_COLORS[(p.n - 1) % PUMP_COLORS.length];
    const day = this.doseDay(p.vol);
    const dayTxt = day == null ? "— /day" : day >= 1000 ? `${(day / 1000).toFixed(2)} L/day` : `${Math.round(day)} mL/day`;
    const st = S[p.state]?.state; const ok = st === "Normal";
    const mark = !p.state ? "" : ok ? `<span class="pdot ok" title="Normal">●</span>` : `<span class="pdot bad">▲ ${esc(st || "unknown")}</span>`;
    return `<div class="tank" aria-hidden="true"><i style="height:${lvl}%;background:${fill}"></i></div>
      <div class="pinfo"><div class="phead"><span>PUMP ${p.n}</span>${mark}</div><b class="pname">${esc(this.pumpName(d, p))}</b>
      <div class="pline"><b>${isNaN(pct) ? "--" : Math.round(pct) + "%"}</b> · ${vol}</div><div class="pday">${dayTxt}</div></div>`;
  }
  doserHead(d) {
    const S = this._hass.states;
    const conn = S[d.conn]?.state, wd = S[d.wd]?.state, paused = S[d.paused]?.state === "on";
    const ok = (!d.conn || conn === "Connected") && (!d.wd || wd === "OK");
    return `${ok ? "" : `<span class="chip bad">${esc(conn || wd || "Offline")}</span>`}${paused ? `<span class="chip warn">Dosing paused</span>` : ""}`;
  }

  // the user's own name for a controller or strip outlet, else Home Assistant's name without the device prefix
  outletName(e, dev) { return String((this.cfg.outlet_names || {})[e] || "").trim() || this.shortName(e, dev); }
  shortName(e, dev) { const n = this.ename(e); return n.toLowerCase().startsWith(dev.toLowerCase() + " ") ? n.slice(dev.length + 1) : n; }
  // ---- outlet sources: which devices can supply outlets to the Outlets and Overview tabs
  // "controller" = a reef controller's outputs, "strip" = a smart plug or power strip, "other" = anything
  // else with a switch (cars, appliances, power stations, pumps, wall light switches). Only the first two
  // are offered by default; the rest stay one click away.
  srcKind(id) {
    const fix = (this.forms?.setup?.draft?.source_kinds || this.cfg.source_kinds || {})[id]; if (fix) return fix;
    return this.guessKind(id);
  }
  // Best guess from what Home Assistant knows about the device, strongest clue first.
  guessKind(id) {
    const info = this.devInfo?.[id] || {}, name = this.devs?.[id] || "";
    const ents = this.ctrlOutletEnts(id), plat = ents.map((e) => this.reg[e]?.platform);
    if (plat.some((p) => CTRL_PLATFORMS.includes(p)) || ents.some((e) => e.startsWith("select."))) return "controller";
    if (CTRL_RE.test(`${info.model} ${info.mfr}`)) return "controller";
    if (CTRL_NAME_RE.test(name) && plat.some((p) => p === "mqtt")) return "controller";
    if (NOT_PLUG_RE.test(info.model)) return "other";
    if (ents.some((e) => this._hass.states[e]?.attributes?.device_class === "outlet")) return "strip";
    if (plat.some((p) => PLUG_PLATFORMS.includes(p))) return "strip";
    if (PLUG_RE.test(`${info.model} ${name}`) || ents.some((e) => PLUG_RE.test(`${e} ${this.ename(e)}`))) return "strip";
    return "other";
  }
  ctrlCandidates() {
    return Object.keys(this.devEnts || {}).filter((id) => this.ctrlOutletEnts(id).length)
      .map((id) => ({ device_id: id, name: this.devs[id] || id, kind: this.srcKind(id) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  controllers() {
    const saved = this.cfg.controllers || [];
    if (saved.length) return saved.filter((c) => this.devEnts?.[c.device_id]);
    return this.ctrlCandidates().filter((c) => c.kind === "controller");
  }
  // outlets of a source that are switched on in Setup (no list saved = all of them)
  ctrlShown(c) { const all = this.ctrlOutletEnts(c.device_id); return Array.isArray(c.outlets) ? all.filter((e) => c.outlets.includes(e)) : all; }
  ctrlSection(c) {
    const ents = this.ctrlShown(c); if (!ents.length) return "";
    const cards = ents.map((e) => {
      const ro = e.startsWith("binary_sensor.");
      const ch = this.cfg.channels.find((x) => x.entity === e);
      const tag = ch ? `<span class="chip info">Sentinel · ${esc(this.chName(ch))}</span>` : ro ? `<span class="chip">Run by the controller · read-only</span>` : `<span class="chip">Run by the controller</span>`;
      const act = ch ? this.btn("open", "Open", { kind: "channel", n: ch.n }, "ghost sm") : ro ? "" : this.btn("adopt", "Control with Sentinel", { e }, "ghost sm", "mdi:swap-horizontal");
      return `<div class="card outlet"><div class="oc"><span class="oi">${this.icon(ro ? "mdi:power-socket-eu" : "mdi:power-socket-us")}</span>
        <span class="ot"><span class="cap">${esc(e)}</span><b>${esc(this.outletName(e, c.name))}</b>${tag}</span>
        <span class="os" data-live="ent:${esc(e)}"></span></div>${act ? `<div class="manual">${act}</div>` : ""}</div>`;
    }).join("");
    return `${this.sec(c.name, `<span class="muted">${ents.length} outlet${ents.length === 1 ? "" : "s"}</span>`)}<div class="grid g3">${cards}</div>`;
  }

  chName(c) { return `Outlet ${c.n}${c.name ? " · " + c.name : ""}`; }

  fnText(fn) {
    const f = funcOf(fn), t = fn?.type, n = Number(fn?.param);
    if (t === "temperature" || t === "ph") {
      const p = this.probe(fn.param); if (!p) return `${f.label} · choose a probe`;
      const [lo, hi] = this.points(p), u = this.unit(p);
      return `${f.label} · ${p.name || p.id} ${fmt(lo)}–${fmt(hi)}${u}`;
    }
    if (t === "timer") { const x = this.item("timers", n); return `Schedule · ${x?.name || "Timer " + n}${x ? " · " + this.periodsText(x.entries) : ""}`; }
    if (t === "illumination") { const x = this.item("illumination", n); return `Light · ${x?.name || "Light " + n}${x ? " · " + this.periodsText(x.entries) : ""}`; }
    if (t === "filter") { const x = this.item("feed_pauses", n); return `Off during ${x?.name || "Feed pause " + n}`; }
    if (t === "maintenance") { const x = this.item("maintenance", n); return `On during ${x?.name || "Maintenance " + n}`; }
    if (LEVEL_TYPES.includes(t)) { const x = this.item("level_circuits", n); return `${f.label} · ${x?.name || LEVEL[x?.mode]?.label || "Circuit " + n}`; }
    if (t === "logic") { const x = this.item("logic", n); return `Logic · ${x?.name || "Gate " + n}`; }
    return f.label;
  }
  periodsText(entries) { const e = (entries || []).filter((x) => x.on); if (!e.length) return "no times"; return e.slice(0, 2).map((x) => (x.off ? `${x.on}–${x.off}` : x.on)).join(", ") + (e.length > 2 ? ` +${e.length - 2}` : ""); }
  whyText(c) {
    const s = this.st(["channels", c.n], {}); const fn = c.fn || {}; const t = fn.type;
    if (!s.reason) return "";
    if (s.reason === "manual override") return "Manual override";
    if (s.reason === "maintenance") return "Held by maintenance";
    if (s.reason === "blackout delay") return "Blackout delay";
    if (String(s.reason).startsWith("fallback")) return "No data — fallback";
    if (t === "temperature" || t === "ph") { const p = this.probe(fn.param); const v = this.st(["probes", fn.param, "value"]); return v == null ? "" : `${p?.name || "Probe"} ${fmt(v)}${this.unit(p)}`; }
    if (t === "filter") return this.st(["feed_pauses", fn.param]) ? "Feed pause running" : "";
    if (t === "fill_water") return this.st(["level", fn.param, "error"]) ? "Circuit alarm" : "";
    return "";
  }

  // ------------------------------------------------------------------ small UI pieces
  icon(i, cls = "") { return `<ha-icon class="${cls}" icon="${i}"></ha-icon>`; }
  pill(on, a = "ON", b = "OFF") { return on == null ? `<span class="pill unk">—</span>` : `<span class="pill ${on ? "on" : "off"}">${on ? a : b}</span>`; }
  sec(t, right = "") { return `<div class="sec"><span>${esc(t)}</span>${right}</div>`; }
  btn(act, label, data = {}, cls = "", icon = "") {
    const d = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
    return `<button type="button" class="btn ${cls}" data-act="${act}" ${d}${!label ? ` aria-label="${esc(act)}"` : ""}>${icon ? this.icon(icon) : ""}${label ? `<span>${esc(label)}</span>` : ""}</button>`;
  }
  empty(icon, title, text, action = "") { return `<div class="empty">${this.icon(icon)}<b>${esc(title)}</b><p>${text}</p>${action}</div>`; }
  timeline(entries, mode = "normal", color = "#0069b4") {
    const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
    let blocks = "";
    (entries || []).forEach((e) => {
      const a = hm(e.on), b = hm(e.off);
      if (a == null) return;
      if (mode === "event" || b == null) { blocks += `<i class="tick" style="left:${(a / 1440) * 100}%;background:${esc(color)}"></i>`; return; }
      const seg = (x, y) => `<i style="left:${(x / 1440) * 100}%;width:${((y - x) / 1440) * 100}%;background:${esc(color)}"></i>`;
      blocks += a < b ? seg(a, b) : seg(a, 1440) + seg(0, b);
    });
    return `<div class="tl" aria-hidden="true">${blocks}<b class="now" style="left:${(nm / 1440) * 100}%"></b></div><div class="tlx"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>`;
  }
  bandBar(p) {
    const v = this.st(["probes", p.id, "value"]); const n = Number(p.nominal || 0);
    const dev = Number(p.alarm?.deviation || 0) || Number(p.hysteresis || 0.5) * 3 || 1;
    const lo = n - dev * 1.6, hi = n + dev * 1.6, pct = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
    const [a, b] = this.points(p);
    const al = p.alarm?.active ? `<i class="alm" style="left:0;width:${pct(n - dev)}%"></i><i class="alm" style="left:${pct(n + dev)}%;right:0"></i>` : "";
    return `<div class="band" aria-hidden="true">${al}<i class="ctl" style="left:${pct(a)}%;width:${Math.max(1, pct(b) - pct(a))}%"></i>${v == null ? "" : `<b style="left:${pct(v)}%"></b>`}</div>`;
  }
  stateChip(p) {
    const v = this.st(["probes", p.id, "value"]), al = this.st(["probes", p.id, "alarm"]);
    if (!p.entity) return `<span class="chip warn">No sensor</span>`;
    if (v == null) return `<span class="chip bad">No data</span>`;
    return al ? `<span class="chip bad">Alarm</span>` : `<span class="chip ok">In range</span>`;
  }

  // entity picker — search filters in place, no re-render
  picker(path, cur, domains, emptyLabel = "Choose a device…", numeric = false) {
    const list = Object.keys(this._hass.states).filter((e) => domains.includes(e.split(".")[0]) && (!e.startsWith("select.") || this.isOutletSelect(e)) && (!numeric || e === cur || !isNaN(parseFloat(this._hass.states[e].state))))
      .sort((a, b) => (this.edev(a) ? 0 : 1) - (this.edev(b) ? 0 : 1) || this.edev(a).localeCompare(this.edev(b)) || this.ename(a).localeCompare(this.ename(b)));
    const sub = (e) => { const d = this.edev(e); return esc([d && !this.ename(e).toLowerCase().startsWith(d.toLowerCase()) ? d : "", e].filter(Boolean).join(" · ")); };
    const sel = cur ? `<div class="pk-cur">${this.icon("mdi:check-circle", "okc")}<div><b>${esc(this.ename(cur))}</b><small>${sub(cur)}</small></div><span class="st">${esc(this._hass.states[cur]?.state ?? "missing")}</span></div>` : `<div class="pk-cur none">${esc(emptyLabel)}</div>`;
    return `<div class="picker">${sel}
      <input class="pk-q" placeholder="Search ${list.length} by name, device or id" data-pkq="1" aria-label="Search">
      <div class="pk-list">${cur ? `<div class="pk-i clear" data-act="pick" data-path="${path}" data-v="">${this.icon("mdi:close")}<span>Clear</span></div>` : ""}
      ${list.map((e) => `<div class="pk-i ${e === cur ? "sel" : ""}" data-act="pick" data-path="${path}" data-v="${esc(e)}" data-s="${esc((this.ename(e) + " " + e + " " + this.edev(e)).toLowerCase())}"><span class="nm">${esc(this.ename(e))}<small>${sub(e)}</small></span><span class="st">${esc(this._hass.states[e]?.state ?? "")}</span></div>`).join("")}</div></div>`;
  }

  // controls bound to the drawer draft (data-d) or a page form (data-f="form|path")
  ctl(kind, bind, v, opt = {}) {
    const a = `${bind} ${opt.r ? 'data-r="1"' : ""}`;
    if (kind === "text") return `<input type="text" ${a} value="${esc(v)}" placeholder="${esc(opt.ph || "")}">`;
    if (kind === "time") return `<input type="time" ${a} value="${esc(v)}">`;
    if (kind === "date") return `<input type="date" ${a} value="${esc(v)}">`;
    if (kind === "color") return `<input type="color" ${a} value="${esc(v)}">`;
    if (kind === "num") return `<span class="num"><input type="number" ${a} data-k="num" value="${esc(v)}" step="${opt.step || "any"}" ${opt.min != null ? `min="${opt.min}"` : ""} ${opt.max != null ? `max="${opt.max}"` : ""}>${opt.u ? `<em>${esc(opt.u)}</em>` : ""}</span>`;
    if (kind === "bool") return `<label class="sw"><input type="checkbox" ${a} data-k="bool" ${v ? "checked" : ""}><span></span></label>`;
    if (kind === "select") return `<select ${a} ${opt.numeric ? 'data-k="num"' : ""}>${opt.options.map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    if (kind === "seg") return `<div class="seg" role="group">${opt.options.map(([o, l]) => `<button type="button" class="${String(o) === String(v) ? "on" : ""}" aria-pressed="${String(o) === String(v)}" data-act="seg" ${bind} data-v="${esc(o)}" ${opt.numeric ? 'data-k="num"' : ""}>${esc(l)}</button>`).join("")}</div>`;
    return "";
  }
  d(path) { return `data-d="${path}"`; }
  f(form, path) { return `data-f="${form}|${path}"`; }
  field(label, control, hint = "") { return `<div class="fld"><span class="fl">${esc(label)}${hint ? `<small>${hint}</small>` : ""}</span><span class="fc">${control}</span></div>`; }

  // ------------------------------------------------------------------ events
  _input(e, committed) {
    const el = e.target;
    if (el.dataset?.pkq !== undefined) {
      const q = el.value.trim().toLowerCase(); const box = el.closest(".picker");
      box.querySelectorAll(".pk-i[data-s]").forEach((i) => (i.style.display = !q || i.dataset.s.includes(q) ? "" : "none"));
      return;
    }
    if (el.dataset?.ctrl !== undefined) {
      if (!committed) return;
      const F = this.forms.setup; const list = F.draft.controllers.filter((c) => c.device_id !== el.dataset.ctrl);
      if (el.checked) list.push({ device_id: el.dataset.ctrl, name: el.dataset.name });
      F.draft.controllers = list; F.dirty = true; return this._render();
    }
    if (el.dataset?.kind !== undefined && el.classList.contains("kindsel")) {
      if (!committed) return;
      const F = this.forms.setup; const k = { ...(F.draft.source_kinds || {}) }; const id = el.dataset.kind;
      if (el.value === this.guessKind(id)) delete k[id]; else k[id] = el.value;
      F.draft.source_kinds = k; F.dirty = true;
      if (el.value === "other") this.showOtherSrc = true;
      return this._render();
    }
    if (el.dataset?.oname !== undefined) {
      const F = this.forms.setup; const n = { ...(F.draft.outlet_names || {}) }; const v = el.value.trim();
      if (v) n[el.dataset.oname] = v; else delete n[el.dataset.oname];
      F.draft.outlet_names = n; F.dirty = true; this._formBar("setup"); return;
    }
    if (el.dataset?.ctrlout !== undefined) {
      if (!committed) return;
      const F = this.forms.setup; const c = F.draft.controllers.find((x) => x.device_id === el.dataset.dev); if (!c) return;
      const all = this.ctrlOutletEnts(c.device_id); const on = new Set(Array.isArray(c.outlets) ? c.outlets : all);
      el.checked ? on.add(el.dataset.ctrlout) : on.delete(el.dataset.ctrlout);
      if (all.every((e) => on.has(e))) delete c.outlets; else c.outlets = all.filter((e) => on.has(e));
      F.dirty = true; this._formBar("setup"); return;
    }
    if (el.dataset?.notify !== undefined) {
      if (!committed) return;
      const F = this.forms.notify; const s = new Set(F.draft.notify.targets || []);
      el.checked ? s.add(el.dataset.notify) : s.delete(el.dataset.notify);
      F.draft.notify.targets = [...s]; F.dirty = true; this._formBar("notify"); return;
    }
    const bind = el.dataset?.d ? ["d", el.dataset.d] : el.dataset?.f ? ["f", el.dataset.f] : null;
    if (!bind) return;
    if (!committed && (el.tagName === "SELECT" || el.type === "checkbox")) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.k === "num" && el.type !== "checkbox") v = v === "" ? 0 : Number(v);
    this._set(bind, v, committed && !!el.dataset.r);
  }
  _set([kind, path], v, rerender) {
    if (kind === "d") { setp(this.drawer.draft, path, v); this.drawer.dirty = true; }
    else { const [form, p] = path.split("|"); setp(this.forms[form].draft, p, v); this.forms[form].dirty = true; }
    if (rerender) (kind === "d" ? this._renderDrawer() : this._render());
    else if (kind === "d") this._drawerBar();
    else this._formBar(path.split("|")[0]);
    if (kind === "d") this._schedulePreview();
  }

  async _click(e) {
    const b = e.target.closest("[data-act],[data-tab]");
    if (!b) { if (e.target.classList?.contains("scrim")) this._closeDrawer(); return; }
    if (b.dataset.tab) { if (this.drawer && !(await this._closeDrawer())) return; this.tab = b.dataset.tab; return this._render(); }
    const a = b.dataset.act, ds = b.dataset;
    const run = async (action, n, value) => {
      const m = { type: "sentinel_controller/action", action }; if (n != null && n !== "") m.n = Number(n); if (value !== undefined) m.value = value;
      try { const r = await this._hass.callWS(m); this.cfg = r.config; this.status = r.status; this._render(); }
      catch (err) { this._toast(err.message || String(err), true); }
    };
    const D = this.drawer;
    switch (a) {
      case "open": return this._openDrawer(ds.kind, ds.n);
      case "close": return this._closeDrawer();
      case "save": return this._saveDrawer();
      case "remove": return this._removeDrawer();
      case "pick": return this._set(["d", ds.path], ds.v, true);
      case "seg": { const v = ds.k === "num" ? Number(ds.v) : ds.v; return this._set(ds.d ? ["d", ds.d] : ["f", ds.f], v, true); }
      case "fn": { const f = FUNCS.find((x) => x.key === ds.key); D.draft.fn = { type: f.type, mode: f.mode || "", param: this._defaultParam(f.type) }; D.dirty = true; this._renderDrawer(); return this._schedulePreview(); }
      case "lvlmode": { D.draft.mode = ds.mode; D.dirty = true; return this._renderDrawer(); }
      case "entry_add": { (D.draft.entries = D.draft.entries || []).push(D.draft.mode === "event" ? { on: "08:00", off: "" } : { on: "08:00", off: "20:00" }); D.dirty = true; return this._renderDrawer(); }
      case "entry_del": { D.draft.entries.splice(Number(ds.i), 1); D.dirty = true; return this._renderDrawer(); }
      case "wd": { const k = Number(ds.day), s = new Set(D.draft.weekdays || []); s.has(k) ? s.delete(k) : s.add(k); D.draft.weekdays = [...s].sort(); D.dirty = true; return this._renderDrawer(); }
      case "wdpreset": { D.draft.weekdays = ds.p === "all" ? [0, 1, 2, 3, 4, 5, 6] : ds.p === "wk" ? [0, 1, 2, 3, 4] : [5, 6]; D.dirty = true; return this._renderDrawer(); }
      case "sock_add": { const used = this.usedChannels(); (D.draft.sockets = D.draft.sockets || []).push({ ch: used[0]?.n || 1, state: "off" }); D.dirty = true; return this._renderDrawer(); }
      case "sock_del": { D.draft.sockets.splice(Number(ds.i), 1); D.dirty = true; return this._renderDrawer(); }
      case "today": { setp(D.draft, ds.path, new Date().toISOString().slice(0, 10)); D.dirty = true; return this._renderDrawer(); }
      case "form_save": return this._saveForm(ds.form);
      case "form_revert": { delete this.forms[ds.form]; return this._render(); }
      case "fp": return run(ds.on === "1" ? "stop_feed_pause" : "start_feed_pause", ds.n);
      case "mt": return run(ds.on === "1" ? "stop_maintenance" : "start_maintenance", ds.n);
      case "wc": {
        if (ds.on !== "1" && !confirm("Start a water change now? The drain pump starts.")) return;
        return run(ds.on === "1" ? "stop_water_change" : "start_water_change", ds.n);
      }
      case "reset": return run("reset_level_error", ds.n);
      case "ack": return run("acknowledge_reminder", ds.n);
      case "hours": { await run("reset_hours", ds.n); if (this.drawer) this._renderDrawer(); return; }
      case "override": {
        const on = !this.cfg.manual_override;
        if (on && !confirm("Turn on manual override?\n\nEvery outlet stops following its program and holds its current state until you switch it by hand.")) return;
        return run("manual_override", null, on);
      }
      case "manual": return run("channel_manual", ds.n, ds.v === "on");
      case "other_src": this.showOtherSrc = !this.showOtherSrc; return this._render();
      case "edit_kinds": this.editKinds = !this.editKinds; if (this.editKinds) this.showOtherSrc = true; return this._render();
      case "adopt": {
        const n = this.nextFree("channels", (c) => c.entity || c.name);
        if (!n) return this._toast("All 48 outlets are in use.", true);
        this._openDrawer("channel", n);
        this.drawer.draft.entity = ds.e; this.drawer.draft.name = this.ename(ds.e); this.drawer.dirty = true;
        this._renderDrawer(); return this._schedulePreview();
      }
      case "goto": {
        if (this.drawer && !(await this._closeDrawer())) return;
        this.tab = ds.to; this._render(); if (ds.kind && ds.n) this._openDrawer(ds.kind, ds.n); return;
      }
    }
  }

  _defaultParam(type) {
    if (type === "temperature") return this.cfg.probes.find((p) => p.kind === "temperature")?.id || "";
    if (type === "ph") return this.cfg.probes.find((p) => p.kind === "ph")?.id || "";
    if (type === "timer") return this.cfg.timers.find((t) => t.mode === "normal" && this.timerUsed(t))?.n || 1;
    if (type === "illumination") return this.cfg.illumination.find((t) => this.timerUsed(t))?.n || 1;
    if (LEVEL_TYPES.includes(type)) {
      const want = { fill_water: ["leak", "ato", "minmax", "ato2", "wc", "ato_wc"], fill_ato: ["ato", "minmax", "ato2", "ato_wc"], fill_awc: ["wc", "ato_wc"], drain_water: ["wc", "ato_wc"] }[type];
      return this.cfg.level_circuits.find((c) => want.includes(c.mode))?.n || 1;
    }
    if (type === "logic") return this.cfg.logic.find((g) => this.gateUsed(g))?.n || 1;
    return ["filter", "maintenance"].includes(type) ? 1 : 0;
  }

  // ------------------------------------------------------------------ drawer
  _openDrawer(kind, n) {
    const secOf = { channel: "channels", probe: "probes", timer: "timers", light: "illumination", fp: "feed_pauses", mt: "maintenance", circuit: "level_circuits", lsensor: "level_sensors", gate: "logic", reminder: "reminders" }[kind];
    let draft, idx, isNew = false;
    if (kind === "probe") {
      if (n === "new") {
        const used = new Set(this.cfg.probes.map((p) => p.id)); let i = 1; while (used.has(`p${i}`)) i++;
        draft = { id: `p${i}`, name: "", kind: "temperature", entity: "", unit: "", nominal: 77, hysteresis: 0.36, status_entity: "", status_ok: "Connected",
          alarm: { active: true, deviation: 1.5, no_alarm_on_wc: false, deactivate_control: false } };
        idx = -1; isNew = true;
      } else { idx = this.cfg.probes.findIndex((p) => p.id === n); if (idx < 0) return; draft = clone(this.cfg.probes[idx]); }
    } else {
      idx = this.cfg[secOf].findIndex((x) => x.n === Number(n)); if (idx < 0) return;
      draft = clone(this.cfg[secOf][idx]);
      if (kind === "channel") { if (!draft.fn) draft.fn = { type: "always_off" }; isNew = !draft.entity && !draft.name; }
      if (kind === "reminder" && !draft.text) { draft.enabled = true; draft.start = draft.start || new Date().toISOString().slice(0, 10); isNew = true; }
      if ((kind === "timer" || kind === "light") && !this.timerUsed(draft)) isNew = true;
      if (kind === "gate" && !this.gateUsed(draft)) isNew = true;
      if (kind === "circuit" && draft.mode === "off") { isNew = true; draft.mode = "ato"; }
      if (kind === "lsensor" && !draft.entity) isNew = true;
    }
    this.drawer = { kind, sec: secOf, idx, draft, dirty: false, isNew };
    this.preview = null;
    this._renderDrawer();
    this._schedulePreview();
    setTimeout(() => this.shadowRoot.querySelector(".drawer .x")?.focus(), 50);
  }
  async _closeDrawer() {
    if (this.drawer?.dirty && !confirm("Discard your changes?")) return false;
    this.drawer = null; this.shadowRoot.querySelector(".drawer-wrap")?.remove(); return true;
  }
  async _saveDrawer() {
    const D = this.drawer; const err = this._validate(D);
    if (err) return this._toast(err, true);
    const list = clone(this.cfg[D.sec]);
    if (D.kind === "probe" && D.idx < 0) list.push(D.draft); else list[D.idx] = D.draft;
    try {
      const r = await this._hass.callWS({ type: "sentinel_controller/save", section: D.sec, value: list });
      this.cfg = r.config; this.status = r.status; this.drawer = null;
      this.shadowRoot.querySelector(".drawer-wrap")?.remove();
      this._toast("Saved"); this._render();
    } catch (e) { this._toast(`Not saved: ${e.message || e}`, true); }
  }
  async _removeDrawer() {
    const D = this.drawer;
    if (!confirm("Remove this? It stops controlling anything.")) return;
    let list = clone(this.cfg[D.sec]);
    const blank = {
      channel: (x) => ({ n: x.n, name: "", entity: "", fn: { type: "always_off", param: 0, mode: "" }, invert: false, blackout_min: 0, fallback: "off", manual: "off" }),
      timer: (x) => ({ n: x.n, name: "", mode: "normal", entries: [], day_mode: "weekdays", weekdays: [0, 1, 2, 3, 4, 5, 6], every_days: 1, start_date: "" }),
      light: (x) => ({ n: x.n, name: "", color: "#2196f3", entries: [], temp_reduction: false }),
      gate: (x) => ({ n: x.n, name: "", op: "and", in1: { type: "always_off", param: 0, mode: "", invert: false }, in2: { type: "always_off", param: 0, mode: "", invert: false }, seconds: 1 }),
      reminder: (x) => ({ n: x.n, text: "", days: 30, repeat: true, start: "", enabled: false }),
      circuit: (x) => ({ ...x, name: "", mode: "off", sensor1: 0, sensor2: 0 }),
      lsensor: (x) => ({ n: x.n, name: "", entity: "", wet_states: "on", dry_states: "", invert: false, reaction_s: 0 }),
    };
    if (D.kind === "probe") list = list.filter((p) => p.id !== D.draft.id);
    else list[D.idx] = blank[D.kind](list[D.idx]);
    try {
      const r = await this._hass.callWS({ type: "sentinel_controller/save", section: D.sec, value: list });
      this.cfg = r.config; this.status = r.status; this.drawer = null;
      this.shadowRoot.querySelector(".drawer-wrap")?.remove();
      this._toast("Removed"); this._render();
    } catch (e) { this._toast(e.message || String(e), true); }
  }
  _validate(D) {
    const d = D.draft;
    if (D.kind === "channel") {
      if (!d.entity) return "Choose the device this outlet switches.";
      const dup = this.cfg.channels.find((c) => c.n !== d.n && c.entity === d.entity);
      if (dup) return `${this.ename(d.entity)} is already ${this.chName(dup)}.`;
      if (["temperature", "ph"].includes(d.fn.type) && !this.probe(d.fn.param)) return `Add a ${d.fn.type === "ph" ? "pH" : "temperature"} probe first (Probes tab).`;
    }
    if (D.kind === "probe") { if (!d.entity) return "Choose the sensor this probe reads."; if (!(Number(d.hysteresis) >= 0)) return "Hysteresis can't be negative."; }
    if (D.kind === "timer" || D.kind === "light") {
      if (!(d.entries || []).length) return "Add at least one time.";
      for (const e of d.entries) if (hm(e.on) == null || (d.mode !== "event" && hm(e.off) == null)) return "Every period needs valid times.";
      if (D.kind === "timer" && d.day_mode === "weekdays" && !(d.weekdays || []).length) return "Pick at least one day.";
    }
    if (D.kind === "fp" && !(d.minutes >= 1 && d.minutes <= this.L.feed_pause_max_min)) return `Feed pause length is 1–${this.L.feed_pause_max_min} minutes.`;
    if (D.kind === "mt" && !(d.minutes >= 1 && d.minutes <= this.L.maintenance_max_min)) return `Maintenance length is 1–${this.L.maintenance_max_min} minutes.`;
    if (D.kind === "circuit" && d.mode !== "off") { if (!d.sensor1) return "Choose sensor 1."; if (["minmax", "ato2", "wc", "ato_wc"].includes(d.mode) && !d.sensor2) return "This mode needs two sensors."; }
    if (D.kind === "lsensor" && !d.entity) return "Choose the sensor.";
    if (D.kind === "reminder" && d.enabled && !d.text) return "Write the reminder text.";
    return "";
  }
  _schedulePreview() {
    const D = this.drawer; if (!D || !["channel", "gate"].includes(D.kind)) return;
    clearTimeout(this._pv);
    this._pv = setTimeout(async () => {
      const item = clone(D.draft); ["in1", "in2"].forEach((k) => item[k] && delete item[k].key);
      try { this.preview = await this._hass.callWS({ type: "sentinel_controller/preview", kind: D.kind === "gate" ? "logic" : "channel", item }); }
      catch (e) { this.preview = { error: e.message }; }
      const el = this.shadowRoot.querySelector("[data-preview]"); if (el) el.innerHTML = this._previewHTML();
    }, 250);
  }
  _previewHTML() {
    const p = this.preview; if (!p) return `<span class="muted">Checking current data…</span>`;
    if (p.error) return `<span class="muted">${esc(p.error)}</span>`;
    const g = this.drawer?.kind === "gate";
    const r = String(p.reason || "");
    const extra = r.startsWith("fallback") ? " — data is missing, so it uses the fallback state" : r === "maintenance" ? " — a maintenance mode is holding it" : r === "manual override" ? " — manual override is on" : r === "blackout delay" ? " — blackout delay" : "";
    return `${this.icon(p.out ? "mdi:power-plug" : "mdi:power-plug-off-outline", p.out ? "okc" : "muted")}<span>${g ? "This gate is" : "With these settings this outlet would be"} <b>${p.out == null ? "unknown" : p.out ? "ON" : "OFF"}</b> right now${esc(extra)}.</span>`;
  }
  _drawerBar() { const b = this.shadowRoot.querySelector(".dfoot .dirty"); if (b) b.textContent = this.drawer?.dirty ? "Unsaved changes" : ""; }

  _renderDrawer() {
    const D = this.drawer; if (!D) return;
    const kindLabel = { channel: "Outlet", probe: "Probe", timer: "Schedule", light: "Light schedule", fp: "Feed pause", mt: "Maintenance", circuit: "Water · circuit", lsensor: "Water · sensor", gate: "Logic gate", reminder: "Reminder" }[D.kind];
    const title = { channel: D.draft.name || `Outlet ${D.draft.n}`, probe: D.draft.name || (D.isNew ? "New probe" : D.draft.id), timer: D.draft.name || `Timer ${D.draft.n}`, light: D.draft.name || `Light ${D.draft.n}`, fp: D.draft.name || `Feed pause ${D.draft.n}`, mt: D.draft.name || `Maintenance ${D.draft.n}`, circuit: D.draft.name || `Circuit ${D.draft.n}`, lsensor: D.draft.name || `Sensor ${D.draft.n}`, gate: D.draft.name || `Gate ${D.draft.n}`, reminder: D.draft.text || `Reminder ${D.draft.n}` }[D.kind];
    const body = this["d_" + D.kind].call(this, D.draft);
    const canRemove = !D.isNew && !["fp", "mt"].includes(D.kind);
    const html = `<div class="scrim"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><div><small>${esc(kindLabel)}${D.isNew ? " · new" : ""}</small><h2>${esc(title)}</h2></div>
      <button type="button" class="x" data-act="close" aria-label="Close">${this.icon("mdi:close")}</button></header>
      <div class="dbody">${body}</div>
      <footer class="dfoot">${canRemove ? this.btn("remove", "Remove", {}, "ghost danger", "mdi:delete-outline") : ""}<span class="dirty">${D.dirty ? "Unsaved changes" : ""}</span>
      ${this.btn("close", "Cancel", {}, "ghost")}${this.btn("save", D.isNew ? "Create" : "Save", {}, "primary")}</footer></aside>`;
    let w = this.shadowRoot.querySelector(".drawer-wrap");
    const scroll = w?.querySelector(".dbody")?.scrollTop || 0;
    const focus = this.shadowRoot.activeElement?.dataset?.d;
    if (!w) { w = document.createElement("div"); w.className = "drawer-wrap"; this.shadowRoot.appendChild(w); }
    w.innerHTML = html;
    w.querySelector(".dbody").scrollTop = scroll;
    if (focus) w.querySelector(`[data-d="${focus}"]`)?.focus();
    const p = w.querySelector("[data-preview]"); if (p) p.innerHTML = this._previewHTML();
  }

  // ---- drawer bodies
  d_channel(d) {
    const fsel = funcOf(d.fn);
    const tiles = FUNCS.map((f) => `<button type="button" class="ftile ${f.key === fsel.key ? "on" : ""}" aria-pressed="${f.key === fsel.key}" data-act="fn" data-key="${f.key}">${this.icon(f.icon)}<b>${esc(f.label)}</b><small>${esc(f.desc)}</small></button>`).join("");
    const s = this.st(["channels", d.n], {});
    return `
      ${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: "e.g. Heater" }))}
      <div class="lbl">Device it switches</div>${this.picker("entity", d.entity, ["switch", "light", "fan", "input_boolean", "siren", "humidifier", "select"], "Choose a plug, outlet or relay from any controller…")}
      ${this._conflictNote(d)}
      <div class="lbl">What should it do?</div><div class="ftiles">${tiles}</div>
      <div class="detail">${this._fnDetail(d.fn, "fn")}</div>
      <div class="preview" data-preview></div>
      <details ${d.invert || d.blackout_min || d.fallback === "on" ? "open" : ""}><summary>Advanced</summary>
        ${this.field("Invert", this.ctl("bool", this.d("invert"), d.invert), "Swap ON and OFF")}
        ${this.field("If data is missing", this.ctl("seg", this.d("fallback"), d.fallback || "off", { options: [["off", "Turn OFF"], ["on", "Turn ON"]] }), "When the probe or sensor this outlet depends on goes offline")}
        ${this.field("Blackout delay", this.ctl("num", this.d("blackout_min"), d.blackout_min, { step: 1, min: 0, u: "min" }), "Stay OFF this long after Home Assistant starts or power returns")}
        ${this.field("Operating hours", `<span>${fmt(s.hours ?? 0, 1)} h</span>${this.btn("hours", "Reset", { n: d.n }, "ghost sm")}`)}
      </details>`;
  }
  _conflictNote(d) {
    if (!d.entity) return "";
    const dup = this.cfg.channels.find((c) => c.n !== d.n && c.entity === d.entity);
    if (dup) return `<div class="note bad">${this.icon("mdi:alert")}<span>Already used by ${esc(this.chName(dup))}.</span></div>`;
    for (let i = 1; i <= 8; i++) if (this._hass.states[`input_boolean.outlet_${i}_used`]?.state === "on" && this._hass.states[`input_select.outlet_${i}_outlet`]?.state === d.entity)
      return `<div class="note warn">${this.icon("mdi:alert")}<span>The Reef Ecosystem Outlets tab also drives this device. Remove it there, or Sentinel Controller won't switch it.</span></div>`;
    return "";
  }
  _fnDetail(fn, base) {
    const t = fn.type, P = (p) => `${base}.${p}`;
    const opts = (list, empty) => (list.length ? list : [["", empty]]);
    if (t === "temperature" || t === "ph") {
      const ps = this.cfg.probes.filter((p) => p.kind === (t === "ph" ? "ph" : "temperature"));
      if (!ps.length) return `<div class="note warn">${this.icon("mdi:information-outline")}<span>No ${t === "ph" ? "pH" : "temperature"} probe yet.</span>${this.btn("goto", "Add one", { to: "probes", kind: "probe", n: "new" }, "link")}</div>`;
      const p = this.probe(fn.param) || ps[0]; const [lo, hi] = this.points(p), u = this.unit(p), v = this.st(["probes", p.id, "value"]);
      const lowOn = (t === "temperature" && fn.mode !== "cooler") || (t === "ph" && fn.mode !== "down");
      return `${this.field("Probe", this.ctl("select", this.d(P("param")), p.id, { r: 1, options: ps.map((x) => [x.id, `${x.name || x.id}${this.edev(x.entity) ? " · " + this.edev(x.entity) : ""}`]) }))}
        <p class="sentence">Turns <b>ON</b> at or ${lowOn ? "below" : "above"} <b>${fmt(lowOn ? lo : hi)}${esc(u)}</b> and <b>OFF</b> at or ${lowOn ? "above" : "below"} <b>${fmt(lowOn ? hi : lo)}${esc(u)}</b>. Now <b>${fmt(v)}${esc(u)}</b>.</p>
        <p class="hint">Setpoint ${fmt(p.nominal)}${esc(u)}, hysteresis ${fmt(p.hysteresis)}${esc(u)} — set on the probe. ${this.btn("goto", "Change", { to: "probes", kind: "probe", n: p.id }, "link")}${p.alarm?.deactivate_control ? " Turns off while the probe is in alarm." : ""}</p>`;
    }
    if (t === "timer") {
      const ts = this.cfg.timers.filter((x) => x.mode === "normal" && this.timerUsed(x)); const x = this.item("timers", fn.param);
      const nf = this.nextFree("timers", (y) => this.timerUsed(y));
      return `${this.field("Timer", this.ctl("select", this.d(P("param")), fn.param, { numeric: 1, r: 1, options: opts(ts.map((y) => [y.n, `${y.name || "Timer " + y.n} · ${this.periodsText(y.entries)}`]), "No timers yet") }))}
        ${x && this.timerUsed(x) && x.mode === "normal" ? this.timeline(x.entries) : ""}<p class="hint">${ts.length ? this.btn("goto", "Edit this schedule", { to: "schedules", kind: "timer", n: x?.n || ts[0].n }, "link") : nf ? this.btn("goto", "Create a schedule", { to: "schedules", kind: "timer", n: nf }, "link") : ""}</p>`;
    }
    if (t === "illumination") {
      const ls = this.cfg.illumination.filter((y) => this.timerUsed(y)); const x = this.item("illumination", fn.param);
      const nf = this.nextFree("illumination", (y) => this.timerUsed(y));
      return `${this.field("Light schedule", this.ctl("select", this.d(P("param")), fn.param, { numeric: 1, r: 1, options: opts(ls.map((y) => [y.n, `${y.name || "Light " + y.n} · ${this.periodsText(y.entries)}`]), "No light schedules yet") }))}
        ${x && this.timerUsed(x) ? this.timeline(x.entries, "normal", x.color) : ""}<p class="hint">${ls.length ? this.btn("goto", "Edit this light schedule", { to: "schedules", kind: "light", n: x?.n || ls[0].n }, "link") : nf ? this.btn("goto", "Create a light schedule", { to: "schedules", kind: "light", n: nf }, "link") : ""}</p>`;
    }
    if (t === "filter" || t === "maintenance") {
      const sec = t === "filter" ? "feed_pauses" : "maintenance";
      return `${this.field(t === "filter" ? "Feed pause" : "Maintenance mode", this.ctl("seg", this.d(P("param")), fn.param, { numeric: 1, options: this.cfg[sec].map((y) => [y.n, y.name || String(y.n)]) }))}
        <p class="hint">${t === "filter" ? "Turns OFF while that feed pause runs, then back ON." : "ON only while that maintenance mode runs."}</p>`;
    }
    if (LEVEL_TYPES.includes(t)) {
      const want = { fill_water: null, fill_ato: ["ato", "minmax", "ato2", "ato_wc"], fill_awc: ["wc", "ato_wc"], drain_water: ["wc", "ato_wc"] }[t];
      const cs = this.cfg.level_circuits.filter((c) => c.mode !== "off" && (!want || want.includes(c.mode)));
      return `${this.field("Level circuit", this.ctl("select", this.d(P("param")), fn.param, { numeric: 1, options: opts(cs.map((c) => [c.n, `${c.name || LEVEL[c.mode].label} · ${LEVEL[c.mode].label}`]), "No matching circuit yet") }))}
        <p class="hint">${{ fill_water: "Stays ON; turns OFF while the circuit reports a leak or level alarm.", fill_ato: "Runs the top-off pump for that circuit.", fill_awc: "Runs during the fill phase of a water change.", drain_water: "Runs during the drain phase of a water change." }[t]} ${this.btn("goto", cs.length ? "Open Water" : "Set one up in Water", { to: "water" }, "link")}</p>`;
    }
    if (t === "logic") {
      const gs = this.cfg.logic.filter((g) => this.gateUsed(g));
      return `${this.field("Logic gate", this.ctl("select", this.d(P("param")), fn.param, { numeric: 1, options: opts(gs.map((g) => [g.n, `${g.name || "Gate " + g.n} · ${this.gateText(g)}`]), "No gates yet") }))}
        <p class="hint">${this.btn("goto", gs.length ? "Open Logic" : "Create a gate in Logic", { to: "logic" }, "link")}</p>`;
    }
    return "";
  }

  d_probe(d) {
    const [lo, hi] = this.points(d), u = d.unit || (d.kind === "ph" ? "" : this._hass.states[d.entity]?.attributes?.unit_of_measurement || "");
    const dev = Number(d.alarm?.deviation || 0), n = Number(d.nominal || 0);
    const v = d.entity ? this._hass.states[d.entity]?.state : null;
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: "e.g. Tank temperature" }))}
      ${this.field("Type", this.ctl("seg", this.d("kind"), d.kind, { options: [["temperature", "Temperature"], ["ph", "pH"], ["other", "Other"]] }))}
      <div class="lbl">Sensor it reads</div>${this.picker("entity", d.entity, ["sensor", "input_number", "number"], "Choose a sensor from any controller…", true)}
      ${this.field("Unit", this.ctl("text", this.d("unit"), d.unit, { ph: u || "°F" }), "Leave empty to use the sensor's unit")}
      <div class="lbl">Control</div>
      ${this.field("Setpoint", this.ctl("num", this.d("nominal"), d.nominal, { step: 0.01, u, r: 1 }), "The nominal value outlets hold")}
      ${this.field("Hysteresis", this.ctl("num", this.d("hysteresis"), d.hysteresis, { step: 0.01, min: 0, u, r: 1 }), "Total swing allowed around the setpoint")}
      <p class="sentence">Outlets switch at <b>${fmt(lo)}${esc(u)}</b> and <b>${fmt(hi)}${esc(u)}</b>.${v != null && !isNaN(Number(v)) ? ` Now <b>${fmt(v)}${esc(u)}</b>.` : ""}</p>
      <div class="lbl">Alarm</div>
      ${this.field("Alarm", this.ctl("bool", this.d("alarm.active"), d.alarm?.active, { r: 1 }))}
      ${d.alarm?.active ? `${this.field("Allowed deviation", this.ctl("num", this.d("alarm.deviation"), d.alarm?.deviation, { step: 0.01, min: 0, u, r: 1 }))}
      <p class="sentence">Alarm below <b>${fmt(n - dev)}${esc(u)}</b> or above <b>${fmt(n + dev)}${esc(u)}</b>.</p>
      ${this.field("No alarm during a water change", this.ctl("bool", this.d("alarm.no_alarm_on_wc"), d.alarm?.no_alarm_on_wc))}
      ${this.field("Turn control off in alarm", this.ctl("bool", this.d("alarm.deactivate_control"), d.alarm?.deactivate_control), "This probe's heater, cooler or pH outlets go OFF while outside the allowed deviation")}` : ""}
      <details ${d.status_entity ? "open" : ""}><summary>Data source check</summary>
        <p class="hint">Readings count as missing unless this status sensor reports OK — for example the GHL bridge connection, or the HYDROS online sensor. Empty uses the default on the Setup tab.</p>
        ${this.picker("status_entity", d.status_entity, ["sensor", "binary_sensor"], "None — use the default")}
        ${this.field("OK when state is", this.ctl("text", this.d("status_ok"), d.status_ok, { ph: "Connected" }), "Comma separated")}
      </details>`;
  }

  d_timer(d) { return this._schedBody(d, "timer"); }
  d_light(d) { return this._schedBody(d, "light"); }
  _schedBody(d, kind) {
    const ev = kind === "timer" && d.mode === "event";
    const rows = (d.entries || []).map((e, i) => `<div class="prow">${ev ? `<span>Start at</span>${this.ctl("time", this.d(`entries.${i}.on`), e.on, { r: 1 })}` : `<span>ON</span>${this.ctl("time", this.d(`entries.${i}.on`), e.on, { r: 1 })}<span>OFF</span>${this.ctl("time", this.d(`entries.${i}.off`), e.off, { r: 1 })}`}<span class="grow"></span>${this.btn("entry_del", "", { i }, "ghost sm icon", "mdi:close")}</div>`).join("");
    const used = kind === "timer" ? [...this.usersOf("timer", d.n).map((c) => this.chName(c)),
      ...this.cfg.feed_pauses.filter((f) => Number(f.timer) === d.n).map((f) => `starts ${f.name || "Feed pause " + f.n}`),
      ...this.cfg.level_circuits.filter((c) => Number(c.wc_timer) === d.n).map((c) => `starts water change ${c.name || c.n}`),
      ...this.cfg.level_circuits.filter((c) => !c.ato_always && Number(c.ato_timer) === d.n).map((c) => `allows ATO ${c.name || c.n}`)]
      : this.usersOf("illumination", d.n).map((c) => this.chName(c));
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: kind === "timer" ? "e.g. Skimmer" : "e.g. Refugium light" }))}
      ${kind === "timer" ? `<div class="lbl">Type</div>${this.ctl("seg", this.d("mode"), d.mode, { options: [["normal", "On/Off periods"], ["event", "Start events"]] })}<p class="hint">${ev ? "Starts a feed pause or a water change at set times." : "Outlets set to this schedule are ON during its periods."}</p>` : this.field("Color", this.ctl("color", this.d("color"), d.color, { r: 1 }))}
      <div class="lbl">${ev ? "Start times" : "Periods"}</div>${rows || `<p class="hint">No times yet.</p>`}
      <div>${this.btn("entry_add", ev ? "Add start time" : "Add period", {}, "ghost sm", "mdi:plus")}</div>
      ${this.timeline(d.entries, ev ? "event" : "normal", kind === "light" ? d.color : "#0069b4")}
      ${kind === "timer" ? `<div class="lbl">Days</div>${this.ctl("seg", this.d("day_mode"), d.day_mode, { options: [["weekdays", "Days of the week"], ["interval", "Every N days"]] })}
      ${d.day_mode === "interval" ? `${this.field("Every", this.ctl("num", this.d("every_days"), d.every_days, { step: 1, min: 1, u: "days" }))}${this.field("Starting on", this.ctl("date", this.d("start_date"), d.start_date) + this.btn("today", "Today", { path: "start_date" }, "ghost sm"))}`
        : `<div class="days">${WD.map((w, k) => `<button type="button" class="day ${(d.weekdays || []).includes(k) ? "on" : ""}" aria-pressed="${(d.weekdays || []).includes(k)}" data-act="wd" data-day="${k}">${w}</button>`).join("")}</div>
        <div class="presets">${this.btn("wdpreset", "Every day", { p: "all" }, "link")}${this.btn("wdpreset", "Weekdays", { p: "wk" }, "link")}${this.btn("wdpreset", "Weekends", { p: "we" }, "link")}</div>`}`
        : this.field("Turn off when too warm", this.ctl("bool", this.d("temp_reduction"), d.temp_reduction), "Stays OFF for the rest of the day once the tank passes the limit under 'Heat protection for lights'")}
      <div class="lbl">Used by</div><p class="hint">${used.length ? used.map(esc).join(" · ") : "Nothing yet — on the Outlets tab choose " + (kind === "timer" ? (ev ? "it on a feed pause or water change." : "'Schedule'.") : "'Light'.")}</p>`;
  }

  d_fp(d) {
    const ev = this.cfg.timers.filter((t) => t.mode === "event" && this.timerUsed(t));
    const users = this.usersOf("filter", d.n);
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name))}
      ${this.field("Length", this.ctl("num", this.d("minutes"), d.minutes, { step: 1, min: 1, max: this.L.feed_pause_max_min, u: "min" }), `1–${this.L.feed_pause_max_min} minutes`)}
      ${this.field("Turn off its outlets", this.ctl("bool", this.d("filter_off"), d.filter_off), "Outlets set to this feed pause turn OFF while it runs")}
      ${this.field("Start automatically", this.ctl("select", this.d("timer"), d.timer, { numeric: 1, options: [[0, "No — start it by hand"], ...ev.map((t) => [t.n, `${t.name || "Timer " + t.n} · ${this.periodsText(t.entries)}`])] }), ev.length ? "" : "To start it on a schedule, create a 'Start events' timer on the Schedules tab")}
      <div class="lbl">Outlets affected</div><p class="hint">${users.length ? users.map((c) => esc(this.chName(c))).join(" · ") : "None yet. On the Outlets tab, choose 'Feed pause' for the outlets to stop."}</p>`;
  }
  d_mt(d) {
    const used = this.usedChannels();
    const rows = (d.sockets || []).map((s, i) => `<div class="prow">${this.ctl("select", this.d(`sockets.${i}.ch`), s.ch, { numeric: 1, options: (used.length ? used : this.cfg.channels.slice(0, 1)).map((c) => [c.n, this.chName(c)]) })}
      ${this.ctl("seg", this.d(`sockets.${i}.state`), s.state, { options: [["off", "OFF"], ["on", "ON"]] })}<span class="grow"></span>${this.btn("sock_del", "", { i }, "ghost sm icon", "mdi:close")}</div>`).join("");
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: "e.g. Water change" }))}
      ${this.field("Length", this.ctl("num", this.d("minutes"), d.minutes, { step: 1, min: 1, max: this.L.maintenance_max_min, u: "min" }), `Up to ${this.L.maintenance_max_min} minutes`)}
      <div class="lbl">While it runs</div>${rows || `<p class="hint">No outlets yet.</p>`}<div>${this.btn("sock_add", "Add outlet", {}, "ghost sm", "mdi:plus")}</div>
      <div class="lbl">Power cut</div>
      ${this.field("Run during a power cut", this.ctl("bool", this.d("power_cut"), d.power_cut, { r: 1 }), "Becomes the emergency program. Detection is set on the Setup tab")}
      ${d.power_cut ? this.field("When power returns", this.ctl("seg", this.d("after_power"), d.after_power, { options: [["stop", "End it"], ["run_duration", "Finish its length"]] })) : ""}`;
  }
  d_circuit(d) {
    const sOpts = [[0, "— choose —"], ...this.cfg.level_sensors.filter((s) => s.entity).map((s) => [s.n, `Sensor ${s.n} · ${s.name || this.ename(s.entity)}`])];
    const two = ["minmax", "ato2", "wc", "ato_wc"].includes(d.mode), ato = ["ato", "minmax", "ato2", "ato_wc"].includes(d.mode), wc = ["wc", "ato_wc"].includes(d.mode);
    const nT = this.cfg.timers.filter((t) => t.mode === "normal" && this.timerUsed(t)), eT = this.cfg.timers.filter((t) => t.mode === "event" && this.timerUsed(t));
    const tiles = Object.entries(LEVEL).filter(([k]) => k !== "off").map(([k, m]) => `<button type="button" class="ftile ${d.mode === k ? "on" : ""}" aria-pressed="${d.mode === k}" data-act="lvlmode" data-mode="${k}">${this.icon(m.icon)}<b>${esc(m.label)}</b><small>${esc(m.desc)}</small></button>`).join("");
    if (sOpts.length === 1) return `<div class="note warn">${this.icon("mdi:information-outline")}<span>Add a level sensor first — a float, optical or leak sensor from any controller.</span>${this.btn("goto", "Add sensor", { to: "water", kind: "lsensor", n: this.nextFree("level_sensors", (s) => s.entity) || 1 }, "link")}</div>`;
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: d.mode === "leak" ? "e.g. Sump leak" : "e.g. ATO" }))}
      <div class="lbl">Mode</div><div class="ftiles">${tiles}</div>
      <div class="detail">
      ${this.field(two ? (d.mode === "ato2" ? "Sensor 1" : "Lower sensor (min)") : "Sensor", this.ctl("select", this.d("sensor1"), d.sensor1, { numeric: 1, options: sOpts }))}
      ${two ? this.field(d.mode === "ato2" ? "Sensor 2" : "Upper sensor (max)", this.ctl("select", this.d("sensor2"), d.sensor2, { numeric: 1, options: sOpts })) : ""}
      ${d.mode !== "leak" ? this.field("Maximum on-time", this.ctl("num", this.d("max_on_s"), d.max_on_s, { step: 1, min: 0, u: "s" }), "Failsafe: alarm and pump OFF if it runs longer. 0 turns this off") : ""}
      ${this.field("Clear the alarm by itself", this.ctl("bool", this.d("auto_reset"), d.auto_reset), "Off: outlets stay off until you press Reset")}
      ${ato ? this.field("ATO always allowed", this.ctl("bool", this.d("ato_always"), d.ato_always, { r: 1 })) : ""}
      ${ato && !d.ato_always ? this.field("Only during", this.ctl("select", this.d("ato_timer"), d.ato_timer, { numeric: 1, options: [[0, "— choose a schedule —"], ...nT.map((t) => [t.n, `${t.name || "Timer " + t.n} · ${this.periodsText(t.entries)}`])] })) : ""}
      ${wc ? this.field("Start water change", this.ctl("select", this.d("wc_timer"), d.wc_timer, { numeric: 1, options: [[0, "By hand only"], ...eT.map((t) => [t.n, `${t.name || "Timer " + t.n} · ${this.periodsText(t.entries)}`])] })) : ""}
      </div>
      <div class="lbl">Outlets</div><p class="hint">${this._circuitUsers(d.n, d.mode)}</p>`;
  }
  _circuitUsers(n, mode) {
    const need = mode === "leak" ? ["fill_water"] : ["wc", "ato_wc"].includes(mode) ? ["drain_water", "fill_awc", ...(mode === "ato_wc" ? ["fill_ato"] : [])] : ["fill_ato"];
    return need.map((t) => { const us = this.usersOf(t, n); return `<b>${esc(funcOf({ type: t }).label)}</b>: ${us.length ? us.map((c) => esc(this.chName(c))).join(", ") : "none yet — choose it on the Outlets tab"}`; }).join("<br>");
  }
  d_lsensor(d) {
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: "e.g. Sump low float" }))}
      <div class="lbl">Source</div>${this.picker("entity", d.entity, ["binary_sensor", "sensor", "switch", "input_boolean"], "Choose a float, optical or leak sensor…")}
      ${this.field("Water present when state is", this.ctl("text", this.d("wet_states"), d.wet_states, { ph: "on" }), "Comma separated")}
      ${this.field("…or dry when state is", this.ctl("text", this.d("dry_states"), d.dry_states, { ph: "e.g. Normal" }), "For sensors that report a dry state, like the Mini leak sensor ('Normal'). Overrides the line above")}
      ${this.field("Invert", this.ctl("bool", this.d("invert"), d.invert), "For a low-level float that should trip when it leaves the water")}
      ${this.field("Reaction time", this.ctl("num", this.d("reaction_s"), d.reaction_s, { step: 1, min: 0, u: "s" }), "Must hold a state this long before it counts")}`;
  }
  gateText(g) {
    const i = (x) => `${x?.invert ? "NOT " : ""}${this.fnText(x)}`;
    if (g.op === "delayed_on" || g.op === "delayed_off") return `${OPS[g.op].label} ${g.seconds}s · ${i(g.in1)}`;
    return `${i(g.in1)} ${OPS[g.op].label} ${i(g.in2)}`;
  }
  _gateInput(x, base) {
    const sel = funcOf(x);
    return `<div class="detail"><div class="gin">${this.ctl("select", `data-d="${base}.key"`, sel.key, { r: 1, options: FUNCS.map((f) => [f.key, f.label]) })}
      ${this.ctl("seg", this.d(`${base}.invert`), x.invert ? 1 : 0, { numeric: 1, options: [[0, "As is"], [1, "NOT"]] })}</div>${this._fnDetail(x, base)}</div>`;
  }
  d_gate(d) {
    ["in1", "in2"].forEach((k) => {
      if (d[k]?.key) { const f = FUNCS.find((y) => y.key === d[k].key); const same = d[k].type === f.type && (d[k].mode || "") === (f.mode || ""); d[k] = { type: f.type, mode: f.mode || "", param: same ? d[k].param : this._defaultParam(f.type), invert: !!d[k].invert }; }
      if (d[k]) d[k].invert = !!Number(d[k].invert);
    });
    const del = d.op === "delayed_on" || d.op === "delayed_off";
    const users = this.usersOf("logic", d.n).map((c) => this.chName(c));
    return `${this.field("Name", this.ctl("text", this.d("name"), d.name, { ph: "e.g. Skimmer after maintenance" }))}
      <div class="lbl">Operator</div>${this.ctl("seg", this.d("op"), d.op, { options: Object.entries(OPS).map(([k, o]) => [k, o.label]) })}<p class="hint">${esc(OPS[d.op].desc)}</p>
      <div class="lbl">${del ? "Input" : "Input 1"}</div>${this._gateInput(d.in1 || {}, "in1")}
      ${del ? this.field("Duration", this.ctl("num", this.d("seconds"), d.seconds, { step: 1, min: 0, u: "s" })) : `<div class="lbl">Input 2</div>${this._gateInput(d.in2 || {}, "in2")}`}
      <div class="preview" data-preview></div>
      <div class="lbl">Used by</div><p class="hint">${users.length ? users.map(esc).join(" · ") : "No outlet yet — on the Outlets tab choose 'Logic gate'."}</p>`;
  }
  d_reminder(d) {
    return `${this.field("Reminder", this.ctl("text", this.d("text"), d.text, { ph: "e.g. Replace carbon" }))}
      ${this.field("Every", this.ctl("num", this.d("days"), d.days, { step: 1, min: 0, u: "days" }))}
      ${this.field("Counting from", this.ctl("date", this.d("start"), d.start) + this.btn("today", "Today", { path: "start" }, "ghost sm"))}
      ${this.field("Repeat", this.ctl("bool", this.d("repeat"), d.repeat), "Off: shows once, then turns itself off")}
      ${this.field("On", this.ctl("bool", this.d("enabled"), d.enabled))}`;
  }

  // ------------------------------------------------------------------ page forms
  form(name, sections) {
    if (!this.forms[name]) { const draft = {}; sections.forEach((s) => (draft[s] = this.cfg[s] === undefined ? undefined : clone(this.cfg[s]))); this.forms[name] = { draft, sections, dirty: false }; }
    return this.forms[name].draft;
  }
  _formBar(name) { const el = this.shadowRoot.querySelector(`[data-formbar="${name}"]`); if (el) el.outerHTML = this.formBar(name); }
  formBar(name) { const F = this.forms[name]; return `<div class="formbar ${F?.dirty ? "on" : ""}" data-formbar="${name}">${F?.dirty ? `<span>Unsaved changes</span>${this.btn("form_revert", "Revert", { form: name }, "ghost sm")}${this.btn("form_save", "Save", { form: name }, "primary sm")}` : ""}</div>`; }
  async _saveForm(name) {
    const F = this.forms[name];
    try {
      for (const s of F.sections) { const r = await this._hass.callWS({ type: "sentinel_controller/save", section: s, value: F.draft[s] }); this.cfg = r.config; this.status = r.status; }
      delete this.forms[name]; this._toast("Saved"); this._render();
    } catch (e) { this._toast(`Not saved: ${e.message || e}`, true); }
  }

  // ------------------------------------------------------------------ live updates
  _live() {
    const sr = this.shadowRoot; if (!sr || !this.cfg) return;
    sr.querySelectorAll(".page [data-live], .hdr [data-live]").forEach((el) => { const h = this._liveHTML(el.dataset.live); if (h != null && el.innerHTML !== h) el.innerHTML = h; });
  }
  _liveHTML(key) {
    const i = key.indexOf(":"); const k = i < 0 ? key : key.slice(0, i), a = i < 0 ? "" : key.slice(i + 1);
    switch (k) {
      case "clock": return esc(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      case "bell": { const n = this.st(["alarms"], []).length; return `${this.icon(n ? "mdi:bell-ring" : "mdi:bell-outline")}${n ? `<b>${n}</b>` : ""}`; }
      case "alarms": return this._alarmBanner();
      case "ch": return this._chState(this.item("channels", a));
      case "probe": { const p = this.probe(a); return p ? this._probeLive(p) : ""; }
      case "fp": return this._fpLive(this.item("feed_pauses", a));
      case "mt": return this._mtLive(this.item("maintenance", a));
      case "lvl": return this._lvlLive(this.item("level_circuits", a));
      case "sens": { const s = this.item("level_sensors", a); const v = this.st(["level_sensors", a]); return s?.entity ? (v == null ? `<span class="chip warn">No data</span>` : v ? `<span class="chip info">${this.icon("mdi:water")}Water</span>` : `<span class="chip">${this.icon("mdi:water-off-outline")}Dry</span>`) : ""; }
      case "gate": return this.pill(this.st(["logic", a]));
      case "pump": { const j = a.lastIndexOf(":"); return this._pumpLive(a.slice(0, j), a.slice(j + 1)); }
      case "doserhead": { const d = this.dosers().find((x) => x.device_id === a); return d ? this.doserHead(d) : ""; }
      case "ent": { const st = this._hass.states[a]; if (!st) return `<span class="chip bad">missing</span>`; const v = String(st.state).toLowerCase();
        return ["on", "off"].includes(v) ? this.pill(v === "on") : ["unavailable", "unknown"].includes(v) ? `<span class="chip warn">${esc(st.state)}</span>` : `<span class="chip">${esc(st.state)}</span>`; }
      case "tl": { const [sec, n] = a.split("-"); const x = this.item(sec, n); return x ? this.timeline(x.entries, x.mode === "event" ? "event" : "normal", sec === "illumination" ? x.color : "#0069b4") : ""; }
      case "tmr": { const t = this.item("timers", a); return t?.mode === "normal" ? this.pill(this.st(["timers", a])) : `<span class="chip">Events</span>`; }
      case "lgt": return this.pill(this.st(["illumination", a]));
      case "override": return this.cfg.manual_override ? `<div class="banner warn">${this.icon("mdi:hand-back-right")}<span><b>Manual override is on.</b> Outlets hold the state you set by hand instead of following their programs.</span>${this.btn("override", "Turn off", {}, "ghost sm")}</div>` : "";
      case "power": return this.st(["power_cut"]) ? `<div class="banner bad">${this.icon("mdi:flash-off")}<span><b>Power cut.</b> The emergency program is running.</span></div>` : "";
      case "pcstate": return this.pill(this.st(["power_cut"]), "POWER CUT", "OK");
    }
    return null;
  }
  _chState(c) {
    if (!c) return "";
    const s = this.st(["channels", c.n], {});
    const mism = c.entity && s.actual != null && s.actual !== s.out;
    const unav = c.entity && s.actual == null && !s.conflict;
    const why = this.whyText(c);
    let sub = "";
    if (s.conflict) sub = `<small class="badc">${this.icon("mdi:alert")}conflict</small>`;
    else if (mism) sub = `<small class="warnc">${this.icon("mdi:sync-alert")}device ${s.actual ? "on" : "off"}</small>`;
    else if (unav) sub = `<small class="badc">${this.icon("mdi:lan-disconnect")}offline</small>`;
    else if (why) sub = `<small>${esc(why)}</small>`;
    return `${this.pill(s.out)}${sub}`;
  }
  _probeLive(p) {
    const v = this.st(["probes", p.id, "value"]), u = this.unit(p);
    return `<div class="pv"><span class="big">${v == null ? "—" : Number(v).toFixed(p.kind === "ph" ? 2 : 1)}</span><span class="u">${esc(u)}</span>${this.stateChip(p)}</div>${this.bandBar(p)}`;
  }
  _fpLive(f) {
    if (!f) return "";
    const end = this.st(["feed_pauses", f.n]); const rem = this.remaining(end); const on = !!end && rem > 0;
    const pct = on ? 100 - (rem / (f.minutes * 60)) * 100 : 0;
    return `<div class="mode-st">${on ? `<span class="cd">${this.mmss(rem)}</span><span class="muted">left</span>` : `<span class="muted">${f.minutes} min</span>`}</div>
      <div class="prog"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
      ${this.btn("fp", on ? "Stop" : "Start", { n: f.n, on: on ? 1 : 0 }, on ? "warn" : "primary", on ? "mdi:stop" : "mdi:play")}`;
  }
  _mtLive(m) {
    if (!m) return "";
    const s = this.st(["maintenance", m.n]); const on = !!s; const rem = s?.end ? this.remaining(s.end) : 0;
    const pct = on && !s.power ? 100 - (rem / (m.minutes * 60)) * 100 : on ? 100 : 0;
    return `<div class="mode-st">${on ? (s.power ? `<span class="chip bad">Power-cut program</span>` : `<span class="cd">${this.mmss(rem)}</span><span class="muted">left</span>`) : `<span class="muted">${m.minutes} min</span>`}</div>
      <div class="prog"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
      ${this.btn("mt", on ? "Stop" : "Start", { n: m.n, on: on ? 1 : 0 }, on ? "warn" : "primary", on ? "mdi:stop" : "mdi:play")}`;
  }
  _lvlLive(c) {
    if (!c) return "";
    const s = this.st(["level", c.n], {}); const wc = ["wc", "ato_wc"].includes(c.mode);
    const out = [];
    if (s.error) out.push(`<span class="chip bad">${this.icon("mdi:alert")}${esc(s.error)}</span>`);
    else if (c.mode === "leak") out.push(s.fill_water === false ? `<span class="chip bad">Leak</span>` : s.fill_water == null ? `<span class="chip warn">No data</span>` : `<span class="chip ok">Dry</span>`);
    if (["ato", "minmax", "ato2", "ato_wc"].includes(c.mode) && !s.error) out.push(`<span class="chip ${s.fill_ato ? "info" : ""}">ATO ${s.fill_ato ? "filling" : s.fill_ato == null ? "no data" : "idle"}</span>`);
    if (wc && s.phase) out.push(`<span class="chip info">Water change: ${esc(s.phase === "drain" ? "draining" : "filling")}</span>`);
    const btns = (s.error ? this.btn("reset", "Reset", { n: c.n }, "warn sm", "mdi:restore") : "") + (wc && !s.error ? this.btn("wc", s.phase ? "Stop water change" : "Start water change", { n: c.n, on: s.phase ? 1 : 0 }, s.phase ? "warn sm" : "ghost sm", "mdi:water-sync") : "");
    return `<div class="chips">${out.join("")}</div>${btns ? `<div class="row-btns">${btns}</div>` : ""}`;
  }
  _alarmBanner() {
    const al = this.st(["alarms"], []);
    if (!al.length) return "";  // nothing to show: the bell already says all is well
    return `<div class="banner bad list">${al.map((a) => {
      let act = "";
      if (a.reminder) act = this.btn("ack", "Done", { n: a.reminder }, "ghost sm");
      else if (/^level_\d+$/.test(a.key)) act = this.btn("reset", "Reset", { n: a.key.split("_")[1] }, "ghost sm");
      else if (/^probe_/.test(a.key)) act = this.btn("goto", "Open probe", { to: "probes", kind: "probe", n: a.key.replace(/^probe_/, "").replace(/_fault$/, "") }, "link");
      else if (/^channel_\d+/.test(a.key)) act = this.btn("goto", "Open outlet", { to: "outlets", kind: "channel", n: a.key.split("_")[1] }, "link");
      return `<div class="al">${this.icon(a.reminder ? "mdi:calendar-alert" : "mdi:alert")}<span>${esc(a.text)}</span>${act}</div>`;
    }).join("")}</div>`;
  }

  // ------------------------------------------------------------------ render
  _toast(text, bad = false) {
    const t = document.createElement("div"); t.className = `toast ${bad ? "bad" : ""}`; t.setAttribute("role", "status"); t.textContent = text;
    this.shadowRoot.appendChild(t); setTimeout(() => t.classList.add("in"), 10); setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, bad ? 5000 : 2200);
  }
  _render() {
    const sr = this.shadowRoot;
    if (this.err) { sr.innerHTML = `${STYLE}<div class="root"><div class="card pad">${esc(this.err)}</div></div>`; return; }
    if (!this.cfg) { sr.innerHTML = `${STYLE}<div class="root"><div class="card pad">Loading…</div></div>`; return; }
    const tabs = TABS.map(([k, l, i]) => `<button type="button" class="tab ${this.tab === k ? "on" : ""}" aria-current="${this.tab === k ? "page" : "false"}" data-tab="${k}">${this.icon(i)}<span>${l}</span></button>`).join("");
    const page = this["p_" + this.tab].call(this);
    const drawer = sr.querySelector(".drawer-wrap");
    sr.innerHTML = `${STYLE}<div class="root">
      <div class="hdr"><div class="ttl"><div class="ttop"><b>Sentinel Controller</b><small class="ver" title="Sentinel Controller version">v${VERSION}</small></div><span data-live="clock"></span></div>
        <button type="button" class="bell" data-tab="alerts" aria-label="Alerts" data-live="bell"></button></div>
      ${this.running && this.running !== VERSION ? `<div class="banner warn">${this.icon("mdi:restart")}<span>Sentinel Controller ${esc(VERSION)} is installed, but Home Assistant is still running ${esc(this.running)}. Restart Home Assistant to finish the update.</span></div>` : ""}
      <nav class="tabs" aria-label="Sections">${tabs}</nav>
      <div class="page">${page}</div></div>`;
    if (drawer) sr.appendChild(drawer);
    this._live();
  }

  // ------------------------------------------------------------------ pages
  p_overview() {
    const probes = this.cfg.probes.map((p) => `<button type="button" class="card probe" data-act="open" data-kind="probe" data-n="${esc(p.id)}"><span class="cap">${esc(this.edev(p.entity) || p.kind)}</span><b class="pn">${esc(p.name || p.id)}</b><div data-live="probe:${esc(p.id)}"></div></button>`).join("");
    const outs = this.usedChannels().filter((c) => c.entity);
    const fps = this.cfg.feed_pauses.filter((f) => f.n === 1 || this.usersOf("filter", f.n).length || f.name !== `Feed pause ${f.n}`);
    const mts = this.cfg.maintenance.filter((m) => (m.sockets || []).length || m.name !== `Maintenance ${m.n}`);
    const modes = [...fps.map((f) => `<div class="card mode"><div class="mh">${this.icon("mdi:fish")}<b>${esc(f.name || "Feed pause " + f.n)}</b></div><div data-live="fp:${f.n}"></div></div>`),
      ...mts.map((m) => `<div class="card mode"><div class="mh">${this.icon("mdi:wrench-outline")}<b>${esc(m.name || "Maintenance " + m.n)}</b></div><div data-live="mt:${m.n}"></div></div>`)].join("");
    const water = this.cfg.level_circuits.filter((c) => c.mode !== "off").map((c) => `<div class="card lvl"><button type="button" class="lh" data-act="open" data-kind="circuit" data-n="${c.n}">${this.icon(LEVEL[c.mode].icon, "ic")}<div><b>${esc(c.name || LEVEL[c.mode].label)}</b><small>${esc(LEVEL[c.mode].label)}</small></div></button><div data-live="lvl:${c.n}"></div></div>`).join("");
    const nextCh = this.nextFree("channels", (c) => c.entity || c.name);
    return `<div data-live="power"></div><div data-live="override"></div><div data-live="alarms"></div>
      ${this.sec("Probes", this.btn("goto", "Manage", { to: "probes" }, "link"))}
      <div class="grid g4">${probes || this.empty("mdi:thermometer-plus", "No probes yet", "Add temperature and pH from any controller — GHL, HYDROS, Apex.", this.btn("goto", "Add a probe", { to: "probes", kind: "probe", n: "new" }, "primary"))}</div>
      ${this.sec("Feed & maintenance", this.btn("goto", "Manage", { to: "modes" }, "link"))}
      <div class="grid g4">${modes}</div>
      ${this.sec("Outlets", this.btn("goto", "Manage", { to: "outlets" }, "link"))}
      <div class="grid g3">${outs.map((c) => this._outletCard(c)).join("") || this.empty("mdi:power-socket-us", "No outlets yet", "Pick any switch or smart plug and choose what it does.", nextCh ? this.btn("goto", "Add an outlet", { to: "outlets", kind: "channel", n: nextCh }, "primary") : "")}</div>
      ${this.controllers().map((c) => this.ctrlSection(c)).join("")}
      ${this.dosers().length ? this.doserSections(this.dosers()) : ""}
      ${water ? `${this.sec("Water", this.btn("goto", "Manage", { to: "water" }, "link"))}<div class="grid g3">${water}</div>` : ""}`;
  }
  _outletCard(c) {
    const f = funcOf(c.fn);
    const manual = this.cfg.manual_override ? `<div class="manual"><span class="muted">By hand</span>${this.ctl("seg", `data-man="${c.n}"`, c.manual === "on" ? "on" : "off", { options: [["off", "OFF"], ["on", "ON"]] }).replace(/data-act="seg"/g, `data-act="manual" data-n="${c.n}"`)}</div>` : "";
    return `<div class="card outlet"><button type="button" class="oc" data-act="open" data-kind="channel" data-n="${c.n}">
      <span class="oi">${this.icon(f.icon)}</span>
      <span class="ot"><span class="cap">Outlet ${c.n}${c.entity ? " · " + esc(this.edev(c.entity) || this.ename(c.entity)) : ""}</span><b>${esc(c.name || this.ename(c.entity) || "Outlet " + c.n)}</b><small>${esc(this.fnText(c.fn))}</small></span>
      <span class="os" data-live="ch:${c.n}"></span></button>${manual}</div>`;
  }
  p_outlets() {
    const used = this.usedChannels(); const next = this.nextFree("channels", (c) => c.entity || c.name);
    return `<div data-live="override"></div>
      <div class="toolbar">${next && used.length ? this.btn("open", "Add outlet", { kind: "channel", n: next }, "primary", "mdi:plus") : ""}
        <span class="grow"></span><span class="muted">${used.length} of ${this.L.channels} in use</span>
        ${this.btn("override", this.cfg.manual_override ? "Manual override: ON" : "Manual override", {}, this.cfg.manual_override ? "warn" : "ghost", "mdi:hand-back-right-outline")}</div>
      ${this.sec("Sentinel outlets")}
      <div class="grid g3">${used.map((c) => this._outletCard(c)).join("") || this.empty("mdi:power-socket-us", "No Sentinel outlets yet", "A Sentinel outlet is any switch, smart plug or relay that Sentinel Controller runs — a KP303 socket, a HYDROS output, a Shelly. Add one, or take over a controller outlet below.", next ? this.btn("open", "Add outlet", { kind: "channel", n: next }, "primary", "mdi:plus") : "")}</div>
      ${this.controllers().map((c) => this.ctrlSection(c)).join("")}
      <p class="hint">Outlet sources shown here are chosen on the Setup tab.</p>`;
  }
  p_probes() {
    const cards = this.cfg.probes.map((p) => {
      const [lo, hi] = this.points(p), u = this.unit(p);
      const n = this.cfg.channels.filter((c) => ["temperature", "ph"].includes(c.fn?.type) && c.fn.param === p.id).length;
      return `<button type="button" class="card probe" data-act="open" data-kind="probe" data-n="${esc(p.id)}"><span class="cap">${esc([this.edev(p.entity), p.entity].filter(Boolean).join(" · ") || "no sensor")}</span><b class="pn">${esc(p.name || p.id)}</b>
        <div data-live="probe:${esc(p.id)}"></div>
        <div class="kv"><span>Setpoint <b>${fmt(p.nominal)}${esc(u)}</b></span><span>Switches <b>${fmt(lo)}–${fmt(hi)}</b></span><span>Alarm <b>${p.alarm?.active ? `±${fmt(p.alarm.deviation)}` : "off"}</b></span><span>Outlets <b>${n}</b></span></div></button>`;
    }).join("");
    return `<div class="toolbar">${this.cfg.probes.length < this.L.probes ? this.btn("open", "Add probe", { kind: "probe", n: "new" }, "primary", "mdi:plus") : ""}<span class="grow"></span><span class="muted">Any temperature or pH sensor in Home Assistant, from any controller</span></div>
      <div class="grid g3">${cards || this.empty("mdi:thermometer-plus", "No probes yet", "A probe gives heaters, coolers and pH outlets their setpoint, and raises alarms.", this.btn("open", "Add probe", { kind: "probe", n: "new" }, "primary", "mdi:plus"))}</div>
      <p class="hint">Band: blue = where outlets switch, red = alarm zone, marker = now.</p>`;
  }
  p_schedules() {
    const ts = this.cfg.timers.filter((t) => this.timerUsed(t)), ls = this.cfg.illumination.filter((t) => this.timerUsed(t));
    const nt = this.nextFree("timers", (t) => this.timerUsed(t)), nl = this.nextFree("illumination", (t) => this.timerUsed(t));
    const days = (x) => (x.day_mode === "interval" ? `every ${x.every_days} days` : (x.weekdays || []).length === 7 ? "every day" : (x.weekdays || []).map((d) => WD[d]).join(" "));
    const card = (x, kind, sec) => `<button type="button" class="card sched" data-act="open" data-kind="${kind}" data-n="${x.n}">
      <div class="sh">${kind === "light" ? `<i class="dot" style="background:${esc(x.color)}"></i>` : this.icon(x.mode === "event" ? "mdi:play-circle-outline" : "mdi:timer-outline", "ic")}<div><b>${esc(x.name || (kind === "light" ? "Light " : "Timer ") + x.n)}</b><small>${esc(kind === "light" ? this.periodsText(x.entries) + (x.temp_reduction ? " · heat protection" : "") : (x.mode === "event" ? "Start events · " : "") + this.periodsText(x.entries) + " · " + days(x))}</small></div>
      <span data-live="${kind === "light" ? "lgt" : "tmr"}:${x.n}"></span></div><div data-live="tl:${sec}-${x.n}"></div></button>`;
    const F = this.form("lightred", ["light_reduction"]); const lr = F.light_reduction; const tp = this.cfg.probes.filter((p) => p.kind === "temperature");
    return `${this.sec("Timers", nt ? this.btn("open", "New timer", { kind: "timer", n: nt }, "link", "mdi:plus") : "")}
      <div class="grid g2">${ts.map((t) => card(t, "timer", "timers")).join("") || this.empty("mdi:timer-plus-outline", "No timers", "Run a skimmer or reactor on a schedule, or start a feed pause or water change at set times.", nt ? this.btn("open", "New timer", { kind: "timer", n: nt }, "primary", "mdi:plus") : "")}</div>
      ${this.sec("Lights (on/off)", nl ? this.btn("open", "New light schedule", { kind: "light", n: nl }, "link", "mdi:plus") : "")}
      <div class="grid g2">${ls.map((t) => card(t, "light", "illumination")).join("") || this.empty("mdi:lightbulb-on-outline", "No light schedules", "For non-dimmable lights: refugium, T5, frag light.", nl ? this.btn("open", "New light schedule", { kind: "light", n: nl }, "primary", "mdi:plus") : "")}</div>
      ${this.sec("Heat protection for lights")}
      <div class="card pad form">${this.formBar("lightred")}
        ${this.field("Temperature probe", this.ctl("select", this.f("lightred", "light_reduction.probe"), lr.probe, { options: [["", "Off"], ...tp.map((p) => [p.id, p.name || p.id])] }))}
        ${this.field("Turn lights off at setpoint +", this.ctl("num", this.f("lightred", "light_reduction.limit"), lr.limit, { step: 0.1, min: 0, u: this.unit(this.probe(lr.probe)) }), "Light schedules with 'Turn off when too warm' stay OFF for the rest of the day")}
        ${this.st(["light_reduction_today"]) ? `<div class="note warn">${this.icon("mdi:thermometer-alert")}<span>Triggered today — those lights stay off until midnight.</span></div>` : ""}</div>`;
  }
  p_modes() {
    const fps = this.cfg.feed_pauses.map((f) => `<div class="card mode"><div class="mh">${this.icon("mdi:fish")}<b>${esc(f.name || "Feed pause " + f.n)}</b>${this.btn("open", "", { kind: "fp", n: f.n }, "ghost sm icon", "mdi:pencil")}</div>
      <small class="muted">${this.usersOf("filter", f.n).length} outlet(s)${Number(f.timer) ? " · starts on a schedule" : ""}</small><div data-live="fp:${f.n}"></div></div>`).join("");
    const mts = this.cfg.maintenance.map((m) => `<div class="card mode"><div class="mh">${this.icon(m.power_cut ? "mdi:flash-alert-outline" : "mdi:wrench-outline")}<b>${esc(m.name || "Maintenance " + m.n)}</b>${this.btn("open", "", { kind: "mt", n: m.n }, "ghost sm icon", "mdi:pencil")}</div>
      <small class="muted">${esc((m.sockets || []).map((s) => `${s.state === "on" ? "ON" : "OFF"} ${this.item("channels", s.ch)?.name || "outlet " + s.ch}`).join(" · ") || "No outlets yet")}${m.power_cut ? " · power-cut program" : ""}</small><div data-live="mt:${m.n}"></div></div>`).join("");
    return `${this.sec("Feed pause")}<div class="grid g4">${fps}</div>${this.sec("Maintenance")}<div class="grid g4">${mts}</div>
      <p class="hint">Want the skimmer to wait after maintenance or a feed pause? Use a Delayed OFF or Delayed ON gate on the Logic tab.</p>`;
  }
  p_water() {
    const cs = this.cfg.level_circuits.filter((c) => c.mode !== "off"), nc = this.nextFree("level_circuits", (c) => c.mode !== "off");
    const ss = this.cfg.level_sensors.filter((s) => s.entity), ns = this.nextFree("level_sensors", (s) => s.entity);
    return `${this.sec("Circuits", nc && ss.length ? this.btn("open", "New circuit", { kind: "circuit", n: nc }, "link", "mdi:plus") : "")}
      <div class="grid g2">${cs.map((c) => `<div class="card lvl"><button type="button" class="lh" data-act="open" data-kind="circuit" data-n="${c.n}">${this.icon(LEVEL[c.mode].icon, "ic")}<div><b>${esc(c.name || LEVEL[c.mode].label)}</b><small>${esc(LEVEL[c.mode].label)} · ${esc([c.sensor1, c.sensor2].filter(Number).map((n) => this.item("level_sensors", n)?.name || "sensor " + n).join(" / "))}</small></div>${this.icon("mdi:chevron-right", "muted")}</button><div data-live="lvl:${c.n}"></div></div>`).join("") || this.empty("mdi:waves-arrow-up", "No circuits", ss.length ? "ATO, water changes and leak shutoff." : "ATO, water changes and leak shutoff. Add your sensors below first.", ss.length && nc ? this.btn("open", "New circuit", { kind: "circuit", n: nc }, "primary", "mdi:plus") : "")}</div>
      ${this.sec("Sensors", ns ? this.btn("open", "Add sensor", { kind: "lsensor", n: ns }, "link", "mdi:plus") : "")}
      <div class="grid g3">${ss.map((s) => `<button type="button" class="card sens" data-act="open" data-kind="lsensor" data-n="${s.n}"><div><span class="cap">Sensor ${s.n}${this.edev(s.entity) ? " · " + esc(this.edev(s.entity)) : ""}</span><b>${esc(s.name || this.ename(s.entity))}</b></div><span data-live="sens:${s.n}"></span></button>`).join("") || this.empty("mdi:water-outline", "No sensors", "Floats, optical sensors and leak sensors from any controller.", ns ? this.btn("open", "Add sensor", { kind: "lsensor", n: ns }, "primary", "mdi:plus") : "")}</div>`;
  }
  p_dosers() {
    const ds = this.dosers();
    if (!ds.length) return this.empty("mdi:beaker-outline", "No dosers found", "Dosers appear here automatically when their pumps are in Home Assistant (for example through your GHL bridge).");
    return this.doserSections(ds)
      + `<p class="hint">Container level and volume come from the doser; mL/day is what left each container in the last 24 hours. Colors: red under 15 %, amber under 30 %. Section names are set on the Setup tab. Dosing schedules and calibration stay on the doser.</p>`;
  }
  p_logic() {
    const gs = this.cfg.logic.filter((g) => this.gateUsed(g)), ng = this.nextFree("logic", (g) => this.gateUsed(g));
    return `<div class="toolbar">${ng ? this.btn("open", "New gate", { kind: "gate", n: ng }, "primary", "mdi:plus") : ""}<span class="grow"></span><span class="muted">Combine functions for one outlet</span></div>
      <div class="grid g2">${gs.map((g) => `<button type="button" class="card gate" data-act="open" data-kind="gate" data-n="${g.n}"><div class="gh"><span class="op">${esc(OPS[g.op].label)}</span><b>${esc(g.name || "Gate " + g.n)}</b><span data-live="gate:${g.n}"></span></div><small>${esc(this.gateText(g))}</small><small class="muted">${esc(this.usersOf("logic", g.n).map((c) => this.chName(c)).join(", ") || "Not used by an outlet yet")}</small></button>`).join("")
        || this.empty("mdi:gate-and", "No logic gates", "Examples from the GHL guide: skimmer OFF during a feed pause AND when the sump is too high; skimmer stays off 10 minutes after maintenance (Delayed OFF).", ng ? this.btn("open", "New gate", { kind: "gate", n: ng }, "primary", "mdi:plus") : "")}</div>`;
  }
  p_alerts() {
    const rs = this.cfg.reminders.filter((r) => r.text), nr = this.nextFree("reminders", (r) => r.text);
    const F = this.form("notify", ["notify"]); const n = F.notify;
    const svcs = Object.keys(this._hass.services.notify || {}).map((s) => `notify.${s}`).sort();
    const tg = new Set(n.targets || []);
    const due = (r) => { if (!r.start) return ""; const d = Math.ceil((new Date(r.start).getTime() + r.days * 864e5 - Date.now()) / 864e5); return d <= 0 ? `<span class="chip bad">Due</span>` : `<span class="chip">in ${d} d</span>`; };
    return `<div data-live="alarms"></div>
      ${this.sec("Reminders", nr ? this.btn("open", "New reminder", { kind: "reminder", n: nr }, "link", "mdi:plus") : "")}
      <div class="grid g3">${rs.map((r) => `<button type="button" class="card rem" data-act="open" data-kind="reminder" data-n="${r.n}">${this.icon("mdi:calendar-alert", "ic")}<div><b>${esc(r.text)}</b><small>Every ${r.days} days${r.repeat ? "" : " · once"}${r.enabled ? "" : " · off"}</small></div>${r.enabled ? due(r) : ""}</button>`).join("") || this.empty("mdi:calendar-plus", "No reminders", "Carbon, GFO, probe calibration, filter socks…", nr ? this.btn("open", "New reminder", { kind: "reminder", n: nr }, "primary", "mdi:plus") : "")}</div>
      ${this.sec("Notifications")}
      <div class="card pad form">${this.formBar("notify")}
        <div class="lbl">Send to</div><div class="checks">${svcs.map((s) => `<label class="chk"><input type="checkbox" data-notify="${esc(s)}" ${tg.has(s) ? "checked" : ""}><span>${esc(s.replace("notify.", ""))}</span></label>`).join("") || `<p class="hint">No notify services in Home Assistant.</p>`}</div>
        ${this.field("New alarm", this.ctl("bool", this.f("notify", "notify.on_new_alarm"), n.on_new_alarm))}
        ${this.field("Alarm cleared", this.ctl("bool", this.f("notify", "notify.on_clear"), n.on_clear))}
        ${this.field("Repeat while active", this.ctl("num", this.f("notify", "notify.repeat_min"), n.repeat_min, { step: 1, min: 0, u: "min" }), "0 = don't repeat")}
        ${this.field("Daily status at", this.ctl("time", this.f("notify", "notify.daily_at"), n.daily_at), "Leave empty for none")}
        <p class="hint">For your own automations (Alexa, blinking lights): binary_sensor.sentinel_controller_alarm, plus feed pause, maintenance, water change and power cut sensors.</p></div>`;
  }
  srcGroup(title, list, chosen, F) {
    if (!list.length) return "";
    const rows = list.map((c) => {
      const on = chosen.has(c.device_id), ents = this.ctrlOutletEnts(c.device_id);
      const saved = F.controllers.find((x) => x.device_id === c.device_id), pick = new Set(saved && Array.isArray(saved.outlets) ? saved.outlets : ents);
      const n = on ? ents.filter((e) => pick.has(e)).length : ents.length;
      const names = F.outlet_names || {};
      const subs = on ? `<div class="onames">${ents.map((e) => `<div class="oname">${ents.length > 1
          ? `<label class="chk"><input type="checkbox" data-ctrlout="${esc(e)}" data-dev="${esc(c.device_id)}" ${pick.has(e) ? "checked" : ""}><span>${esc(this.shortName(e, c.name))}</span></label>`
          : `<span class="chk solo">${esc(this.shortName(e, c.name))}</span>`}
        <input type="text" data-oname="${esc(e)}" value="${esc(names[e] || "")}" placeholder="Name shown on the dashboard" aria-label="Name for ${esc(this.shortName(e, c.name))}"></div>`).join("")}</div>` : "";
      const fixer = this.editKinds ? `<select class="kindsel" data-kind="${esc(c.device_id)}" aria-label="Group for ${esc(c.name)}">${[["controller", "Reef controller"], ["strip", "Power strip or plug"], ["other", "Other device"]].map(([k, l]) => `<option value="${k}" ${c.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : "";
      return `<div class="src"><div class="srow"><label class="chk"><input type="checkbox" data-ctrl="${esc(c.device_id)}" data-name="${esc(c.name)}" ${on ? "checked" : ""}><span>${esc(c.name)} <small class="muted">${n}${on && n !== ents.length ? " of " + ents.length : ""}</small></span></label>${fixer}</div>${subs}</div>`;
    }).join("");
    return `<div class="lbl">${esc(title)}</div><div class="srcs">${rows}</div>`;
  }
  p_setup() {
    const F = this.form("setup", ["power_cut", "data_source", "data_timeout_min", "controllers", "source_kinds", "doser_sections", "doser_names", "outlet_names"]);
    if (!F.controllers.length && !this.forms.setup.ctrlInit) { F.controllers = this.controllers().map((c) => ({ ...c })); this.forms.setup.ctrlInit = true; }
    if (!F.source_kinds) F.source_kinds = {};  // card newer than the saved config
    if (!F.doser_sections) F.doser_sections = {};
    if (!F.doser_names) F.doser_names = {};
    if (!F.outlet_names) F.outlet_names = {};
    const chosen = new Set(F.controllers.map((c) => c.device_id));
    const cands = this.ctrlCandidates(), others = cands.filter((c) => c.kind === "other");
    const pc = F.power_cut, ds = F.data_source;
    const ents = (dom) => [["", "— none —"], ...Object.keys(this._hass.states).filter((e) => dom.includes(e.split(".")[0])).sort((a, b) => this.ename(a).localeCompare(this.ename(b))).map((e) => [e, `${this.ename(e)}${this.edev(e) ? " · " + this.edev(e) : ""}`])];
    return `${this.sec("Power cut")}<div class="card pad form">${this.formBar("setup")}
        ${this.field("Detect power cuts", this.ctl("bool", this.f("setup", "power_cut.enabled"), pc.enabled, { r: 1 }), "Runs maintenance modes marked 'Run during a power cut'")}
        ${pc.enabled ? `${this.field("Source", this.ctl("select", this.f("setup", "power_cut.entity"), pc.entity, { options: ents(["sensor", "binary_sensor", "input_boolean"]) }), "e.g. the inverter or EcoFlow AC input voltage")}
        ${this.field("Power is cut when", this.ctl("seg", this.f("setup", "power_cut.mode"), pc.mode, { options: [["below", "Value is below"], ["state", "State is"]] }))}
        ${pc.mode === "state" ? this.field("State", this.ctl("text", this.f("setup", "power_cut.state"), pc.state, { ph: "on" })) : this.field("Threshold", this.ctl("num", this.f("setup", "power_cut.threshold"), pc.threshold, { step: "any" }))}
        ${this.field("Now", `<span data-live="pcstate"></span>`)}` : ""}</div>
      ${this.sec("Outlet sources")}<div class="card pad form">
        <p class="hint">Reef controllers, power strips and smart plugs whose outlets appear on the Outlets and Overview tabs. Tick a source, then untick any of its switches you don't want to see (USB ports, unused sockets) and name the outlets you keep.</p>
        ${this.srcGroup("Reef controllers", cands.filter((c) => c.kind === "controller"), chosen, F)}
        ${this.srcGroup("Power strips and smart plugs", cands.filter((c) => c.kind === "strip"), chosen, F)}
        ${others.length ? (this.showOtherSrc || others.some((c) => chosen.has(c.device_id))
          ? `${this.srcGroup("Other devices with switches", others, chosen, F)}${this.showOtherSrc ? this.btn("other_src", "Hide other devices", {}, "link") : ""}`
          : this.btn("other_src", `Show other devices with switches (${others.length})`, {}, "link")) : ""}
        <p class="hint">Other devices are things like cars, appliances, power stations, pumps and wall light switches: they have switches but aren't outlets. Device in the wrong group? ${this.btn("edit_kinds", this.editKinds ? "Done" : "Fix groups", {}, "link")}</p></div>
      ${this.dosers().length ? `${this.sec("Dosing heads")}<div class="card pad form">
        <p class="hint">Name each pump and the section it is shown under on the Overview and Dosers tabs. Pumps next to each other with the same section share a heading — for example pumps 1–4 "Doser 2.1" and pumps 5–6 "Doser Maxi EXT". Leave a box empty to use what the doser reports.</p>
        <div class="dheads">${this.dosers().map((d) => d.pumps.map((p) => `<div class="dhead"><span class="cap">${esc(d.name)} · Pump ${p.n}</span>
          <label><span>Name</span>${this.ctl("text", this.f("setup", `doser_names.${d.device_id}.${p.n}`), ((F.doser_names || {})[d.device_id] || {})[p.n] || "", { ph: this.autoPumpName(d, p) })}</label>
          <label><span>Section</span>${this.ctl("text", this.f("setup", `doser_sections.${d.device_id}.${p.n}`), ((F.doser_sections || {})[d.device_id] || {})[p.n] || "", { ph: d.name })}</label></div>`).join("")).join("")}</div></div>` : ""}
      ${this.sec("Data")}<div class="card pad form">
        ${this.field("Default status sensor", this.ctl("select", this.f("setup", "data_source.entity"), ds.entity, { options: ents(["sensor", "binary_sensor"]) }), "Probes without their own status sensor use this one")}
        ${this.field("OK when state is", this.ctl("text", this.f("setup", "data_source.ok_states"), ds.ok_states, { ph: "Connected" }))}
        ${this.field("Readings older than", this.ctl("num", this.f("setup", "data_timeout_min"), F.data_timeout_min, { step: 1, min: 0, u: "min" }), "Count as missing. 0 = off — keep it off for sensors that only report changes")}</div>
      <p class="hint">Settings are stored in Home Assistant and included in its backups. Version ${VERSION}.</p>`;
  }
}

const STYLE = `<style>
:host{--bg:#e9eef3;--card:#fff;--bd:#d8e1ea;--tx:#12324a;--mu:#8aa0b2;--sec:#4a6378;--ac:#0069b4;--ok:#2fa84f;--okb:#e5f5ea;--off:#9aabb9;--offb:#eef2f6;--bad:#d64545;--badb:#fdecec;--warn:#b26d00;--warnb:#fdf3e1;--infob:#e6f2fb;
  --sh:0 1px 3px rgba(16,42,67,.12);display:block;font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif);color:var(--tx)}
*{box-sizing:border-box}button{font:inherit;color:inherit}
.root{background:var(--bg);border-radius:12px;padding:12px 16px 24px;min-height:600px}
.hdr{display:flex;align-items:stretch;border-radius:10px;overflow:hidden;box-shadow:var(--sh)}
.ttl{flex:1;background:linear-gradient(90deg,#0058a0 0%,#0069b4 60%,#1b86cf 100%);color:#fff;padding:12px 18px;display:flex;flex-direction:column}
.ttl b{font-size:20px;font-weight:700}.ttl span{font-size:14px;opacity:.85;min-height:18px}
.ttop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.ttl .ver{font-size:12px;opacity:.75;font-variant-numeric:tabular-nums;white-space:nowrap}
.bell{width:68px;border:none;background:#0069b4;color:#fff;cursor:pointer;position:relative;border-left:2px solid rgba(255,255,255,.35)}
.bell ha-icon{--mdc-icon-size:28px}.bell b{position:absolute;top:10px;right:10px;background:var(--bad);color:#fff;border-radius:9px;font-size:11px;min-width:18px;height:18px;line-height:18px;padding:0 4px}
.tabs{display:flex;gap:4px;overflow-x:auto;margin:12px 0 4px;padding:4px;background:var(--card);border:1px solid var(--bd);border-radius:10px;box-shadow:var(--sh);scrollbar-width:none}
.tab{display:flex;align-items:center;gap:6px;border:none;background:none;padding:8px 12px;border-radius:8px;cursor:pointer;color:var(--sec);font-weight:600;font-size:14px;white-space:nowrap}
.tab ha-icon{--mdc-icon-size:18px}.tab:hover{background:var(--offb)}.tab.on{background:var(--ac);color:#fff}
.sec{display:flex;align-items:center;justify-content:space-between;margin:18px 2px 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--sec)}
.sec .btn.link{text-transform:none;letter-spacing:0;font-size:13px}
.grid{display:grid;gap:10px}.g2{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}.g3{grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}.g4{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;box-shadow:var(--sh);text-align:left;display:block;width:100%;padding:0}
button.card,.card button.oc,.card button.lh{cursor:pointer;transition:box-shadow .15s,border-color .15s}
button.card:hover,.card:has(button.oc:hover),.card:has(button.lh:hover){border-color:#b6c7d6;box-shadow:0 3px 10px rgba(16,42,67,.14)}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.pad{padding:12px 16px}.cap{display:block;font-size:11px;color:var(--mu);font-weight:600;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.muted{color:var(--mu)}small{font-size:12px}
.probe{padding:12px 14px}.pn{display:block;font-size:15px}.pv{display:flex;align-items:baseline;gap:6px;margin:6px 0 8px}.big{font-size:34px;font-weight:700;color:var(--ac);line-height:1}.u{color:var(--mu);font-weight:600}.pv .chip{margin-left:auto}
.band{position:relative;height:8px;border-radius:4px;background:var(--offb)}.band i{position:absolute;top:0;bottom:0;border-radius:4px}.band .alm{background:#f3c4c4}.band .ctl{background:#a9d1f0}
.band b{position:absolute;top:-4px;width:4px;height:16px;margin-left:-2px;border-radius:2px;background:var(--tx)}
.kv{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;font-size:13px;color:var(--sec)}.kv b{color:var(--tx)}
.oc{display:flex;align-items:center;gap:12px;padding:10px 14px;border:none;background:none;width:100%;text-align:left;border-radius:10px}
.oi{width:38px;height:38px;border-radius:50%;background:var(--offb);display:flex;align-items:center;justify-content:center;flex:none;color:var(--ac)}.oi ha-icon{--mdc-icon-size:21px}
.ot{flex:1;min-width:0}.ot b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ot small{display:block;color:var(--sec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none;max-width:42%}.os small{color:var(--mu);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.manual{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:0 14px 10px}
.pill{display:inline-block;min-width:46px;text-align:center;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;color:#fff;background:var(--off)}.pill.on{background:var(--ok)}.pill.unk{background:var(--mu)}
.chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;font-size:12px;font-weight:600;background:var(--offb);color:var(--sec);white-space:nowrap}
.chip ha-icon{--mdc-icon-size:14px}.chip.ok{background:var(--okb);color:#1e7a39}.chip.bad{background:var(--badb);color:#b02a2a}.chip.warn{background:var(--warnb);color:var(--warn)}.chip.info{background:var(--infob);color:var(--ac)}
.chips{display:flex;flex-wrap:wrap;gap:6px}.row-btns{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.warnc,.badc{display:flex;align-items:center;gap:3px}.warnc{color:var(--warn)!important}.badc{color:var(--bad)!important}.warnc ha-icon,.badc ha-icon{--mdc-icon-size:14px}
.mode{padding:12px 14px;display:flex;flex-direction:column;gap:8px}.mh{display:flex;align-items:center;gap:8px}.mh b{flex:1}.mh>ha-icon{color:var(--ac)}
.mode-st{display:flex;align-items:baseline;gap:6px;min-height:28px}.cd{font-size:24px;font-weight:700;color:var(--ac)}
.prog{height:6px;border-radius:3px;background:var(--offb);overflow:hidden;margin:6px 0 10px}.prog i{display:block;height:100%;background:var(--ac);transition:width 1s linear}
.mode [data-live] .btn{width:100%;justify-content:center}
.lh{display:flex;align-items:center;gap:12px;padding:12px 14px;border:none;background:none;width:100%;text-align:left;border-radius:10px}.lh div{flex:1;min-width:0}.lh b{display:block}.lh small{color:var(--sec)}
.lvl>[data-live]{display:block;padding:0 14px 12px}
.ic{width:38px;height:38px;border-radius:50%;background:var(--infob);color:var(--ac);display:flex;align-items:center;justify-content:center;flex:none;--mdc-icon-size:21px}
.sched{padding:12px 14px}.sh{display:flex;align-items:center;gap:12px;margin-bottom:10px}.sh div{flex:1;min-width:0}.sh b{display:block}.sh small{color:var(--sec)}
.dot{width:14px;height:14px;border-radius:50%;flex:none;margin:0 12px;border:1px solid rgba(0,0,0,.1)}
.tl{position:relative;height:14px;border-radius:7px;background:var(--offb);overflow:hidden}.tl i{position:absolute;top:0;bottom:0;opacity:.85}.tl i.tick{width:3px;margin-left:-1px;opacity:1}
.tl .now{position:absolute;top:0;bottom:0;width:2px;background:var(--bad)}.tlx{display:flex;justify-content:space-between;font-size:10px;color:var(--mu);margin-top:2px}
.sens{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px}.sens b{display:block}
.gate{padding:12px 14px;display:flex;flex-direction:column;gap:4px}.gh{display:flex;align-items:center;gap:8px}.gh b{flex:1}.op{font-size:11px;font-weight:800;color:#fff;background:var(--ac);padding:2px 7px;border-radius:6px}
.rem{display:flex;align-items:center;gap:12px;padding:12px 14px}.rem div{flex:1}.rem b{display:block}.rem small{color:var(--sec)}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 10px}.grow{flex:1}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ac);background:var(--card);color:var(--ac);border-radius:8px;padding:7px 14px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn ha-icon{--mdc-icon-size:18px}.btn.primary{background:var(--ac);color:#fff}.btn.warn{border-color:var(--bad);color:var(--bad)}.btn.ghost{border-color:var(--bd);color:var(--sec)}.btn.danger{color:var(--bad)}
.btn.sm{padding:4px 10px;font-size:13px}.btn.icon{padding:4px 6px}.btn.link{border:none;background:none;padding:0 2px;color:var(--ac);font-size:13px}
.btn:hover{filter:brightness(.96)}.btn.primary:hover{filter:brightness(1.08)}
.banner{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;margin-top:12px;border:1px solid}.banner span{flex:1}
.banner.ok{background:var(--okb);border-color:#bfe6cb;color:#1e7a39}.banner.bad{background:var(--badb);border-color:#f3c4c4;color:#8f2020}.banner.warn{background:var(--warnb);border-color:#f2d9a8;color:#7a4e08}
.banner.list{flex-direction:column;align-items:stretch;gap:6px}.al{display:flex;align-items:center;gap:8px}.al span{flex:1}
.empty{grid-column:1/-1;background:var(--card);border:1px dashed #c3d1dd;border-radius:10px;padding:26px;text-align:center;color:var(--sec)}
.empty ha-icon{--mdc-icon-size:36px;color:var(--mu)}.empty b{display:block;margin:6px 0 2px;color:var(--tx);font-size:16px}.empty p{margin:0 auto 12px;max-width:520px}
.hint{color:var(--sec);font-size:13px;margin:6px 0;line-height:1.45}
.form .fld{border-bottom:1px solid var(--offb)}.form .fld:last-of-type{border-bottom:none}
.formbar{display:none}.formbar.on{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:4px 0 10px;color:var(--warn);font-size:13px}.formbar span{margin-right:auto}
.scrim{position:fixed;inset:0;background:rgba(18,50,74,.35);z-index:10;animation:fade .15s}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(580px,100vw);background:var(--bg);z-index:11;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(16,42,67,.25);animation:slide .18s ease-out}
@keyframes slide{from{transform:translateX(30px);opacity:.4}}@keyframes fade{from{opacity:0}}
.drawer header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(90deg,#0058a0,#0069b4 60%,#1b86cf);color:#fff}
.drawer header small{opacity:.85;font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:700}.drawer header h2{margin:2px 0 0;font-size:19px}
.x{border:none;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;padding:6px;cursor:pointer;display:flex}
.dbody{flex:1;overflow:auto;padding:14px 18px 24px}.dbody>*{margin-bottom:10px}
.dfoot{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--card);border-top:1px solid var(--bd)}.dfoot .dirty{flex:1;color:var(--warn);font-size:13px;text-align:right}
.lbl{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--sec);margin:18px 0 6px!important}
.fld{display:flex;align-items:center;gap:12px;padding:8px 0}.fl{flex:1;font-size:14px;font-weight:500;min-width:0}.fl small{display:block;color:var(--mu);font-weight:400;margin-top:2px;line-height:1.35}
.fc{display:flex;align-items:center;gap:6px;justify-content:flex-end;flex:0 1 auto;max-width:64%;flex-wrap:wrap}
.dbody>.fld{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px 12px}
input,select{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--card);color:var(--tx);min-width:0;max-width:100%}
input:focus,select:focus{border-color:var(--ac)}
input[type=text]{width:250px}input[type=number]{width:96px;text-align:right}select{max-width:300px}input[type=color]{width:52px;height:36px;padding:2px}
.num{display:inline-flex;align-items:center;gap:6px}.num em{font-style:normal;color:var(--mu);font-size:13px}
.sw{position:relative;width:44px;height:24px;flex:none;display:inline-block}.sw input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}.sw span{position:absolute;inset:0;background:#c5d2de;border-radius:12px;transition:.2s}
.sw span:before{content:"";position:absolute;width:20px;height:20px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}.sw input:checked+span{background:var(--ac)}.sw input:checked+span:before{transform:translateX(20px)}
.sw input:focus-visible+span{outline:2px solid var(--ac);outline-offset:2px}
.seg{display:inline-flex;background:var(--offb);border-radius:8px;padding:3px;gap:2px;flex-wrap:wrap}.seg button{border:none;background:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;color:var(--sec)}
.seg button.on{background:var(--card);color:var(--ac);box-shadow:var(--sh)}
.ftiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}
.ftile{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--card);cursor:pointer;text-align:left}
.ftile:hover{border-color:#b6c7d6}.ftile ha-icon{color:var(--ac);--mdc-icon-size:22px;margin-bottom:2px}.ftile b{font-size:14px}.ftile small{color:var(--mu);line-height:1.3}
.ftile.on{border-color:var(--ac);background:var(--infob);box-shadow:0 0 0 1px var(--ac) inset}
.detail:empty{display:none}.detail{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:6px 12px}.detail .detail{border:none;padding:0}
.sentence{background:var(--infob);border-radius:8px;padding:10px 12px;margin:6px 0;font-size:14px;line-height:1.5}
.preview{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--bd);border-left:4px solid var(--ac);border-radius:10px;padding:10px 12px;font-size:14px}
.preview ha-icon{--mdc-icon-size:22px;flex:none}.okc{color:var(--ok)}
.note{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;font-size:13px}.note span{flex:1}.note.warn{background:var(--warnb);color:#7a4e08}.note.bad{background:var(--badb);color:#8f2020}.note ha-icon{--mdc-icon-size:18px;flex:none}
details{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:0 12px}details[open]{padding-bottom:10px}summary{cursor:pointer;padding:12px 0;font-weight:600;color:var(--sec)}
details .fld{border-top:1px solid var(--offb)}details .picker{margin:6px 0}
.picker{background:var(--card);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.pk-cur{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bd)}.pk-cur div{flex:1;min-width:0}.pk-cur b{display:block}.pk-cur small{color:var(--mu);word-break:break-all}.pk-cur.none{color:var(--mu)}
.pk-cur .st,.pk-i .st{font-size:12px;color:var(--sec);background:var(--offb);border-radius:8px;padding:2px 8px;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis;flex:none}
.pk-q{width:calc(100% - 24px)!important;margin:10px 12px 6px}.pk-list{max-height:230px;overflow:auto;padding-bottom:6px}
.pk-g{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sec);padding:8px 12px 4px;background:#f6f8fa;position:sticky;top:0}
.pk-i{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer}.pk-i:hover,.pk-i.sel{background:var(--infob)}.pk-i .nm{flex:1;min-width:0}.pk-i small{display:block;color:var(--mu);font-size:11px;overflow:hidden;text-overflow:ellipsis}.pk-i.clear{color:var(--bad)}
.prow{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;flex-wrap:wrap}.prow>span{color:var(--sec);font-size:13px;font-weight:600}
.days{display:flex;gap:6px;flex-wrap:wrap}.day{border:1px solid var(--bd);background:var(--card);border-radius:18px;padding:7px 12px;cursor:pointer;font-weight:600;color:var(--sec)}.day.on{background:var(--ac);color:#fff;border-color:var(--ac)}
.presets{display:flex;gap:14px}.gin{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0}
.checks{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}.srcs{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}.src{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.srow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.kindsel{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--card);color:var(--tx)}.onames{display:flex;flex-direction:column;gap:6px;margin:0 0 6px 28px;width:calc(100% - 28px);max-width:560px}.oname{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:8px;align-items:center}.oname .chk{background:var(--card);border:1px solid var(--bd);font-size:13px;padding:4px 8px;min-width:0}.oname .chk span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.oname .chk.solo{color:var(--sec)}.oname input[type=text]{width:100%;min-width:0;box-sizing:border-box}
.checks.sub{margin:0 0 4px 28px}.checks.sub .chk{background:var(--card);border:1px solid var(--bd);font-size:13px;padding:4px 8px}.chk{display:flex;align-items:center;gap:6px;background:var(--offb);border-radius:8px;padding:6px 10px;cursor:pointer}
.pump{display:flex;gap:10px;padding:14px;align-items:center}
.tank{width:40px;height:78px;border:2px solid #b9c7d4;border-top-width:5px;border-radius:3px 3px 7px 7px;position:relative;overflow:hidden;background:#f4f7fa;flex:none}
.tank i{position:absolute;left:0;right:0;bottom:0;opacity:.85;transition:height .6s}
.pinfo{flex:1;min-width:0}.phead{display:flex;justify-content:space-between;gap:6px;font-size:10px;font-weight:700;color:#8aa0b2}
.pdot.ok{color:#2fa84f}.pdot.bad{color:#d9312b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pname{display:block;font-weight:700;color:#12324a;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pline{font-size:13px;color:#6b8296}.pline b{color:#12324a}.pday{font-size:11px;color:#6b8296;margin-top:2px}
.dheads{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.dhead{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--bd);border-radius:8px}.dhead{min-width:0}.dhead label{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:8px;font-size:13px;color:var(--sec)}.dhead input[type=text]{width:100%;min-width:0;box-sizing:border-box}
.dgroups{display:flex;flex-wrap:wrap;gap:0 16px}.dgroup{min-width:0}.dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.hdrchips{display:inline-flex;gap:6px;text-transform:none;letter-spacing:0}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:var(--tx);color:#fff;padding:10px 18px;border-radius:10px;z-index:20;transition:.25s;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:90vw}.toast.in{opacity:1;transform:translate(-50%,0)}.toast.bad{background:var(--bad)}
@media (max-width:700px){.root{padding:8px}.g2,.g3,.g4{grid-template-columns:1fr}.tab span{display:none}.tab.on span{display:inline}.fld{flex-wrap:wrap}.fc{max-width:100%;width:100%;justify-content:flex-start}input[type=text]{width:100%}.ftiles{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>`;

if (!customElements.get("sentinel-controller-card-impl")) customElements.define("sentinel-controller-card-impl", class extends SentinelControllerCard {});
// Loaded directly (without the loader): register the card name too.
if (!customElements.get("sentinel-controller-card")) customElements.define("sentinel-controller-card", SentinelControllerCard);
window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "sentinel-controller-card"))
  window.customCards.push({ type: "sentinel-controller-card", name: "Sentinel Controller", description: "Reef controller for Home Assistant" });
})();
