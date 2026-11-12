"""Binary sensors: alarm, feed pauses, maintenance modes, water change, power cut."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity

from .entity import SentinelEntity
from .logic import N_FEED_PAUSES, N_MAINTENANCE


async def async_setup_entry(hass, entry, async_add_entities):
    ents = [AlarmSensor(entry.entry_id), FlagSensor(entry.entry_id, "water_change", "Water change",
                                                    lambda s: s.get("water_change_active")),
            FlagSensor(entry.entry_id, "power_cut", "Power cut", lambda s: s.get("power_cut"),
                       BinarySensorDeviceClass.PROBLEM)]
    for i in range(1, N_FEED_PAUSES + 1):
        ents.append(FlagSensor(entry.entry_id, f"feed_pause_{i}", f"Feed pause {i}",
                               lambda s, i=i: bool((s.get("feed_pauses") or {}).get(i))))
    for i in range(1, N_MAINTENANCE + 1):
        ents.append(FlagSensor(entry.entry_id, f"maintenance_{i}", f"Maintenance {i}",
                               lambda s, i=i: bool((s.get("maintenance") or {}).get(i))))
    async_add_entities(ents)


class AlarmSensor(SentinelEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, entry_id):
        super().__init__(entry_id, "alarm", "Alarm")

    @property
    def is_on(self):
        return bool(self.status.get("alarms"))

    @property
    def extra_state_attributes(self):
        al = self.status.get("alarms") or []
        return {"count": len(al), "alarms": [a["text"] for a in al]}


class FlagSensor(SentinelEntity, BinarySensorEntity):
    def __init__(self, entry_id, key, name, fn, device_class=None):
        super().__init__(entry_id, key, name)
        self._fn = fn
        self._attr_device_class = device_class

    @property
    def is_on(self):
        return bool(self._fn(self.status))
