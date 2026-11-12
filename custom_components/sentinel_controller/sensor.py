"""Sensor: number of switch channels currently ON (attributes list every assigned channel)."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity

from .entity import SentinelEntity


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([ChannelsSensor(entry.entry_id)])


class ChannelsSensor(SentinelEntity, SensorEntity):
    _attr_icon = "mdi:power-socket-us"
    _attr_native_unit_of_measurement = "on"

    def __init__(self, entry_id):
        super().__init__(entry_id, "channels_on", "Channels on")

    def _assigned(self):
        chans = self.status.get("channels") or {}
        cfg = self.rt.ctl.config["channels"] if self.rt.ctl else []
        return {c["n"]: (c, chans.get(c["n"])) for c in cfg if c.get("entity") and chans.get(c["n"])}

    @property
    def native_value(self):
        return sum(1 for c, s in self._assigned().values() if s["out"])

    @property
    def extra_state_attributes(self):
        return {f"channel_{n}": {"name": c.get("name"), "entity": c.get("entity"), "out": s["out"],
                                 "actual": s.get("actual"), "reason": s["reason"], "hours": s.get("hours")}
                for n, (c, s) in self._assigned().items()}
