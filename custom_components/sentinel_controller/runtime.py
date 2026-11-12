"""Runs the Sentinel Controller logic inside Home Assistant."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import RESEND_SECONDS, SIGNAL_UPDATE, STORE_CONFIG, STORE_RUNTIME, TICK_SECONDS
from . import logic
from .logic import Controller, Input, merge_config

_LOGGER = logging.getLogger(__name__)

SWITCHABLE = {"switch", "light", "fan", "input_boolean", "siren", "humidifier", "select"}
CONFIG_SECTIONS = {
    "probes", "level_sensors", "timers", "illumination", "light_reduction", "feed_pauses", "maintenance",
    "level_circuits", "logic", "channels", "reminders", "power_cut", "notify", "data_timeout_min", "data_source", "controllers", "source_kinds", "doser_sections", "doser_names", "outlet_names",
}


class Runtime:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.cfg_store: Store = Store(hass, 1, STORE_CONFIG)
        self.rt_store: Store = Store(hass, 1, STORE_RUNTIME)
        self.ctl: Controller | None = None
        self.status: dict[str, Any] = {}
        self._unsub: CALLBACK_TYPE | None = None
        self._last_cmd: dict[str, datetime] = {}
        self._hours: dict[str, float] = {}
        self._prev_alarm_keys: set[str] = set()
        self._last_repeat: datetime | None = None
        self._last_daily: str = ""
        self._last_tick: datetime | None = None

    async def async_start(self) -> None:
        cfg = await self.cfg_store.async_load()
        rt = await self.rt_store.async_load() or {}
        self._hours = rt.pop("_hours", {}) if isinstance(rt, dict) else {}
        self._last_daily = rt.pop("_last_daily", "") if isinstance(rt, dict) else ""
        self.ctl = Controller(cfg, rt, started=dt_util.now())
        self._tick()
        self._unsub = async_track_time_interval(self.hass, self._interval, timedelta(seconds=TICK_SECONDS))

    async def async_stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        await self.rt_store.async_save(self._rt_data())

    def _rt_data(self) -> dict:
        data = dict(self.ctl.rt) if self.ctl else {}
        data["_hours"] = self._hours
        data["_last_daily"] = self._last_daily
        return data

    def _save_rt(self) -> None:
        self.rt_store.async_delay_save(self._rt_data, 30)

    async def async_save_config(self) -> None:
        await self.cfg_store.async_save(self.ctl.config)
        self._save_rt()

    # ------------------------------------------------------------------ config
    async def async_update_section(self, section: str, value: Any) -> None:
        if section not in CONFIG_SECTIONS:
            raise ValueError(f"Unknown section {section}")
        cur = self.ctl.config.get(section)
        if isinstance(cur, list) and not isinstance(value, list):
            raise ValueError(f"{section} must be a list")
        if isinstance(cur, dict) and not isinstance(value, dict):
            raise ValueError(f"{section} must be an object")
        new = dict(self.ctl.config)
        new[section] = value
        merged = merge_config(new)
        if section == "probes":
            ids = [p.get("id") for p in merged["probes"]]
            if len(ids) != len(set(ids)) or any(not i for i in ids):
                raise ValueError("Every probe needs a unique id")
            merged["probes"] = value
        self.ctl.config = merged
        await self.async_save_config()
        self._tick()

    # ------------------------------------------------------------------ inputs
    def _entities_needed(self) -> set[str]:
        cfg = self.ctl.config
        ents = {p.get("entity") for p in cfg["probes"]} | {p.get("status_entity") for p in cfg["probes"]}
        ents |= {s.get("entity") for s in cfg["level_sensors"]}
        ents.add((cfg.get("power_cut") or {}).get("entity"))
        ents.add((cfg.get("data_source") or {}).get("entity"))
        return {e for e in ents if e}

    def _inputs(self) -> dict[str, Input]:
        out = {}
        for ent in self._entities_needed():
            st = self.hass.states.get(ent)
            if st is None:
                out[ent] = Input(None, None)
            else:
                upd = getattr(st, "last_reported", None) or st.last_updated
                out[ent] = Input(st.state, upd)
        return out

    # ------------------------------------------------------------------ loop
    @callback
    def _interval(self, _now) -> None:
        self._tick()

    @callback
    def _tick(self) -> None:
        if not self.ctl:
            return
        now = dt_util.now()
        try:
            status = self.ctl.tick(now, self._inputs())
        except Exception:  # noqa: BLE001 - never let one bad config stop the loop
            _LOGGER.exception("Sentinel Controller tick failed")
            return
        dt = (now - self._last_tick).total_seconds() if self._last_tick else 0
        self._last_tick = now
        self._apply(status, now, dt)
        self._notify(status, now)
        self.status = status
        self._save_rt()
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)

    def _outlets_tab_targets(self) -> set[str]:
        """Entities driven by the Reef Ecosystem 'Outlets' tab engine (avoid two controllers on one plug)."""
        used = set()
        for i in range(1, 9):
            if self.hass.states.is_state(f"input_boolean.outlet_{i}_used", "on"):
                st = self.hass.states.get(f"input_select.outlet_{i}_outlet")
                if st and st.state not in ("none", "unknown", "unavailable"):
                    used.add(st.state)
        return used

    @callback
    def _apply(self, status: dict, now: datetime, dt: float) -> None:
        cfg = self.ctl.config
        alarms = status["alarms"]
        other = self._outlets_tab_targets()
        seen: dict[str, int] = {}
        for ch in cfg["channels"]:
            ent = ch.get("entity")
            n = ch["n"]
            res = status["channels"].get(n)
            if not ent or res is None:
                continue
            want = res["out"]
            if ent in seen:
                alarms.append({"key": f"channel_{n}_dup", "text": f"Switch channel {n} and {seen[ent]} both drive {ent}"})
                continue
            seen[ent] = n
            if ent in other:
                alarms.append({"key": f"channel_{n}_conflict",
                               "text": f"Switch channel {n}: {ent} is also controlled by the Reef Ecosystem Outlets tab"})
                res["conflict"] = True
                continue
            st = self.hass.states.get(ent)
            if st is None or st.state in ("unavailable", "unknown"):
                alarms.append({"key": f"channel_{n}_unavailable",
                               "text": f"Switch channel {n} ({ch.get('name') or ent}) is unavailable"})
                res["actual"] = None
                continue
            actual = str(st.state).strip().lower() == "on"  # a select reads "On" / "Auto" / "Off"
            res["actual"] = actual
            if actual and dt > 0:
                self._hours[str(n)] = self._hours.get(str(n), 0.0) + dt / 3600.0
            res["hours"] = round(self._hours.get(str(n), 0.0), 2)
            domain = ent.split(".")[0]
            if domain not in SWITCHABLE or actual == want:
                continue
            key = f"{ent}:{want}"  # only throttle repeats of the same command, never a reversal
            last = self._last_cmd.get(key)
            if last and (now - last).total_seconds() < RESEND_SECONDS:
                continue
            if domain == "select":
                option = logic.select_option(st.attributes.get("options"), want)
                if option is None:
                    alarms.append({"key": f"channel_{n}_select",
                                   "text": f"Switch channel {n}: {ent} has no On/Off option"})
                    continue
                self._last_cmd[key] = now
                self.hass.async_create_task(self.hass.services.async_call(
                    "select", "select_option", {"entity_id": ent, "option": option}, blocking=False))
                continue
            self._last_cmd[key] = now
            self.hass.async_create_task(
                self.hass.services.async_call(domain, "turn_on" if want else "turn_off", {"entity_id": ent},
                                              blocking=False))

    # ------------------------------------------------------------------ notifications
    @callback
    def _notify(self, status: dict, now: datetime) -> None:
        n = self.ctl.config.get("notify") or {}
        targets = [t for t in (n.get("targets") or []) if t]
        keys = {a["key"] for a in status["alarms"]}
        new = [a for a in status["alarms"] if a["key"] not in self._prev_alarm_keys]
        cleared = self._prev_alarm_keys - keys
        self._prev_alarm_keys = keys
        if not targets:
            return
        msgs: list[tuple[str, str]] = []
        if n.get("on_new_alarm", True) and new:
            msgs.append(("Sentinel Controller alarm", "\n".join(a["text"] for a in new)))
        if n.get("on_clear") and cleared:
            msgs.append(("Sentinel Controller", f"{len(cleared)} alarm(s) cleared"))
        rep = float(n.get("repeat_min") or 0)
        if rep > 0 and keys:
            if self._last_repeat is None or (now - self._last_repeat) >= timedelta(minutes=rep):
                if not new:
                    msgs.append(("Sentinel Controller alarm still active",
                                 "\n".join(a["text"] for a in status["alarms"])))
                self._last_repeat = now
        elif not keys:
            self._last_repeat = None
        daily = n.get("daily_at") or ""
        if daily and now.strftime("%H:%M") == daily[:5] and self._last_daily != now.date().isoformat():
            self._last_daily = now.date().isoformat()
            lines = [f"{p}: {v['value']}" for p, v in status["probes"].items()]
            on = [str(k) for k, v in status["channels"].items() if v["out"] and self.ctl.config["channels"][k - 1].get("entity")]
            lines.append("Channels ON: " + (", ".join(on) or "none"))
            lines.append(f"Alarms: {len(keys)}")
            msgs.append(("Sentinel Controller daily status", "\n".join(lines)))
        for title, message in msgs:
            for t in targets:
                svc = t.split(".", 1)[1] if t.startswith("notify.") else t
                self.hass.async_create_task(self.hass.services.async_call(
                    "notify", svc, {"title": title, "message": message}, blocking=False))

    # ------------------------------------------------------------------ preview
    def preview(self, kind: str, item: dict) -> dict:
        """Evaluate a draft channel or logic gate against current data without changing anything."""
        import copy
        from .logic import Controller
        sim = Controller(copy.deepcopy(self.ctl.config), copy.deepcopy(self.ctl.rt))
        key = "channels" if kind == "channel" else "logic"
        n = int(item.get("n", 0))
        for i, it in enumerate(sim.config[key]):
            if it.get("n") == n:
                merged = copy.deepcopy(it)
                merged.update(item)
                if kind == "channel":
                    merged["entity"] = merged.get("entity") or "preview"
                sim.config[key][i] = merged
                break
        else:
            raise ValueError(f"No {key[:-1]} {n}")
        st = sim.tick(dt_util.now(), self._inputs())
        if kind == "channel":
            return st["channels"].get(n) or {}
        return {"out": st["logic"].get(n), "reason": ""}

    # ------------------------------------------------------------------ actions
    async def async_action(self, action: str, n: int | None = None, value: Any = None) -> None:
        now = dt_util.now()
        c = self.ctl
        if action == "start_feed_pause":
            c.start_feed_pause(int(n), now)
        elif action == "stop_feed_pause":
            c.stop_feed_pause(int(n))
        elif action == "start_maintenance":
            c.start_maintenance(int(n), now)
        elif action == "stop_maintenance":
            c.stop_maintenance(int(n))
        elif action == "start_water_change":
            c.start_water_change(int(n), now)
        elif action == "stop_water_change":
            c.stop_water_change(int(n))
        elif action == "reset_level_error":
            c.reset_level_error(int(n))
        elif action == "acknowledge_reminder":
            c.ack_reminder(int(n), now.date())
            await self.async_save_config()
        elif action == "manual_override":
            current = {k: v["out"] for k, v in (self.status.get("channels") or {}).items()}
            c.set_manual_override(bool(value), current)
            await self.async_save_config()
        elif action == "channel_manual":
            ch = c._item("channels", int(n))
            if not ch:
                raise ValueError(f"No switch channel {n}")
            ch["manual"] = "on" if value in (True, "on", 1, "1") else "off"
            await self.async_save_config()
        elif action == "reset_hours":
            self._hours.pop(str(int(n)), None)
        else:
            raise ValueError(f"Unknown action {action}")
        self._tick()
