/* Sentinel Controller card — ProfiLux-4-style control scheme for Home Assistant.
 * Menu and settings follow the GHL "ProfiLux 4 / 4e Resource Guide (GHL Connect edition)". */
(() => {
const VERSION = "0.1.4";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MENU = [
  ["dashboard", "Dashboard", "mdi:view-dashboard"],
  ["sensors", "Sensors", "mdi:thermometer"],
  ["channels", "Switch channels", "mdi:power-socket-us"],
  ["timers", "Processes (timers)", "mdi:timer-outline"],
  ["illumination", "Illumination", "mdi:lightbulb-outline"],
  ["feed", "Feed pause", "mdi:fish"],
  ["maintenance", "Maintenance / Power cut", "mdi:wrench"],
  ["level", "Level control", "mdi:waves-arrow-up"],
  ["logic", "Programmable logic", "mdi:gate-and"],
  ["reminders", "Reminders", "mdi:calendar-alert"],
  ["notify", "Notifications", "mdi:bell-ring-outline"],
  ["system", "System", "mdi:cog-outline"],
];

const FN_LABEL = {
  always_off: "Always off", always_on: "Always on", temperature: "Temperature", ph: "pH value",
  timer: "Timer", illumination: "Illumination", filter: "Filter (feed pause)", maintenance: "Maintenance",
  fill_water: "Fill water (leakage / level)", fill_ato: "Fill water ATO only", fill_awc: "Fill water AWC only",
  drain_water: "Drain water", logic: "Programmable logic",
};
const LEVEL_LABEL = {
  off: "Not used", ato: "Auto top off (1 sensor)", minmax: "Min/Max control (2 sensors)",
  ato2: "ATO with 2 sensors", wc: "Water change", ato_wc: "ATO & water change", leak: "Leakage detection",
};
const OP_LABEL = { and: "AND", or: "OR", delayed_on: "Delayed ON", delayed_off: "Delayed OFF" };
const PAGE_SECTIONS = {
  sensors: ["probes", "light_reduction"], channels: ["channels"], timers: ["timers"],
  illumination: ["illumination", "light_reduction"], feed: ["feed_pauses"], maintenance: ["maintenance"],
  level: ["level_sensors", "level_circuits"], logic: ["logic"], reminders: ["reminders"], notify: ["notify"],
  system: ["power_cut", "data_timeout_min", "data_source"],
};

class SentinelControllerCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 12; }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._init();
  }

  async _init() {
    this.attachShadow({ mode: "open" });
    this.page = this._config?.page || "dashboard";
    this.sel = null;
    this.tab = 1;
    this.dirty = new Set();
    this.msg = "";
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this.shadowRoot.addEventListener("change", (e) => this._change(e));
    try {
      const r = await this._hass.callWS({ type: "sentinel_controller/get" });
      this.cfg = r.config; this.saved = clone(r.config); this.status = r.status; this.limits = r.limits;
      this._unsub = await this._hass.connection.subscribeMessage((m) => this._onStatus(m.status),
        { type: "sentinel_controller/subscribe" });
    } catch (err) {
      this.err = err.message || String(err);
    }
    this._render();
  }

  disconnectedCallback() { if (this._unsub) { this._unsub(); this._unsub = null; } }

  _onStatus(st) {
    this.status = st;
    const editing = this.shadowRoot.activeElement && /INPUT|SELECT|TEXTAREA/.test(this.shadowRoot.activeElement.tagName);
    if (editing || this.dirty.size) this._renderLive(); else this._render();
  }

  // ------------------------------------------------------------ helpers
  st(path, dflt) {
    let v = this.status;
    for (const k of path) { if (v == null) return dflt; v = v[String(k)]; }
    return v ?? dflt;
  }
  item(sec, n) { return this.cfg[sec].find((x) => x.n === n); }
  ents(domains) {
    return Object.keys(this._hass.states).filter((e) => domains.includes(e.split(".")[0])).sort();
  }
  fname(e) { const s = this._hass.states[e]; return s?.attributes?.friendly_name ? `${s.attributes.friendly_name} (${e})` : e; }
  opt(value, label, cur) { return `<option value="${esc(value)}" ${String(value) === String(cur) ? "selected" : ""}>${esc(label)}</option>`; }
  sel_(bind, options, cur, extra = "") {
    return `<select data-bind="${bind}" ${extra}>${options.map(([v, l]) => this.opt(v, l, cur)).join("")}</select>`;
  }
  entSel(bind, domains, cur) {
    const list = this.ents(domains);
    if (cur && !list.includes(cur)) list.unshift(cur);
    return `<select data-bind="${bind}"><option value="">— none —</option>${list.map((e) => this.opt(e, this.fname(e), cur)).join("")}</select>`;
  }
  num(bind, v, step = "any", min = "", max = "") {
    return `<input type="number" data-bind="${bind}" data-kind="num" value="${esc(v)}" step="${step}" ${min !== "" ? `min="${min}"` : ""} ${max !== "" ? `max="${max}"` : ""}>`;
  }
  txt(bind, v, ph = "", type = "text") { return `<input type="${type}" data-bind="${bind}" value="${esc(v)}" placeholder="${esc(ph)}">`; }
  chk(bind, v) { return `<label class="sw"><input type="checkbox" data-bind="${bind}" data-kind="bool" ${v ? "checked" : ""}><span></span></label>`; }
  row(label, ctl, hint = "") { return `<div class="row"><div class="lab">${esc(label)}${hint ? `<small>${hint}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`; }
  pill(on, txtOn = "ON", txtOff = "OFF") {
    if (on == null) return `<span class="pill na">—</span>`;
    return `<span class="pill ${on ? "on" : "off"}">${on ? txtOn : txtOff}</span>`;
  }
  btn(action, label, n = "", cls = "", value = "") {
    return `<button class="btn ${cls}" data-act="${action}" data-n="${n}" data-value="${esc(value)}">${esc(label)}</button>`;
  }
  getPath(path) { return path.split(".").reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), this.cfg); }
  setPath(path, val) {
    const keys = path.split(".");
    let o = this.cfg;
    for (let i = 0; i < keys.length - 1; i++) { const k = /^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i]; o = o[k]; }
    const last = keys[keys.length - 1];
    o[/^\d+$/.test(last) ? Number(last) : last] = val;
    this.dirty.add(keys[0]);
  }
  idx(sec, n) { return this.cfg[sec].findIndex((x) => x.n === n); }
  fmtTime(iso) { if (!iso) return ""; const d = new Date(iso); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  remaining(iso) { if (!iso) return ""; const s = Math.max(0, (new Date(iso) - Date.now()) / 1000); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; }

  fnSummary(fn) {
    if (!fn) return "Always off";
    const t = fn.type || "always_off";
    let s = FN_LABEL[t] || t;
    const p = fn.param;
    if (t === "temperature" || t === "ph") {
      const pr = this.cfg.probes.find((x) => x.id === p);
      s += ` · ${pr ? pr.name || pr.id : "?"} · ${t === "temperature" ? (fn.mode === "cooler" ? "Cooler" : "Heater") : (fn.mode === "down" ? "Control downwards" : "Control upwards")}`;
    } else if (!["always_off", "always_on"].includes(t)) s += ` ${p || "?"}`;
    return s;
  }

  fnParamOptions(t) {
    const L = this.limits;
    const named = (sec, n, fallback) => { const it = this.item(sec, n); return `${fallback} ${n}${it && it.name ? " · " + it.name : ""}`; };
    switch (t) {
      case "temperature": return this.cfg.probes.filter((p) => p.kind === "temperature").map((p) => [p.id, p.name || p.id]);
      case "ph": return this.cfg.probes.filter((p) => p.kind === "ph").map((p) => [p.id, p.name || p.id]);
      case "timer": return range(1, L.timers).filter((n) => this.item("timers", n).mode === "normal").map((n) => [n, named("timers", n, "Timer")]);
      case "illumination": return range(1, L.illumination).map((n) => [n, named("illumination", n, "Illumination")]);
      case "filter": return range(1, L.feed_pauses).map((n) => [n, named("feed_pauses", n, "Filter")]);
      case "maintenance": return range(1, L.maintenance).map((n) => [n, named("maintenance", n, "Maintenance")]);
      case "fill_water": case "fill_ato": case "fill_awc": case "drain_water":
        return range(1, L.level_circuits).map((n) => [n, named("level_circuits", n, "Control circuit")]);
      case "logic": return range(1, L.logic).map((n) => [n, named("logic", n, "Programmable logic")]);
      default: return [];
    }
  }

  fnEditor(base, fn, allowInvert = false) {
    const t = fn.type || "always_off";
    const types = this.limits.fn_types.map((x) => [x, FN_LABEL[x] || x]);
    let h = this.row("Function", this.sel_(`${base}.type`, types, t, 'data-rerender="1"'));
    const opts = this.fnParamOptions(t);
    if (opts.length || ["temperature", "ph"].includes(t)) {
      h += this.row(t === "temperature" || t === "ph" ? "Probe" : "Number",
        opts.length ? this.sel_(`${base}.param`, [["", "— choose —"], ...opts], fn.param) : `<em>Add a ${t === "ph" ? "pH" : "temperature"} probe under Sensors first</em>`);
    }
    if (t === "temperature") h += this.row("Type", this.sel_(`${base}.mode`, [["heater", "Heater"], ["cooler", "Cooler"]], fn.mode || "heater"));
    if (t === "ph") h += this.row("Direction", this.sel_(`${base}.mode`, [["up", "Control upwards (increase)"], ["down", "Control downwards (decrease)"]], fn.mode || "up"));
    if (allowInvert) h += this.row("Invert", this.chk(`${base}.invert`, fn.invert));
    return h;
  }

  entriesEditor(sec, i, entries, eventMode = false) {
    const rows = (entries || []).map((e, k) => `<div class="entry">
      ${eventMode ? `Start at ${this.txt(`${sec}.${i}.entries.${k}.on`, e.on, "08:00", "time")}`
        : `ON ${this.txt(`${sec}.${i}.entries.${k}.on`, e.on, "08:00", "time")} OFF ${this.txt(`${sec}.${i}.entries.${k}.off`, e.off, "20:00", "time")}`}
      ${this.btn("entry_del", "Remove", `${sec}|${i}|${k}`, "small ghost")}</div>`).join("");
    return `${rows || "<em>No times yet</em>"}<div>${this.btn("entry_add", "Add", `${sec}|${i}`, "small")}</div>`;
  }

  // ------------------------------------------------------------ events
  _change(e) {
    const el = e.target;
    const bind = el.dataset.bind;
    if (!bind) return;
    let v;
    if (el.dataset.kind === "bool") v = el.checked;
    else if (el.dataset.kind === "num") v = el.value === "" ? 0 : Number(el.value);
    else if (el.dataset.kind === "weekday") {
      const [path, d] = [bind, Number(el.dataset.day)];
      const cur = new Set(this.getPath(path) || []);
      if (el.checked) cur.add(d); else cur.delete(d);
      this.setPath(path, [...cur].sort());
      return this._render();
    } else if (el.dataset.kind === "multi") {
      v = [...el.selectedOptions].map((o) => o.value);
    } else v = el.value;
    if (/\.(param|ch|timer|ato_timer|wc_timer|sensor1|sensor2)$/.test(bind) && /^\d+$/.test(String(v))) v = Number(v);
    this.setPath(bind, v);
    if (/\.fn\.type$|\.in[12]\.type$/.test(bind)) {
      const base = bind.replace(/\.type$/, "");
      const opts = this.fnParamOptions(v);
      this.setPath(base + ".param", opts.length ? opts[0][0] : 0);
      this.setPath(base + ".mode", v === "temperature" ? "heater" : v === "ph" ? "up" : "");
    }
    if (el.dataset.rerender) this._render(); else this._renderBar();
  }

  async _click(e) {
    const b = e.target.closest("[data-act],[data-nav],[data-open],[data-tab]");
    if (!b) return;
    if (b.dataset.nav) {
      if (this.dirty.size && !confirm("Discard unsaved changes on this page?")) return;
      if (this.dirty.size) { this.cfg = clone(this.saved); this.dirty.clear(); }
      this.page = b.dataset.nav; this.sel = null; this.msg = ""; this.tab = 1; return this._render();
    }
    if (b.dataset.open !== undefined) { this.sel = b.dataset.open === "" ? null : Number(b.dataset.open) || b.dataset.open; return this._render(); }
    if (b.dataset.tab) { this.tab = Number(b.dataset.tab); return this._render(); }
    const act = b.dataset.act, n = b.dataset.n, value = b.dataset.value;
    if (act === "save") return this._save();
    if (act === "revert") { this.cfg = clone(this.saved); this.dirty.clear(); this.msg = ""; return this._render(); }
    if (act === "entry_add" || act === "entry_del") {
      const [sec, i, k] = n.split("|");
      const list = this.cfg[sec][Number(i)].entries || (this.cfg[sec][Number(i)].entries = []);
      if (act === "entry_add") list.push({ on: "08:00", off: "20:00" }); else list.splice(Number(k), 1);
      this.dirty.add(sec); return this._render();
    }
    if (act === "probe_add") {
      const used = new Set(this.cfg.probes.map((p) => p.id));
      let i = 1; while (used.has(`p${i}`)) i++;
      this.cfg.probes.push({ id: `p${i}`, name: "", kind: "temperature", entity: "", unit: "°F", nominal: 77, hysteresis: 0.36,
        alarm: { active: true, deviation: 2, no_alarm_on_wc: false, deactivate_control: false } });
      this.dirty.add("probes"); this.sel = `p${i}`; return this._render();
    }
    if (act === "probe_del") { this.cfg.probes = this.cfg.probes.filter((p) => p.id !== n); this.dirty.add("probes"); this.sel = null; return this._render(); }
    if (act === "sock_add") { const i = this.idx("maintenance", Number(n)); this.cfg.maintenance[i].sockets.push({ ch: 1, state: "off" }); this.dirty.add("maintenance"); return this._render(); }
    if (act === "sock_del") { const [m, k] = n.split("|"); this.cfg.maintenance[this.idx("maintenance", Number(m))].sockets.splice(Number(k), 1); this.dirty.add("maintenance"); return this._render(); }
    if (act === "start_date_today") { const [sec, i, key] = n.split("|"); this.setPath(`${sec}.${i}.${key}`, new Date().toISOString().slice(0, 10)); return this._render(); }
    // runtime actions
    const map = { fp_start: "start_feed_pause", fp_stop: "stop_feed_pause", mt_start: "start_maintenance", mt_stop: "stop_maintenance",
      wc_start: "start_water_change", wc_stop: "stop_water_change", lvl_reset: "reset_level_error", rem_ack: "acknowledge_reminder",
      override: "manual_override", ch_manual: "channel_manual", hours_reset: "reset_hours" };
    if (map[act]) {
      if (this.dirty.size) { this.msg = "Save or revert your changes first."; return this._render(); }
      const msg = { type: "sentinel_controller/action", action: map[act] };
      if (n !== "") msg.n = Number(n);
      if (value !== "") msg.value = value === "true" ? true : value === "false" ? false : value;
      try {
        const r = await this._hass.callWS(msg);
        this.cfg = r.config; this.saved = clone(r.config); this.status = r.status; this.msg = "";
      } catch (err) { this.msg = err.message || String(err); }
      return this._render();
    }
  }

  async _save() {
    const secs = [...this.dirty];
    try {
      for (const s of secs) {
        const r = await this._hass.callWS({ type: "sentinel_controller/save", section: s, value: this.cfg[s] });
        this.status = r.status;
        this.saved = clone(r.config);
      }
      this.cfg = clone(this.saved); this.dirty.clear(); this.msg = "Saved.";
    } catch (err) { this.msg = `Not saved: ${err.message || err}`; }
    this._render();
  }

  // ------------------------------------------------------------ render
  _renderBar() {
    const bar = this.shadowRoot.querySelector(".savebar");
    if (bar) bar.outerHTML = this._bar();
  }
  _bar() {
    return `<div class="savebar ${this.dirty.size ? "dirty" : ""}">${this.dirty.size ? `<span>Unsaved changes</span>${this.btn("revert", "Revert", "", "ghost")}${this.btn("save", "Save", "", "primary")}` : `<span>${esc(this.msg)}</span>`}</div>`;
  }
  _renderLive() {
    this.shadowRoot.querySelectorAll("[data-live]").forEach((el) => {
      const [kind, n] = el.dataset.live.split(":");
      if (kind === "ch") { const s = this.st(["channels", n]); el.innerHTML = s ? this.pill(s.out) : ""; }
      if (kind === "probe") { const v = this.st(["probes", n, "value"]); el.textContent = v == null ? "—" : v; }
      if (kind === "sensor") { const v = this.st(["level_sensors", n]); el.innerHTML = this.pill(v, "WATER", "DRY"); }
    });
  }

  _render() {
    const root = this.shadowRoot;
    if (this.err) { root.innerHTML = `${STYLE}<ha-card><div class="pad err">${esc(this.err)}</div></ha-card>`; return; }
    if (!this.cfg) { root.innerHTML = `${STYLE}<ha-card><div class="pad">Loading…</div></ha-card>`; return; }
    const alarms = this.st(["alarms"], []);
    const nav = MENU.map(([k, l, icon]) => `<div class="nav ${this.page === k ? "act" : ""}" data-nav="${k}"><ha-icon icon="${icon}"></ha-icon><span>${l}</span></div>`).join("");
    const fn = this["p_" + this.page]; const page = fn ? fn.call(this) : "";
    const focus = root.activeElement?.dataset?.bind;
    root.innerHTML = `${STYLE}<ha-card>
      <div class="head"><div class="title">Sentinel Controller</div>
        <div class="bell ${alarms.length ? "alarm" : ""}" data-nav="dashboard" title="${esc(alarms.map((a) => a.text).join("\n"))}"><ha-icon icon="mdi:bell${alarms.length ? "-ring" : ""}"></ha-icon>${alarms.length ? `<b>${alarms.length}</b>` : ""}</div></div>
      <div class="wrap"><div class="menu">${nav}</div><div class="main">${this._bar()}${page}</div></div></ha-card>`;
    if (focus) { const el = root.querySelector(`[data-bind="${CSS.escape(focus)}"]`); if (el) el.focus(); }
  }

  // ------------------------------------------------------------ pages
  p_dashboard() {
    const al = this.st(["alarms"], []);
    const probes = this.cfg.probes.map((p) => {
      const v = this.st(["probes", p.id, "value"]); const bad = this.st(["probes", p.id, "alarm"]);
      return `<div class="tile ${bad ? "bad" : ""}"><div class="big" data-live="probe:${p.id}">${v == null ? "—" : v}</div><div>${esc(p.name || p.id)} ${esc(p.unit || "")}</div><small>nominal ${esc(p.nominal)} · hyst ${esc(p.hysteresis)}</small></div>`;
    }).join("") || `<em>No probes yet. Add them under Sensors.</em>`;
    const fps = this.cfg.feed_pauses.map((f) => {
      const end = this.st(["feed_pauses", f.n]);
      return `<div class="tile">${esc(f.name || "Feed pause " + f.n)}<small>${end ? "ends in " + this.remaining(end) : f.minutes + " min"}</small>${end ? this.btn("fp_stop", "Stop", f.n, "warn") : this.btn("fp_start", "Start", f.n, "primary")}</div>`;
    }).join("");
    const mts = this.cfg.maintenance.map((m) => {
      const s = this.st(["maintenance", m.n]);
      return `<div class="tile">${esc(m.name || "Maintenance " + m.n)}<small>${s ? (s.power ? "power cut program" : "ends in " + this.remaining(s.end)) : m.minutes + " min · " + m.sockets.length + " socket(s)"}</small>${s ? this.btn("mt_stop", "Stop", m.n, "warn") : this.btn("mt_start", "Start", m.n, "primary")}</div>`;
    }).join("");
    const chs = this.cfg.channels.filter((c) => c.entity).map((c) => {
      const s = this.st(["channels", c.n], {});
      const ov = this.cfg.manual_override ? `${this.btn("ch_manual", "ON", c.n, s.out ? "primary small" : "ghost small", "true")}${this.btn("ch_manual", "OFF", c.n, !s.out ? "primary small" : "ghost small", "false")}` : "";
      return `<div class="chrow" data-nav-ch="${c.n}"><b>${c.n}</b><span class="grow">${esc(c.name || c.entity)}<small>${esc(this.fnSummary(c.fn))}${s.reason && s.reason !== c.fn?.type ? " · " + esc(s.reason) : ""}</small></span>
        <span data-live="ch:${c.n}">${this.pill(s.out)}</span><small class="act">${s.actual == null ? "device n/a" : "device " + (s.actual ? "on" : "off")}</small>${ov}</div>`;
    }).join("") || `<em>No switch channels have a device yet. Assign them under Switch channels.</em>`;
    const lv = this.cfg.level_circuits.filter((c) => c.mode !== "off").map((c) => {
      const s = this.st(["level", c.n], {});
      const wc = ["wc", "ato_wc"].includes(c.mode);
      return `<div class="chrow"><b>${c.n}</b><span class="grow">${esc(c.name || LEVEL_LABEL[c.mode])}<small>${esc(LEVEL_LABEL[c.mode])}${s.phase ? " · water change: " + s.phase : ""}${s.error ? " · ERROR: " + esc(s.error) : ""}</small></span>
        ${wc ? (s.phase ? this.btn("wc_stop", "Stop WC", c.n, "warn small") : this.btn("wc_start", "Start WC", c.n, "small")) : ""}${s.error ? this.btn("lvl_reset", "Reset error", c.n, "warn small") : ""}</div>`;
    }).join("");
    return `<h2>Dashboard</h2>
      ${al.length ? `<div class="alarms">${al.map((a) => `<div>⚠ ${esc(a.text)} ${a.reminder ? this.btn("rem_ack", "Done", a.reminder, "small") : ""}</div>`).join("")}</div>` : `<div class="ok">No alarms</div>`}
      <h3>Sensors</h3><div class="tiles">${probes}</div>
      <h3>Feed pause</h3><div class="tiles">${fps}</div>
      <h3>Maintenance</h3><div class="tiles">${mts}</div>
      ${lv ? `<h3>Level control</h3><div class="list">${lv}</div>` : ""}
      <h3>Switch channels ${this.cfg.manual_override ? `<span class="pill warn">MANUAL OVERRIDE</span>` : ""}</h3><div class="list">${chs}</div>`;
  }

  p_sensors() {
    const list = this.cfg.probes.map((p) => `<div class="chrow click" data-open="${p.id}"><b>${esc(p.id)}</b><span class="grow">${esc(p.name || "(no description)")}<small>${esc(p.kind)} · ${esc(p.entity || "no source")}</small></span><span data-live="probe:${p.id}">${this.st(["probes", p.id, "value"]) ?? "—"}</span></div>`).join("");
    let form = "";
    const i = this.cfg.probes.findIndex((p) => p.id === this.sel);
    if (i >= 0) {
      const p = this.cfg.probes[i], b = `probes.${i}`;
      const half = Number(p.hysteresis || 0) / 2, nom = Number(p.nominal || 0);
      const lowOn = (nom - half).toFixed(2), highOn = (nom + half).toFixed(2);
      form = `<div class="form"><h3>${esc(p.name || p.id)}</h3>
        ${this.row("Description", this.txt(`${b}.name`, p.name, "Tank temperature"))}
        ${this.row("Type", this.sel_(`${b}.kind`, [["temperature", "Temperature"], ["ph", "pH value"], ["other", "Other (alarm only)"]], p.kind, 'data-rerender="1"'))}
        ${this.row("Source sensor", this.entSel(`${b}.entity`, ["sensor", "input_number", "number"], p.entity))}
        ${this.row("Unit", this.txt(`${b}.unit`, p.unit, "°F"))}
        ${this.row("Nominal value", this.num(`${b}.nominal`, p.nominal, "0.01"))}
        ${this.row("Hysteresis", this.num(`${b}.hysteresis`, p.hysteresis, "0.01", 0), `Switch points: ${lowOn} / ${highOn} (nominal ± hysteresis ÷ 2)`)}
        <h4>Alarm</h4>
        ${this.row("Active", this.chk(`${b}.alarm.active`, p.alarm?.active))}
        ${this.row("Max. deviation", this.num(`${b}.alarm.deviation`, p.alarm?.deviation, "0.01", 0), `Alarm below ${(nom - Number(p.alarm?.deviation || 0)).toFixed(2)} or above ${(nom + Number(p.alarm?.deviation || 0)).toFixed(2)}`)}
        ${this.row("No alarm on water change", this.chk(`${b}.alarm.no_alarm_on_wc`, p.alarm?.no_alarm_on_wc))}
        ${this.row("Deactivate control", this.chk(`${b}.alarm.deactivate_control`, p.alarm?.deactivate_control), "Turns this probe's heater/cooler/pH outlets OFF while outside the allowed deviation")}
        <div class="right">${this.btn("probe_del", "Delete probe", p.id, "warn")}</div></div>`;
    }
    const lr = this.cfg.light_reduction || {};
    const tprobes = this.cfg.probes.filter((p) => p.kind === "temperature");
    return `<h2>Sensors</h2><div class="list">${list || "<em>No probes yet.</em>"}</div>
      <div>${this.cfg.probes.length < this.limits.probes ? this.btn("probe_add", "Add probe", "", "primary") : ""}</div>${form}
      <h3>Temperature-dependent light reduction</h3><div class="form">
      ${this.row("Temperature probe", this.sel_("light_reduction.probe", [["", "— off —"], ...tprobes.map((p) => [p.id, p.name || p.id])], lr.probe))}
      ${this.row("Shut-off limit (above nominal)", this.num("light_reduction.limit", lr.limit, "0.1", 0), "Illumination channels with light reduction enabled turn OFF for the rest of the day once this is reached")}</div>
      <p class="hint">Data source and age rules are under System.</p>`;
  }

  p_channels() {
    const tabs = [1, 2, 3].map((t) => `<div class="tab ${this.tab === t ? "act" : ""}" data-tab="${t}">${(t - 1) * 16 + 1}–${t * 16}</div>`).join("");
    const start = (this.tab - 1) * 16 + 1;
    const list = range(start, start + 15).map((n) => {
      const c = this.item("channels", n), s = this.st(["channels", n], {});
      return `<div class="chrow click ${this.sel === n ? "selrow" : ""}" data-open="${n}"><b>${n}</b><span class="grow">${esc(c.name || "Switch channel " + n)}<small>${esc(c.entity || "no device")} · ${esc(this.fnSummary(c.fn))}</small></span><span data-live="ch:${n}">${c.entity ? this.pill(s.out) : ""}</span></div>`;
    }).join("");
    let form = "";
    const i = this.idx("channels", this.sel);
    if (i >= 0) {
      const c = this.cfg.channels[i], b = `channels.${i}`, s = this.st(["channels", c.n], {});
      form = `<div class="form"><h3>Switch channel ${c.n}</h3>
        ${this.row("Description", this.txt(`${b}.name`, c.name, "Heater"))}
        ${this.row("Device (outlet)", this.entSel(`${b}.entity`, ["switch", "light", "fan", "input_boolean", "siren", "humidifier"], c.entity))}
        ${this.fnEditor(`${b}.fn`, c.fn || {})}
        <h4>Switching behavior</h4>
        ${this.row("Invert", this.chk(`${b}.invert`, c.invert))}
        ${this.row("Blackout delay (min)", this.num(`${b}.blackout_min`, c.blackout_min, "1", 0), "Stays OFF for this long after Home Assistant starts or power returns")}
        ${this.row("Fallback state", this.sel_(`${b}.fallback`, [["off", "OFF"], ["on", "ON"]], c.fallback), "Used when the function has no data (probe offline, sensor unavailable)")}
        ${this.row("Operating hours", `${s.hours ?? 0} h ${this.btn("hours_reset", "Reset", c.n, "small ghost")}`)}
        ${this.row("Now", `${this.pill(s.out)} <small>${esc(s.reason || "")}</small>`)}</div>`;
    }
    return `<h2>Switch channels</h2><div class="tabs">${tabs}</div>
      ${this.row("Activate manual override", `${this.btn("override", this.cfg.manual_override ? "ON — turn off" : "OFF — turn on", "", this.cfg.manual_override ? "warn" : "", this.cfg.manual_override ? "false" : "true")}`, "While on, every channel follows its manual ON/OFF (set on the Dashboard); it starts from each channel's current state")}
      <div class="split"><div class="list">${list}</div>${form}</div>`;
  }

  p_timers() {
    const list = range(1, this.limits.timers).map((n) => {
      const t = this.item("timers", n), on = this.st(["timers", n]);
      return `<div class="chrow click ${this.sel === n ? "selrow" : ""}" data-open="${n}"><b>${n}</b><span class="grow">${esc(t.name || "Timer " + n)}<small>${t.mode === "event" ? "Event start" : "Normal"} · ${(t.entries || []).length} time(s)</small></span>${t.mode === "normal" && (t.entries || []).length ? this.pill(on) : ""}</div>`;
    }).join("");
    let form = "";
    const i = this.idx("timers", this.sel);
    if (i >= 0) {
      const t = this.cfg.timers[i], b = `timers.${i}`;
      const days = t.day_mode === "interval"
        ? `${this.row("Repeat every (days)", this.num(`${b}.every_days`, t.every_days, "1", 1))}${this.row("Starting on", `${this.txt(`${b}.start_date`, t.start_date, "", "date")} ${this.btn("start_date_today", "Today", `timers|${i}|start_date`, "small ghost")}`)}`
        : this.row("Days", WD.map((d, k) => `<label class="wd"><input type="checkbox" data-bind="${b}.weekdays" data-kind="weekday" data-day="${k}" ${(t.weekdays || []).includes(k) ? "checked" : ""}>${d}</label>`).join(""));
      form = `<div class="form"><h3>Timer ${t.n}</h3>
        ${this.row("Description", this.txt(`${b}.name`, t.name, "Skimmer"))}
        ${this.row("Switch mode", this.sel_(`${b}.mode`, [["normal", "Normal (ON/OFF)"], ["event", "Event start"]], t.mode, 'data-rerender="1"'), t.mode === "event" ? "Event start activates a feed pause or water change that selects this timer" : "")}
        <h4>Schedule</h4>${this.entriesEditor("timers", i, t.entries, t.mode === "event")}
        ${this.row("Day mode", this.sel_(`${b}.day_mode`, [["weekdays", "Special weekdays"], ["interval", "Day intervals"]], t.day_mode, 'data-rerender="1"'))}
        ${days}</div>`;
    }
    return `<h2>Processes · Timers</h2><div class="split"><div class="list scroll">${list}</div>${form}</div>`;
  }

  p_illumination() {
    const list = range(1, this.limits.illumination).map((n) => {
      const c = this.item("illumination", n);
      return `<div class="chrow click ${this.sel === n ? "selrow" : ""}" data-open="${n}"><b style="color:${esc(c.color)}">${n}</b><span class="grow">${esc(c.name || "Illumination " + n)}<small>${(c.entries || []).length} period(s)${c.temp_reduction ? " · light reduction" : ""}</small></span>${(c.entries || []).length ? this.pill(this.st(["illumination", n])) : ""}</div>`;
    }).join("");
    let form = "";
    const i = this.idx("illumination", this.sel);
    if (i >= 0) {
      const c = this.cfg.illumination[i], b = `illumination.${i}`;
      form = `<div class="form"><h3>Illumination channel ${c.n} (non-dimmable)</h3>
        ${this.row("Description", this.txt(`${b}.name`, c.name, "T5 blue"))}
        ${this.row("Color", this.txt(`${b}.color`, c.color, "", "color"))}
        <h4>ON / OFF times</h4>${this.entriesEditor("illumination", i, c.entries)}
        ${this.row("Temperature-dependent light reduction", this.chk(`${b}.temp_reduction`, c.temp_reduction), "Probe and limit are set under Sensors")}
        <p class="hint">Assign this to an outlet under Switch channels → Function: Illumination ${c.n}.</p></div>`;
    }
    const lr = this.cfg.light_reduction || {};
    return `<h2>Illumination channels</h2>${lr.probe ? `<p class="hint">Light reduction: OFF for the rest of the day at nominal + ${esc(lr.limit)}.${this.st(["light_reduction_today"]) ? " <b>Active today.</b>" : ""}</p>` : ""}
      <div class="split"><div class="list scroll">${list}</div>${form}</div>`;
  }

  p_feed() {
    const evTimers = range(1, this.limits.timers).filter((n) => this.item("timers", n).mode === "event");
    return `<h2>Feed pause</h2>${this.cfg.feed_pauses.map((f, i) => {
      const b = `feed_pauses.${i}`, end = this.st(["feed_pauses", f.n]);
      return `<div class="form"><h3>Feed pause ${f.n} ${end ? `<span class="pill on">RUNNING ${this.remaining(end)}</span>` : ""}</h3>
        ${this.row("Description", this.txt(`${b}.name`, f.name))}
        ${this.row("Duration (min)", this.num(`${b}.minutes`, f.minutes, "1", 1, this.limits.feed_pause_max_min))}
        ${this.row("Filter off", this.chk(`${b}.filter_off`, f.filter_off), `Outlets with function Filter ${f.n} turn OFF while this runs`)}
        ${this.row("Timer activates", this.sel_(`${b}.timer`, [[0, "None (manual only)"], ...evTimers.map((n) => [n, `Timer ${n}${this.item("timers", n).name ? " · " + this.item("timers", n).name : ""}`])], f.timer), "Only Event start timers are listed")}
        <div class="right">${end ? this.btn("fp_stop", "Stop", f.n, "warn") : this.btn("fp_start", "Start", f.n, "primary")}</div></div>`;
    }).join("")}`;
  }

  p_maintenance() {
    const chOpts = range(1, this.limits.channels).map((n) => [n, `${n} · ${this.item("channels", n).name || this.item("channels", n).entity || "Switch channel " + n}`]);
    return `<h2>Maintenance / Power cut</h2>${this.cfg.maintenance.map((m, i) => {
      const b = `maintenance.${i}`, s = this.st(["maintenance", m.n]);
      const socks = (m.sockets || []).map((sk, k) => `<div class="entry">Socket ${this.sel_(`${b}.sockets.${k}.ch`, chOpts, sk.ch)} → ${this.sel_(`${b}.sockets.${k}.state`, [["off", "Turn OFF"], ["on", "Turn ON"]], sk.state)} ${this.btn("sock_del", "Remove", `${m.n}|${k}`, "small ghost")}</div>`).join("");
      return `<div class="form"><h3>Maintenance ${m.n} ${s ? `<span class="pill on">${s.power ? "POWER CUT" : "RUNNING " + this.remaining(s.end)}</span>` : ""}</h3>
        ${this.row("Description", this.txt(`${b}.name`, m.name))}
        <h4>Sockets</h4>${socks || "<em>No sockets</em>"}<div>${this.btn("sock_add", "Add socket", m.n, "small")}</div>
        ${this.row("Duration (min)", this.num(`${b}.minutes`, m.minutes, "1", 1, this.limits.maintenance_max_min), "240 minutes maximum")}
        ${this.row("Activate this maintenance program during power cut", this.chk(`${b}.power_cut`, m.power_cut), "Power cut monitoring is set under System")}
        ${m.power_cut ? this.row("When power returns", this.sel_(`${b}.after_power`, [["stop", "End the program"], ["run_duration", "Keep running for the duration above"]], m.after_power)) : ""}
        <div class="right">${s ? this.btn("mt_stop", "Stop", m.n, "warn") : this.btn("mt_start", "Start", m.n, "primary")}</div></div>`;
    }).join("")}`;
  }

  p_level() {
    const ls = this.cfg.level_sensors.map((s, i) => {
      const b = `level_sensors.${i}`;
      return `<div class="form compact"><h4>Level sensor ${s.n} <span data-live="sensor:${s.n}">${s.entity ? this.pill(this.st(["level_sensors", s.n]), "WATER", "DRY") : ""}</span></h4>
        ${this.row("Description", this.txt(`${b}.name`, s.name))}
        ${this.row("Source", this.entSel(`${b}.entity`, ["binary_sensor", "sensor", "switch", "input_boolean"], s.entity))}
        ${this.row("Water detected when state is", this.txt(`${b}.wet_states`, s.wet_states, "on"), "Comma separated. Ignored if the dry list is filled")}
        ${this.row("…or dry when state is", this.txt(`${b}.dry_states`, s.dry_states, "Normal"), "e.g. the Mini leak sensor reports Normal when dry")}
        ${this.row("Invert", this.chk(`${b}.invert`, s.invert), "Use for a return-pump low-level float")}
        ${this.row("Reaction time (s)", this.num(`${b}.reaction_s`, s.reaction_s, "1", 0))}</div>`;
    }).join("");
    const sOpts = [[0, "— none —"], ...range(1, this.limits.level_sensors).map((n) => [n, `Sensor ${n}${this.item("level_sensors", n).name ? " · " + this.item("level_sensors", n).name : ""}`])];
    const nTimers = range(1, this.limits.timers).filter((n) => this.item("timers", n).mode === "normal").map((n) => [n, `Timer ${n}`]);
    const eTimers = range(1, this.limits.timers).filter((n) => this.item("timers", n).mode === "event").map((n) => [n, `Timer ${n}`]);
    const circ = this.cfg.level_circuits.map((c, i) => {
      const b = `level_circuits.${i}`, s = this.st(["level", c.n], {});
      const two = ["minmax", "ato2", "wc", "ato_wc"].includes(c.mode), ato = ["ato", "minmax", "ato2", "ato_wc"].includes(c.mode), wc = ["wc", "ato_wc"].includes(c.mode);
      const l1 = c.mode === "minmax" || wc ? "Sensor 1 (lower / min)" : "Sensor 1", l2 = c.mode === "minmax" || wc ? "Sensor 2 (upper / max)" : "Sensor 2";
      return `<div class="form compact"><h4>Control circuit ${c.n} ${s.error ? `<span class="pill bad">ERROR</span>` : ""} ${s.phase ? `<span class="pill on">WC ${esc(s.phase)}</span>` : ""}</h4>
        ${this.row("Operation mode", this.sel_(`${b}.mode`, this.limits.level_modes.map((m) => [m, LEVEL_LABEL[m]]), c.mode, 'data-rerender="1"'))}
        ${c.mode === "off" ? "" : `
        ${this.row("Description", this.txt(`${b}.name`, c.name, c.mode === "leak" ? "Leak detection (Sump)" : "ATO"))}
        ${c.mode !== "leak" ? this.row("Maximum on-time (s)", this.num(`${b}.max_on_s`, c.max_on_s, "1", 0), "Failsafe: alarm and outlet OFF if exceeded. 0 disables") : ""}
        ${this.row("Reset error automatically", this.chk(`${b}.auto_reset`, c.auto_reset))}
        ${ato ? this.row("ATO always active", this.chk(`${b}.ato_always`, c.ato_always), "Off = ATO only while the selected Normal timer is ON") : ""}
        ${ato && !c.ato_always ? this.row("ATO timer", this.sel_(`${b}.ato_timer`, [[0, "— choose —"], ...nTimers], c.ato_timer)) : ""}
        ${wc ? this.row("Water change timer (Event start)", this.sel_(`${b}.wc_timer`, [[0, "None (manual only)"], ...eTimers], c.wc_timer)) : ""}
        ${this.row(l1, this.sel_(`${b}.sensor1`, sOpts, c.sensor1))}
        ${two ? this.row(l2, this.sel_(`${b}.sensor2`, sOpts, c.sensor2)) : ""}
        <p class="hint">${c.mode === "leak" ? `Outlets with function Fill water ${c.n} stay ON and turn OFF while this reports a leak.` : ""}
        ${ato ? `ATO pump outlet: function Fill water ATO only ${c.n}.` : ""} ${wc ? `AWC outlets: Drain water ${c.n} and Fill water AWC only ${c.n}. Sequence used: drain until sensor 1 is dry, then fill until sensor 2 detects water.` : ""}</p>
        <div class="right">${wc ? (s.phase ? this.btn("wc_stop", "Stop water change", c.n, "warn") : this.btn("wc_start", "Start water change", c.n)) : ""}${s.error ? this.btn("lvl_reset", "Reset error", c.n, "warn") : ""}</div>`}</div>`;
    }).join("");
    return `<h2>Level control</h2><h3>Control circuits</h3><div class="grid2">${circ}</div><h3>Sensors</h3><div class="grid2">${ls}</div>`;
  }

  p_logic() {
    const sum = (g) => {
      const a = `${g.in1?.invert ? "NOT " : ""}${this.fnSummary(g.in1)}`;
      if (g.op === "delayed_on" || g.op === "delayed_off") return `${OP_LABEL[g.op]} ${g.seconds}s (${a})`;
      return `${a} ${OP_LABEL[g.op]} ${g.in2?.invert ? "NOT " : ""}${this.fnSummary(g.in2)}`;
    };
    const tabs = [1, 2, 3, 4].map((t) => `<div class="tab ${this.tab === t ? "act" : ""}" data-tab="${t}">${(t - 1) * 8 + 1}–${t * 8}</div>`).join("");
    const start = (Math.min(this.tab, 4) - 1) * 8 + 1;
    const list = range(start, start + 7).map((n) => {
      const g = this.item("logic", n);
      return `<div class="chrow click ${this.sel === n ? "selrow" : ""}" data-open="${n}"><b>${n}</b><span class="grow">${esc(g.name || "Programmable logic " + n)}<small>${esc(sum(g))}</small></span>${this.pill(this.st(["logic", n]))}</div>`;
    }).join("");
    let form = "";
    const i = this.idx("logic", this.sel);
    if (i >= 0) {
      const g = this.cfg.logic[i], b = `logic.${i}`, delayed = g.op === "delayed_on" || g.op === "delayed_off";
      form = `<div class="form"><h3>Programmable logic ${g.n}</h3>
        ${this.row("Description", this.txt(`${b}.name`, g.name))}
        ${this.row("Operator", this.sel_(`${b}.op`, this.limits.logic_ops.map((o) => [o, OP_LABEL[o]]), g.op, 'data-rerender="1"'))}
        <h4>Input${delayed ? "" : " 1"}</h4>${this.fnEditor(`${b}.in1`, g.in1 || {}, true)}
        ${delayed ? this.row("Duration (s)", this.num(`${b}.seconds`, g.seconds, "1", 0), g.op === "delayed_on" ? "Output turns ON only after the input has been ON this long; OFF at once" : "Output turns ON at once; stays ON this long after the input goes OFF")
          : `<h4>Input 2</h4>${this.fnEditor(`${b}.in2`, g.in2 || {}, true)}`}
        <p class="hint">Assign to an outlet under Switch channels → Function: Programmable logic ${g.n}, or use it as an input of another gate.</p></div>`;
    }
    return `<h2>Programmable logic</h2><div class="tabs">${tabs}</div><div class="split"><div class="list">${list}</div>${form}</div>`;
  }

  p_reminders() {
    return `<h2>Reminders</h2><div class="grid2">${this.cfg.reminders.map((r, i) => {
      const b = `reminders.${i}`;
      return `<div class="form compact"><h4>Reminder ${r.n}</h4>
        ${this.row("Enabled", this.chk(`${b}.enabled`, r.enabled))}
        ${this.row("Text", this.txt(`${b}.text`, r.text, "Replace carbon"))}
        ${this.row("Remind in (days)", this.num(`${b}.days`, r.days, "1", 0))}
        ${this.row("Counting from", `${this.txt(`${b}.start`, r.start, "", "date")} ${this.btn("start_date_today", "Today", `reminders|${i}|start`, "small ghost")}`)}
        ${this.row("Repeat reminder", this.chk(`${b}.repeat`, r.repeat))}</div>`;
    }).join("")}</div>`;
  }

  p_notify() {
    const n = this.cfg.notify || {};
    const svcs = Object.keys(this._hass.services.notify || {}).map((s) => `notify.${s}`).sort();
    const cur = new Set(n.targets || []);
    return `<h2>Notifications</h2><div class="form">
      ${this.row("Send to", `<select multiple size="6" data-bind="notify.targets" data-kind="multi">${svcs.map((s) => `<option value="${esc(s)}" ${cur.has(s) ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`, "Ctrl/Cmd-click to pick several")}
      ${this.row("When a new alarm occurs", this.chk("notify.on_new_alarm", n.on_new_alarm))}
      ${this.row("When alarms clear", this.chk("notify.on_clear", n.on_clear))}
      ${this.row("Repeat while an alarm is active (min)", this.num("notify.repeat_min", n.repeat_min, "1", 0), "0 = don't repeat")}
      ${this.row("Daily status at", this.txt("notify.daily_at", n.daily_at, "", "time"), "Leave empty for none")}</div>
      <p class="hint">The integration also creates binary_sensor entities (Alarm, Feed pause 1–4, Maintenance 1–4, Water change, Power cut) you can use in your own automations, such as your Alexa announcement.</p>`;
  }

  p_system() {
    const pc = this.cfg.power_cut || {};
    return `<h2>System</h2>
      <h3>Power cut monitoring</h3><div class="form">
      ${this.row("Enable", this.chk("power_cut.enabled", pc.enabled))}
      ${this.row("Source", this.entSel("power_cut.entity", ["sensor", "binary_sensor", "input_boolean"], pc.entity), "e.g. the inverter or EcoFlow AC input voltage")}
      ${this.row("Power is cut when", this.sel_("power_cut.mode", [["below", "Value is below"], ["state", "State equals"]], pc.mode, 'data-rerender="1"'))}
      ${pc.mode === "state" ? this.row("State", this.txt("power_cut.state", pc.state, "on")) : this.row("Threshold", this.num("power_cut.threshold", pc.threshold, "any"))}
      ${this.row("Now", this.pill(this.st(["power_cut"]), "POWER CUT", "OK"))}</div>
      <h3>Data source</h3><div class="form">
      ${this.row("Source status sensor", this.entSel("data_source.entity", ["sensor", "binary_sensor"], (this.cfg.data_source || {}).entity), "e.g. your GHL bridge connection sensor. Probe data counts as missing unless this reads OK")}
      ${this.row("OK when state is", this.txt("data_source.ok_states", (this.cfg.data_source || {}).ok_states, "Connected"), "Comma separated")}
      ${this.row("Also treat readings older than (min) as missing", this.num("data_timeout_min", this.cfg.data_timeout_min, "1", 0), "0 = off. Leave off if your sensors only report when the value changes")}</div>
      <p class="hint">Settings are stored in Home Assistant and included in Home Assistant backups. Probe calibration, firmware and Wi-Fi settings stay on the GHL controller.</p>`;
  }
}

const STYLE = `<style>
:host{--b:#0069b4;--bd:var(--divider-color,#e0e0e0);--bg2:var(--secondary-background-color,#f5f7fa);--t2:var(--secondary-text-color,#667)}
ha-card{overflow:hidden}
.head{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#0058a0,#0069b4 60%,#1b86cf);color:#fff;padding:12px 16px}
.title{font-size:20px;font-weight:700}.title small{display:block;font-size:12px;font-weight:400;opacity:.8}
.bell{position:relative;cursor:pointer;padding:6px}.bell.alarm{color:#ffd54f}.bell b{position:absolute;top:0;right:-4px;background:#d32f2f;color:#fff;border-radius:9px;font-size:11px;padding:0 5px}
.wrap{display:flex;min-height:600px}.menu{width:220px;border-right:1px solid var(--bd);background:var(--bg2);flex:none}
.nav{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;font-size:14px;border-left:3px solid transparent}
.nav:hover{background:rgba(0,105,180,.08)}.nav.act{border-left-color:var(--b);background:rgba(0,105,180,.12);font-weight:600;color:var(--b)}
.main{flex:1;padding:4px 18px 18px;min-width:0}
h2{margin:12px 0 8px;font-size:20px}h3{margin:18px 0 8px;font-size:15px;color:var(--b);text-transform:uppercase;letter-spacing:.04em}h4{margin:12px 0 6px;font-size:14px}
.savebar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;justify-content:flex-end;min-height:34px;padding:4px 0;background:var(--card-background-color,#fff);font-size:13px;color:var(--t2)}
.savebar.dirty{color:#b26a00}.savebar span{margin-right:auto}
.btn{border:1px solid var(--b);background:transparent;color:var(--b);border-radius:8px;padding:6px 14px;font-size:14px;cursor:pointer;margin:2px}
.btn.primary{background:var(--b);color:#fff}.btn.warn{border-color:#d32f2f;color:#d32f2f}.btn.ghost{border-color:var(--bd);color:var(--t2)}.btn.small{padding:3px 9px;font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile{border:1px solid var(--bd);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:4px}.tile small{color:var(--t2)}.tile.bad{border-color:#d32f2f}
.big{font-size:28px;font-weight:700;color:var(--b)}
.list{border:1px solid var(--bd);border-radius:10px;overflow:hidden}.list.scroll{max-height:640px;overflow:auto}
.chrow{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--bd)}.chrow:last-child{border-bottom:none}
.chrow b{width:26px;color:var(--b)}.chrow .grow{flex:1;min-width:0}.chrow small{display:block;color:var(--t2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chrow .act{color:var(--t2);font-size:12px;white-space:nowrap}.click{cursor:pointer}.click:hover,.selrow{background:rgba(0,105,180,.08)}
.pill{border-radius:9px;padding:2px 9px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap}.pill.on{background:#1f9d55}.pill.off{background:#8a9aa9}.pill.na{background:#c4ccd4}.pill.bad,.pill.warn{background:#d32f2f}
.split{display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1.3fr);gap:14px;align-items:start}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
.form{border:1px solid var(--bd);border-radius:10px;padding:6px 14px 12px;margin:10px 0}.form.compact{margin:0}
.row{display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px dashed var(--bd)}.row:last-of-type{border-bottom:none}
.lab{flex:1;font-size:14px}.lab small{display:block;color:var(--t2);font-size:12px}.ctl{flex:1.2;min-width:0;display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap}.ctl select{max-width:100%;min-width:0;width:100%}
input,select{font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--card-background-color,#fff);color:var(--primary-text-color);max-width:100%}
input[type=number]{width:100px}select{min-width:180px}input[type=color]{width:60px;padding:2px}
.sw{position:relative;width:40px;height:22px}.sw input{opacity:0;width:0;height:0}.sw span{position:absolute;inset:0;background:#c4ccd4;border-radius:11px;cursor:pointer;transition:.2s}
.sw span:before{content:"";position:absolute;width:18px;height:18px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.2s}.sw input:checked+span{background:var(--b)}.sw input:checked+span:before{transform:translateX(18px)}
.entry{display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap}.wd{margin-right:8px;font-size:13px}
.tabs{display:flex;gap:4px;margin-bottom:8px}.tab{padding:6px 14px;border-bottom:2px solid transparent;cursor:pointer;color:var(--t2)}.tab.act{border-bottom-color:var(--b);color:var(--b);font-weight:600}
.alarms{border:1px solid #d32f2f;background:rgba(211,47,47,.06);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:4px}
.ok{border:1px solid #1f9d55;background:rgba(31,157,85,.06);border-radius:10px;padding:8px 12px;color:#1f9d55}
.hint{color:var(--t2);font-size:13px}.right{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.pad{padding:16px}.err{color:#d32f2f}
@media (max-width:900px){.wrap{flex-direction:column}.menu{width:auto;display:flex;overflow-x:auto;border-right:none;border-bottom:1px solid var(--bd)}.nav span{white-space:nowrap}.split{grid-template-columns:1fr}}
</style>`;

if (!customElements.get("sentinel-controller-card")) customElements.define("sentinel-controller-card", SentinelControllerCard);
window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "sentinel-controller-card"))
  window.customCards.push({ type: "sentinel-controller-card", name: "Sentinel Controller", description: "Reef controller for Home Assistant" });
})();
