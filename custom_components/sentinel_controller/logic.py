"""Sentinel Controller logic core.

Models the control scheme described in the GHL "ProfiLux 4 / 4e Resource Guide (GHL Connect
edition)": sensors with nominal value / hysteresis / alarm deviation, switch channels with an
assigned function, timers (Normal / Event start), non-dimmable illumination channels with
temperature-dependent light reduction, feed pauses, maintenance modes (incl. power-cut program),
level control circuits (ATO, Min/Max, ATO with 2 sensors, water change, ATO & water change,
leakage detection), programmable logic gates (AND, OR, Delayed ON, Delayed OFF) and reminders.

This module has no Home Assistant imports so it can be unit tested on its own.
Values are tri-state: True, False or None (unknown -> the channel uses its fallback state).
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

N_CHANNELS = 48
N_TIMERS = 32
N_ILLUMINATION = 16
N_FEED_PAUSES = 4
N_MAINTENANCE = 4
N_LEVEL_CIRCUITS = 8
N_LEVEL_SENSORS = 8
N_LOGIC = 32
N_REMINDERS = 16
N_PROBES = 8

FEED_PAUSE_MAX_MIN = 120
MAINTENANCE_MAX_MIN = 240

UNKNOWN_STATES = {"unknown", "unavailable", "", "none"}

# Function types a switch channel (or a logic input) can be assigned.
FN_TYPES = [
    "always_off", "always_on",
    "temperature",      # param: probe id, mode: heater|cooler
    "ph",               # param: probe id, mode: up|down
    "timer",            # param: timer number (Normal mode timers)
    "illumination",     # param: illumination channel number
    "filter",           # param: feed pause number (OFF while that feed pause runs, if Filter off)
    "maintenance",      # param: maintenance number (ON while that maintenance mode runs)
    "fill_water",       # param: level circuit number (ON unless the circuit is in alarm)
    "fill_ato",         # param: level circuit number (ATO pump)
    "fill_awc",         # param: level circuit number (AWC fill pump)
    "drain_water",      # param: level circuit number (AWC drain pump)
    "logic",            # param: programmable logic gate number
]

LEVEL_MODES = ["off", "ato", "minmax", "ato2", "wc", "ato_wc", "leak"]
LOGIC_OPS = ["and", "or", "delayed_on", "delayed_off"]


def _b_and(a, b):
    if a is False or b is False:
        return False
    if a is None or b is None:
        return None
    return True


def _b_or(a, b):
    if a is True or b is True:
        return True
    if a is None or b is None:
        return None
    return False


def _inv(v, invert):
    if v is None or not invert:
        return v
    return not v


def _to_float(state):
    try:
        return float(state)
    except (TypeError, ValueError):
        return None


def _hm(s: str | None) -> int | None:
    """'HH:MM' -> minutes after midnight."""
    if not s:
        return None
    try:
        h, m = s.split(":")[:2]
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def select_option(options, want: bool) -> str | None:
    """Option on an outlet-style select (Apex 'Off / Auto / On') that means on or off, in its own spelling."""
    target = "on" if want else "off"
    return next((o for o in options or [] if str(o).strip().lower() == target), None)


def default_config() -> dict[str, Any]:
    return {
        "version": 1,
        "probes": [],
        "level_sensors": [{"n": i, "name": "", "entity": "", "wet_states": "on", "dry_states": "",
                           "invert": False, "reaction_s": 0} for i in range(1, N_LEVEL_SENSORS + 1)],
        "timers": [{"n": i, "name": "", "mode": "normal", "entries": [], "day_mode": "weekdays",
                    "weekdays": [0, 1, 2, 3, 4, 5, 6], "every_days": 1, "start_date": ""}
                   for i in range(1, N_TIMERS + 1)],
        "illumination": [{"n": i, "name": "", "color": "#2196f3", "entries": [], "temp_reduction": False}
                         for i in range(1, N_ILLUMINATION + 1)],
        "light_reduction": {"probe": "", "limit": 3.0},
        "feed_pauses": [{"n": i, "name": f"Feed pause {i}", "minutes": 5, "filter_off": True, "timer": 0}
                        for i in range(1, N_FEED_PAUSES + 1)],
        "maintenance": [{"n": i, "name": f"Maintenance {i}", "minutes": 60, "sockets": [],
                         "power_cut": False, "after_power": "stop"} for i in range(1, N_MAINTENANCE + 1)],
        "level_circuits": [{"n": i, "name": "", "mode": "off", "max_on_s": 300, "auto_reset": True,
                            "ato_always": True, "ato_timer": 0, "wc_timer": 0, "sensor1": 0, "sensor2": 0}
                           for i in range(1, N_LEVEL_CIRCUITS + 1)],
        "logic": [{"n": i, "name": "", "op": "and",
                   "in1": {"type": "always_off", "param": 0, "mode": "", "invert": False},
                   "in2": {"type": "always_off", "param": 0, "mode": "", "invert": False},
                   "seconds": 1} for i in range(1, N_LOGIC + 1)],
        "channels": [{"n": i, "name": "", "entity": "",
                      "fn": {"type": "always_off", "param": 0, "mode": ""},
                      "invert": False, "blackout_min": 0, "fallback": "off", "manual": "off"}
                     for i in range(1, N_CHANNELS + 1)],
        "manual_override": False,
        "reminders": [{"n": i, "text": "", "days": 30, "repeat": True, "start": "", "enabled": False}
                      for i in range(1, N_REMINDERS + 1)],
        "power_cut": {"enabled": False, "entity": "", "mode": "below", "threshold": 80.0, "state": "on"},
        "notify": {"targets": [], "on_new_alarm": True, "on_clear": False, "repeat_min": 0, "daily_at": ""},
        "data_timeout_min": 0,
        "data_source": {"entity": "", "ok_states": "Connected"},
        "controllers": [],  # [{"device_id", "name", "outlets"?}]; empty = auto-detect in the card
        "source_kinds": {},  # device_id -> "controller" | "strip" | "other": the user's fix to the card's guess
    }


def merge_config(saved: dict | None) -> dict:
    """Fill in anything missing from a saved config (keeps forward compatibility)."""
    base = default_config()
    if not saved:
        return base
    out = deepcopy(base)
    for key, val in saved.items():
        if key not in out:
            continue
        if isinstance(out[key], list) and isinstance(val, list) and out[key] and "n" in out[key][0]:
            by_n = {item.get("n"): item for item in val if isinstance(item, dict)}
            merged = []
            for item in out[key]:
                s = by_n.get(item["n"])
                if s:
                    m = deepcopy(item)
                    m.update(s)
                    merged.append(m)
                else:
                    merged.append(item)
            out[key] = merged
        elif isinstance(out[key], dict) and isinstance(val, dict):
            out[key].update(val)
        else:
            out[key] = val
    return out


@dataclass
class Input:
    state: str | None
    updated: datetime | None  # last time the entity reported (last_reported / last_updated)


class Controller:
    """Holds config + runtime state; tick() evaluates everything for one moment."""

    def __init__(self, config: dict | None = None, runtime: dict | None = None, started: datetime | None = None):
        self.config = merge_config(config)
        self.rt: dict[str, Any] = runtime or {}
        self.rt.setdefault("fp", {})            # n -> end iso
        self.rt.setdefault("maint", {})         # n -> {"end": iso|None, "power": bool}
        self.rt.setdefault("ctl", {})           # control latch per probe+mode
        self.rt.setdefault("minmax", {})        # circuit -> running bool
        self.rt.setdefault("lvl", {})           # circuit -> {"error": str|None, "run_since": iso|None, "wc": phase|None, "phase_since": iso}
        self.rt.setdefault("sensor", {})        # level sensor n -> {"raw": bool|None, "since": iso, "acc": bool|None}
        self.rt.setdefault("gate", {})          # gate n -> {"in": bool|None, "since": iso, "out": bool|None}
        self.rt.setdefault("events", {})        # timer n -> last fired key
        self.rt.setdefault("lightred", "")      # date string when reduction latched
        self.rt.setdefault("power", {"cut": False, "since": None})
        self.rt.setdefault("blackout_from", None)
        self.rt.setdefault("manual", {})        # channel n -> "on"/"off" snapshot when override enabled
        self.rt.setdefault("reminder_ack", {})  # n -> iso date of last ack (repeat anchor)
        self.started = started
        if started is not None and self.rt.get("blackout_from") is None:
            self.rt["blackout_from"] = started.isoformat()
        self.last: dict[str, Any] = {}

    # ---------- helpers ----------
    def _probe(self, pid: str) -> dict | None:
        for p in self.config["probes"]:
            if p.get("id") == pid:
                return p
        return None

    def _item(self, key: str, n: int) -> dict | None:
        for it in self.config[key]:
            if it.get("n") == n:
                return it
        return None

    @staticmethod
    def _iso(dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None

    @staticmethod
    def _dt(s: str | None) -> datetime | None:
        if not s:
            return None
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            return None

    # ---------- probes ----------
    def probe_value(self, p: dict, inputs: dict[str, Input], now: datetime) -> float | None:
        ent = p.get("entity")
        if not ent:
            return None
        inp = inputs.get(ent)
        if not inp or inp.state is None or str(inp.state).lower() in UNKNOWN_STATES:
            return None
        v = _to_float(inp.state)
        if v is None:
            return None
        if not self._source_ok(inputs, p.get("status_entity"), p.get("status_ok")):
            return None
        timeout = float(self.config.get("data_timeout_min") or 0)
        if timeout > 0 and inp.updated is not None and (now - inp.updated) > timedelta(minutes=timeout):
            return None
        return v

    def _source_ok(self, inputs: dict[str, Input], ent: str | None = None, ok_states: str | None = None) -> bool:
        """Data-source check, e.g. a bridge connection sensor that must read 'Connected'.
        A probe's own status sensor wins; otherwise the global data_source applies."""
        if not ent:
            ds = self.config.get("data_source") or {}
            ent, ok_states = ds.get("entity"), ds.get("ok_states")
        if not ent:
            return True
        inp = inputs.get(ent)
        if not inp or inp.state is None:
            return False
        ok = [x.strip().lower() for x in str(ok_states or "").split(",") if x.strip()]
        return str(inp.state).strip().lower() in ok if ok else str(inp.state).lower() not in UNKNOWN_STATES

    def _probe_alarm(self, p: dict, v: float | None, wc_active: bool) -> bool:
        a = p.get("alarm") or {}
        if not a.get("active") or v is None:
            return False
        if a.get("no_alarm_on_wc") and wc_active:
            return False
        try:
            dev = float(a.get("deviation", 0))
            nom = float(p.get("nominal", 0))
        except (TypeError, ValueError):
            return False
        return abs(v - nom) > dev

    def _control(self, pid: str, mode: str, values: dict, alarms_by_probe: dict) -> bool | None:
        p = self._probe(pid)
        if not p:
            return None
        v = values.get(pid)
        if v is None:
            return None
        a = p.get("alarm") or {}
        if a.get("deactivate_control") and alarms_by_probe.get(pid):
            return False
        nom = float(p.get("nominal", 0))
        half = float(p.get("hysteresis", 0)) / 2.0
        key = f"{pid}:{mode}"
        prev = self.rt["ctl"].get(key, False)
        # "on when low" functions: heater, pH up. "on when high": cooler, pH down (decrease).
        on_when_low = mode in ("heater", "up")
        if on_when_low:
            if v <= nom - half:
                out = True
            elif v >= nom + half:
                out = False
            else:
                out = prev
        else:
            if v >= nom + half:
                out = True
            elif v <= nom - half:
                out = False
            else:
                out = prev
        self.rt["ctl"][key] = out
        return out

    # ---------- timers ----------
    def _day_active(self, t: dict, day: date) -> bool:
        if t.get("day_mode") == "interval":
            every = max(1, int(t.get("every_days") or 1))
            try:
                anchor = date.fromisoformat(t.get("start_date")) if t.get("start_date") else None
            except ValueError:
                anchor = None
            if anchor is None:
                return True
            delta = (day - anchor).days
            return delta >= 0 and delta % every == 0
        return day.weekday() in (t.get("weekdays") or [])

    def _in_entries(self, entries: list, now: datetime, day_ok) -> bool:
        m = now.hour * 60 + now.minute
        today = now.date()
        yesterday = today - timedelta(days=1)
        for e in entries or []:
            on, off = _hm(e.get("on")), _hm(e.get("off"))
            if on is None or off is None or on == off:
                continue
            if on < off:
                if on <= m < off and day_ok(today):
                    return True
            else:  # crosses midnight
                if m >= on and day_ok(today):
                    return True
                if m < off and day_ok(yesterday):
                    return True
        return False

    def timer_value(self, n: int, now: datetime) -> bool | None:
        t = self._item("timers", n)
        if not t or t.get("mode") != "normal":
            return None
        return self._in_entries(t.get("entries"), now, lambda d: self._day_active(t, d))

    def _fire_events(self, now: datetime) -> list[int]:
        fired = []
        m = now.hour * 60 + now.minute
        for t in self.config["timers"]:
            if t.get("mode") != "event" or not self._day_active(t, now.date()):
                continue
            for e in t.get("entries") or []:
                at = _hm(e.get("on"))
                if at is not None and at == m:
                    key = f"{now.date().isoformat()}T{e.get('on')}"
                    if self.rt["events"].get(str(t["n"])) != key:
                        self.rt["events"][str(t["n"])] = key
                        fired.append(t["n"])
        return fired

    # ---------- illumination ----------
    def illum_value(self, n: int, now: datetime) -> bool | None:
        c = self._item("illumination", n)
        if not c:
            return None
        on = self._in_entries(c.get("entries"), now, lambda d: True)
        if on and c.get("temp_reduction") and self.rt.get("lightred") == now.date().isoformat():
            return False
        return on

    # ---------- feed pause / maintenance ----------
    def fp_active(self, n: int, now: datetime) -> bool:
        end = self._dt(self.rt["fp"].get(str(n)))
        return bool(end and now < end)

    def start_feed_pause(self, n: int, now: datetime) -> None:
        fp = self._item("feed_pauses", n)
        if not fp:
            raise ValueError(f"No feed pause {n}")
        mins = max(1, min(FEED_PAUSE_MAX_MIN, int(fp.get("minutes") or 1)))
        self.rt["fp"][str(n)] = (now + timedelta(minutes=mins)).isoformat()

    def stop_feed_pause(self, n: int) -> None:
        self.rt["fp"].pop(str(n), None)

    def maint_active(self, n: int, now: datetime) -> bool:
        st = self.rt["maint"].get(str(n))
        if not st:
            return False
        if st.get("power"):
            return True
        end = self._dt(st.get("end"))
        return bool(end and now < end)

    def start_maintenance(self, n: int, now: datetime) -> None:
        mt = self._item("maintenance", n)
        if not mt:
            raise ValueError(f"No maintenance mode {n}")
        mins = max(1, min(MAINTENANCE_MAX_MIN, int(mt.get("minutes") or 1)))
        self.rt["maint"][str(n)] = {"end": (now + timedelta(minutes=mins)).isoformat(), "power": False}

    def stop_maintenance(self, n: int) -> None:
        self.rt["maint"].pop(str(n), None)

    # ---------- level ----------
    def _level_sensor(self, n: int, inputs: dict[str, Input], now: datetime) -> bool | None:
        """True = sensor detects water (after invert and reaction time)."""
        s = self._item("level_sensors", n)
        if not s or not s.get("entity"):
            return None
        inp = inputs.get(s["entity"])
        raw: bool | None
        if not inp or inp.state is None or str(inp.state).lower() in UNKNOWN_STATES:
            raw = None
        else:
            st = str(inp.state).strip().lower()
            dry = [x.strip().lower() for x in str(s.get("dry_states") or "").split(",") if x.strip()]
            wet = [x.strip().lower() for x in str(s.get("wet_states") or "").split(",") if x.strip()]
            if dry:
                raw = st not in dry
            else:
                raw = st in wet
            raw = _inv(raw, s.get("invert"))
        rec = self.rt["sensor"].setdefault(str(n), {"raw": raw, "since": now.isoformat(), "acc": raw})
        if rec.get("raw") != raw:
            rec["raw"] = raw
            rec["since"] = now.isoformat()
        since = self._dt(rec.get("since")) or now
        if raw is None:
            rec["acc"] = None
        elif (now - since).total_seconds() >= float(s.get("reaction_s") or 0):
            rec["acc"] = raw
        return rec.get("acc")

    def start_water_change(self, n: int, now: datetime) -> None:
        c = self._item("level_circuits", n)
        if not c or c.get("mode") not in ("wc", "ato_wc"):
            raise ValueError(f"Level circuit {n} is not a water change circuit")
        st = self.rt["lvl"].setdefault(str(n), {})
        if st.get("error"):
            raise ValueError(f"Level circuit {n} has an error; reset it first")
        st["wc"] = "drain"
        st["phase_since"] = now.isoformat()

    def stop_water_change(self, n: int) -> None:
        st = self.rt["lvl"].setdefault(str(n), {})
        st["wc"] = None
        st["phase_since"] = None

    def reset_level_error(self, n: int) -> None:
        st = self.rt["lvl"].setdefault(str(n), {})
        st["error"] = None
        st["run_since"] = None
        st["wc"] = None
        st["phase_since"] = None

    def _level_eval(self, c: dict, sens: dict[int, bool | None], now: datetime, timer_on) -> dict:
        """Returns {"fill_water","fill_ato","fill_awc","drain_water","wc_active"} for a circuit."""
        n = c["n"]
        mode = c.get("mode", "off")
        st = self.rt["lvl"].setdefault(str(n), {})
        out = {"fill_water": True, "fill_ato": False, "fill_awc": False, "drain_water": False, "wc_active": False}
        if mode == "off":
            st.clear()
            return out
        s1 = sens.get(int(c.get("sensor1") or 0))
        s2 = sens.get(int(c.get("sensor2") or 0))
        max_on = float(c.get("max_on_s") or 0)

        # ---- leakage detection: sensor detecting water = alarm, fill_water OFF ----
        if mode == "leak":
            if s1 is True:
                st["error"] = "Leak detected"
            elif s1 is False and st.get("error") and c.get("auto_reset", True):
                st["error"] = None
            if s1 is None and not st.get("error"):
                out["fill_water"] = None
            else:
                out["fill_water"] = not bool(st.get("error"))
            return out

        # ---- error latch (max on-time) ----
        if st.get("error"):
            # Auto reset once normal operation is detected: the sensor that should be satisfied is.
            normal = None
            if mode in ("ato", "ato2"):
                normal = s1 is True or (mode == "ato2" and s2 is True)
            elif mode == "minmax":
                normal = s2 is True
            elif mode in ("wc", "ato_wc"):
                normal = s2 is True
            if c.get("auto_reset", True) and normal:
                st["error"] = None
                st["run_since"] = None
            else:
                out["fill_water"] = False
                return out

        # ---- water change state machine ----
        if mode in ("wc", "ato_wc") and st.get("wc"):
            out["wc_active"] = True
            since = self._dt(st.get("phase_since")) or now
            if st["wc"] == "drain":
                if s1 is False:  # lower (min) sensor no longer sees water -> start filling
                    st["wc"] = "fill"
                    st["phase_since"] = now.isoformat()
                    since = now
                else:
                    out["drain_water"] = s1 is True
            if st["wc"] == "fill":
                if s2 is True:  # upper (max) sensor sees water -> done
                    st["wc"] = None
                    st["phase_since"] = None
                    out["wc_active"] = False
                else:
                    out["fill_awc"] = s2 is False
            if st.get("wc") and max_on > 0 and (now - since).total_seconds() > max_on:
                st["error"] = f"Water change {st['wc']} exceeded maximum on-time"
                st["wc"] = None
                out.update({"drain_water": False, "fill_awc": False, "fill_water": False, "wc_active": False})
                return out
            if out["wc_active"]:
                return out  # ATO paused during the water change

        # ---- ATO ----
        if mode in ("ato", "minmax", "ato2", "ato_wc"):
            gate_ok = True
            if not c.get("ato_always", True):
                gate_ok = bool(timer_on(int(c.get("ato_timer") or 0)))
            want: bool | None
            if mode == "ato":
                want = None if s1 is None else (not s1)
            elif mode == "ato2":
                want = None if (s1 is None or s2 is None) else (not s1 and not s2)
            elif mode == "ato_wc":
                want = None if s2 is None else (not s2)  # top (max-point) sensor serves ATO
            else:  # minmax: start at lower sensor dry, stop at upper sensor wet
                run = self.rt["minmax"].get(str(n), False)
                if s2 is True:
                    run = False
                elif s1 is False:
                    run = True
                self.rt["minmax"][str(n)] = run
                want = None if (s1 is None and s2 is None) else run
            if want is None:
                st["run_since"] = None
                out["fill_ato"] = None
                return out
            want = want and gate_ok
            if want:
                rs = self._dt(st.get("run_since"))
                if rs is None:
                    st["run_since"] = now.isoformat()
                elif max_on > 0 and (now - rs).total_seconds() > max_on:
                    st["error"] = "ATO exceeded maximum on-time"
                    st["run_since"] = None
                    out["fill_water"] = False
                    return out
            else:
                st["run_since"] = None
            out["fill_ato"] = want
        return out

    # ---------- reminders ----------
    def reminders_due(self, today: date) -> list[dict]:
        due = []
        for r in self.config["reminders"]:
            if not r.get("enabled") or not r.get("text"):
                continue
            anchor = self.rt["reminder_ack"].get(str(r["n"])) or r.get("start")
            try:
                a = date.fromisoformat(anchor) if anchor else None
            except ValueError:
                a = None
            if a is None:
                continue
            if (today - a).days >= int(r.get("days") or 0):
                due.append(r)
        return due

    def ack_reminder(self, n: int, today: date) -> None:
        r = self._item("reminders", n)
        if not r:
            raise ValueError(f"No reminder {n}")
        if r.get("repeat"):
            self.rt["reminder_ack"][str(n)] = today.isoformat()
        else:
            r["enabled"] = False
            self.rt["reminder_ack"].pop(str(n), None)

    # ---------- manual override ----------
    def set_manual_override(self, on: bool, current: dict[int, bool | None]) -> None:
        if on and not self.config.get("manual_override"):
            for ch in self.config["channels"]:
                ch["manual"] = "on" if current.get(ch["n"]) else "off"
        self.config["manual_override"] = bool(on)

    # ---------- power cut ----------
    def _power_cut(self, inputs: dict[str, Input]) -> bool | None:
        pc = self.config.get("power_cut") or {}
        if not pc.get("enabled") or not pc.get("entity"):
            return False
        inp = inputs.get(pc["entity"])
        if not inp or inp.state is None or str(inp.state).lower() in UNKNOWN_STATES:
            return None
        if pc.get("mode") == "state":
            return str(inp.state).lower() == str(pc.get("state", "on")).lower()
        v = _to_float(inp.state)
        if v is None:
            return None
        return v < float(pc.get("threshold") or 0)

    # ---------- main ----------
    def tick(self, now: datetime, inputs: dict[str, Input]) -> dict[str, Any]:
        cfg = self.config
        alarms: list[dict] = []

        # Power cut monitoring -> maintenance programs flagged for power cut
        cut = self._power_cut(inputs)
        pw = self.rt["power"]
        if cut is True and not pw.get("cut"):
            pw.update({"cut": True, "since": now.isoformat()})
            for mt in cfg["maintenance"]:
                if mt.get("power_cut"):
                    self.rt["maint"][str(mt["n"])] = {"end": None, "power": True}
        elif cut is False and pw.get("cut"):
            pw.update({"cut": False, "since": now.isoformat()})
            self.rt["blackout_from"] = now.isoformat()
            for mt in cfg["maintenance"]:
                st = self.rt["maint"].get(str(mt["n"]))
                if st and st.get("power"):
                    if mt.get("after_power") == "run_duration":
                        mins = max(1, min(MAINTENANCE_MAX_MIN, int(mt.get("minutes") or 1)))
                        self.rt["maint"][str(mt["n"])] = {"end": (now + timedelta(minutes=mins)).isoformat(),
                                                          "power": False}
                    else:
                        self.rt["maint"].pop(str(mt["n"]), None)
        if pw.get("cut"):
            alarms.append({"key": "power_cut", "text": "Power cut detected"})
        if cut is None and (cfg.get("power_cut") or {}).get("enabled"):
            alarms.append({"key": "power_cut_source", "text": "Power cut monitoring source unavailable"})

        # Timer events (Event start) -> feed pauses / water changes
        for tn in self._fire_events(now):
            for fp in cfg["feed_pauses"]:
                if int(fp.get("timer") or 0) == tn:
                    self.start_feed_pause(fp["n"], now)
            for c in cfg["level_circuits"]:
                if c.get("mode") in ("wc", "ato_wc") and int(c.get("wc_timer") or 0) == tn:
                    st = self.rt["lvl"].setdefault(str(c["n"]), {})
                    if not st.get("error") and not st.get("wc"):
                        self.start_water_change(c["n"], now)

        # Clean finished feed pauses / maintenance
        for k, v in list(self.rt["fp"].items()):
            end = self._dt(v)
            if not end or now >= end:
                self.rt["fp"].pop(k, None)
        for k, v in list(self.rt["maint"].items()):
            if not v.get("power"):
                end = self._dt(v.get("end"))
                if not end or now >= end:
                    self.rt["maint"].pop(k, None)

        # Level sensors + circuits
        sens = {s["n"]: self._level_sensor(s["n"], inputs, now) for s in cfg["level_sensors"]}
        timer_cache: dict[int, bool | None] = {}

        def timer_on(n: int) -> bool | None:
            if n not in timer_cache:
                timer_cache[n] = self.timer_value(n, now) if n else None
            return timer_cache[n]

        level = {c["n"]: self._level_eval(c, sens, now, timer_on) for c in cfg["level_circuits"]}
        wc_active = any(v["wc_active"] for v in level.values())
        for c in cfg["level_circuits"]:
            err = self.rt["lvl"].get(str(c["n"]), {}).get("error")
            if err:
                alarms.append({"key": f"level_{c['n']}", "text": f"{c.get('name') or 'Level circuit ' + str(c['n'])}: {err}"})

        # Probes
        values: dict[str, float | None] = {}
        alarms_by_probe: dict[str, bool] = {}
        for p in cfg["probes"]:
            v = self.probe_value(p, inputs, now)
            values[p["id"]] = v
            if p.get("entity") and v is None:
                alarms.append({"key": f"probe_{p['id']}_fault", "text": f"{p.get('name') or p['id']}: no current data"})
            al = self._probe_alarm(p, v, wc_active)
            alarms_by_probe[p["id"]] = al
            if al:
                alarms.append({"key": f"probe_{p['id']}", "text": f"{p.get('name') or p['id']} {v} outside "
                               f"{p.get('nominal')} ± {(p.get('alarm') or {}).get('deviation')}"})

        # Temperature-dependent light reduction (latched for the rest of the day)
        lr = cfg.get("light_reduction") or {}
        lp = self._probe(lr.get("probe") or "")
        if lp is not None and values.get(lp["id"]) is not None:
            try:
                if values[lp["id"]] >= float(lp.get("nominal", 0)) + float(lr.get("limit") or 0):
                    self.rt["lightred"] = now.date().isoformat()
            except (TypeError, ValueError):
                pass

        # Function evaluation (memoised per tick; logic gates may reference each other)
        memo: dict[tuple, bool | None] = {}
        visiting: set[int] = set()
        prev_gates = self.rt["gate"]

        def ev(ref: dict) -> bool | None:
            t = ref.get("type", "always_off")
            param = ref.get("param") or 0
            mode = ref.get("mode") or ""
            key = (t, str(param), mode)
            if key in memo:
                return memo[key]
            if t == "always_off":
                r = False
            elif t == "always_on":
                r = True
            elif t == "temperature":
                r = self._control(str(param), "cooler" if mode == "cooler" else "heater", values, alarms_by_probe)
            elif t == "ph":
                r = self._control(str(param), "down" if mode == "down" else "up", values, alarms_by_probe)
            elif t == "timer":
                r = timer_on(int(param))
            elif t == "illumination":
                r = self.illum_value(int(param), now)
            elif t == "filter":
                fp = self._item("feed_pauses", int(param))
                r = not (fp is not None and fp.get("filter_off", True) and self.fp_active(int(param), now))
            elif t == "maintenance":
                r = self.maint_active(int(param), now)
            elif t in ("fill_water", "fill_ato", "fill_awc", "drain_water"):
                lv = level.get(int(param))
                r = None if lv is None else lv[t]
            elif t == "logic":
                r = gate(int(param))
            else:
                r = None
            memo[key] = r
            return r

        def gate(n: int) -> bool | None:
            g = self._item("logic", n)
            if not g:
                return None
            if n in visiting:  # loop between gates: use last tick's output
                return (prev_gates.get(str(n)) or {}).get("out")
            visiting.add(n)
            try:
                i1 = _inv(ev(g.get("in1") or {}), (g.get("in1") or {}).get("invert"))
                op = g.get("op", "and")
                if op in ("and", "or"):
                    i2 = _inv(ev(g.get("in2") or {}), (g.get("in2") or {}).get("invert"))
                    out = _b_and(i1, i2) if op == "and" else _b_or(i1, i2)
                    prev_gates[str(n)] = {"out": out}
                    return out
                # Delayed ON / Delayed OFF act on input 1
                rec = prev_gates.setdefault(str(n), {"in": i1, "since": now.isoformat(), "out": i1})
                if rec.get("in") != i1 or "since" not in rec:
                    rec["in"] = i1
                    rec["since"] = now.isoformat()
                held = (now - (self._dt(rec.get("since")) or now)).total_seconds()
                secs = float(g.get("seconds") or 0)
                if i1 is None:
                    out = None
                elif op == "delayed_on":
                    out = bool(i1 and held >= secs)
                else:  # delayed_off: follows ON at once, stays ON for `seconds` after input goes OFF
                    out = True if i1 else (rec.get("out") is True and held < secs)
                rec["out"] = out
                return out
            finally:
                visiting.discard(n)

        # Evaluate every configured gate each tick so delays keep time even if no channel uses them yet
        for g in cfg["logic"]:
            if g.get("name") or (g.get("in1") or {}).get("type") != "always_off":
                ev({"type": "logic", "param": g["n"]})

        # Channels
        blackout_from = self._dt(self.rt.get("blackout_from"))
        maint_force: dict[int, bool] = {}
        for mt in sorted(cfg["maintenance"], key=lambda x: -x["n"]):  # lower number wins
            if self.maint_active(mt["n"], now):
                for s in mt.get("sockets") or []:
                    try:
                        maint_force[int(s.get("ch"))] = str(s.get("state", "off")).lower() == "on"
                    except (TypeError, ValueError):
                        continue
        channels: dict[int, dict] = {}
        for ch in cfg["channels"]:
            n = ch["n"]
            fn = ch.get("fn") or {}
            base = ev(fn)
            reason = fn.get("type", "always_off")
            if base is None:
                base = str(ch.get("fallback", "off")).lower() == "on"
                reason = "fallback (no data)"
            out = _inv(base, ch.get("invert"))
            if n in maint_force:
                out = maint_force[n]
                reason = "maintenance"
            bo = float(ch.get("blackout_min") or 0)
            if bo > 0 and blackout_from is not None and (now - blackout_from) < timedelta(minutes=bo):
                out = False
                reason = "blackout delay"
            if cfg.get("manual_override"):
                out = str(ch.get("manual", "off")).lower() == "on"
                reason = "manual override"
            channels[n] = {"out": bool(out), "reason": reason}

        # Reminders
        for r in self.reminders_due(now.date()):
            alarms.append({"key": f"reminder_{r['n']}", "text": f"Reminder: {r['text']}", "reminder": r["n"]})

        status = {
            "now": now.isoformat(),
            "channels": channels,
            "probes": {pid: {"value": v, "alarm": alarms_by_probe.get(pid, False)} for pid, v in values.items()},
            "timers": {t["n"]: timer_on(t["n"]) for t in cfg["timers"] if t.get("mode") == "normal" and t.get("entries")},
            "illumination": {c["n"]: self.illum_value(c["n"], now) for c in cfg["illumination"] if c.get("entries")},
            "feed_pauses": {fp["n"]: self.rt["fp"].get(str(fp["n"])) for fp in cfg["feed_pauses"]},
            "maintenance": {mt["n"]: self.rt["maint"].get(str(mt["n"])) for mt in cfg["maintenance"]},
            "level": {n: {**v, "error": self.rt["lvl"].get(str(n), {}).get("error"),
                          "phase": self.rt["lvl"].get(str(n), {}).get("wc")} for n, v in level.items()},
            "level_sensors": sens,
            "logic": {g["n"]: (prev_gates.get(str(g["n"])) or {}).get("out") for g in cfg["logic"]
                      if g.get("name") or (g.get("in1") or {}).get("type") != "always_off"},
            "light_reduction_today": self.rt.get("lightred") == now.date().isoformat(),
            "power_cut": bool(self.rt["power"].get("cut")),
            "water_change_active": wc_active,
            "alarms": alarms,
        }
        self.last = status
        return status
