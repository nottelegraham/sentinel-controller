"""Sentinel Controller: a ProfiLux-4-style control scheme run by Home Assistant."""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

import hashlib

from aiohttp import web

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv

from . import websocket as sc_ws
from .const import CARD_VERSION, DOMAIN, STATIC_URL
from .lovelace_resource import async_register_resource
from .runtime import Runtime

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

N = vol.All(vol.Coerce(int), vol.Range(1, 48))
SERVICES = {
    "start_feed_pause": vol.Schema({vol.Required("n"): N}),
    "stop_feed_pause": vol.Schema({vol.Required("n"): N}),
    "start_maintenance": vol.Schema({vol.Required("n"): N}),
    "stop_maintenance": vol.Schema({vol.Required("n"): N}),
    "start_water_change": vol.Schema({vol.Required("n"): N}),
    "stop_water_change": vol.Schema({vol.Required("n"): N}),
    "reset_level_error": vol.Schema({vol.Required("n"): N}),
    "acknowledge_reminder": vol.Schema({vol.Required("n"): N}),
    "manual_override": vol.Schema({vol.Required("value"): cv.boolean}),
    "channel_manual": vol.Schema({vol.Required("n"): N, vol.Required("value"): cv.boolean}),
}


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "www"), False)])
    card = Path(__file__).parent / "www" / "sentinel-controller-card.js"
    digest = await hass.async_add_executor_job(lambda: hashlib.sha1(card.read_bytes()).hexdigest()[:10])
    hass.http.register_view(CardVersionView(f"{CARD_VERSION}-{digest}"))
    # Versioned loader URL: every install/restart gets a fresh loader; the loader itself also asks
    # for the current build, so even a stale cached page reaches the installed card.
    loader = f"{STATIC_URL}/sentinel-controller-loader.js?v={CARD_VERSION}-{digest}"
    # Modern frontend (iOS 18.4+, current desktop browsers) loads extra modules;
    # older iPhones/iPads get the legacy frontend, which only loads es5 scripts.
    add_extra_js_url(hass, loader)
    add_extra_js_url(hass, loader, es5=True)
    # Phone apps cache the start page; dashboard resources are always fetched fresh.
    async_register_resource(hass, f"{STATIC_URL}/sentinel-controller-loader.js", loader)
    sc_ws.async_register(hass)

    async def handle(call: ServiceCall) -> None:
        rt: Runtime | None = hass.data[DOMAIN].get("runtime")
        if not rt or not rt.ctl:
            raise ServiceValidationError("Sentinel Controller is not set up")
        try:
            await rt.async_action(call.service, call.data.get("n"), call.data.get("value"))
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err

    for name, schema in SERVICES.items():
        hass.services.async_register(DOMAIN, name, handle, schema=schema)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    rt = Runtime(hass)
    await rt.async_start()
    hass.data[DOMAIN]["runtime"] = rt
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        rt: Runtime = hass.data[DOMAIN].pop("runtime")
        await rt.async_stop()
    return ok


class CardVersionView(HomeAssistantView):
    """Tells the loader which card build is installed (no caching)."""

    url = "/api/sentinel_controller/card_version"
    name = "api:sentinel_controller:card_version"
    requires_auth = False

    def __init__(self, version: str) -> None:
        self._version = version

    async def get(self, request):
        return web.json_response({"version": self._version}, headers={"Cache-Control": "no-store"})
