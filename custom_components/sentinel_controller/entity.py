"""Shared entity base."""
from __future__ import annotations

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, NAME, SIGNAL_UPDATE


class SentinelEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, entry_id: str, key: str, name: str) -> None:
        self._attr_unique_id = f"{entry_id}_{key}"
        self._attr_name = name
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, entry_id)}, name=NAME,
                                            manufacturer="TelegrahamTested", model="P4-style controller")

    @property
    def rt(self):
        return self.hass.data[DOMAIN]["runtime"]

    @property
    def status(self) -> dict:
        return self.rt.status or {}

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()
