"""WebSocket API used by the Sentinel Controller card."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import CARD_VERSION, DOMAIN, SIGNAL_UPDATE
from . import logic


def _rt(hass: HomeAssistant):
    return hass.data.get(DOMAIN, {}).get("runtime")


def _limits() -> dict[str, Any]:
    return {
        "channels": logic.N_CHANNELS, "timers": logic.N_TIMERS, "illumination": logic.N_ILLUMINATION,
        "feed_pauses": logic.N_FEED_PAUSES, "maintenance": logic.N_MAINTENANCE,
        "level_circuits": logic.N_LEVEL_CIRCUITS, "level_sensors": logic.N_LEVEL_SENSORS,
        "logic": logic.N_LOGIC, "reminders": logic.N_REMINDERS, "probes": logic.N_PROBES,
        "feed_pause_max_min": logic.FEED_PAUSE_MAX_MIN, "maintenance_max_min": logic.MAINTENANCE_MAX_MIN,
        "fn_types": logic.FN_TYPES, "level_modes": logic.LEVEL_MODES, "logic_ops": logic.LOGIC_OPS,
    }


def _status_json(st: dict) -> dict:
    """JSON keys must be strings."""
    def fix(v):
        if isinstance(v, dict):
            return {str(k): fix(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fix(x) for x in v]
        return v
    return fix(st)


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_action)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_preview)


@websocket_api.websocket_command({vol.Required("type"): "sentinel_controller/get"})
@callback
def ws_get(hass, connection, msg):
    rt = _rt(hass)
    if not rt or not rt.ctl:
        connection.send_error(msg["id"], "not_loaded", "Sentinel Controller is not set up. Add it under Settings > Devices & services.")
        return
    connection.send_result(msg["id"], {"config": rt.ctl.config, "status": _status_json(rt.status), "limits": _limits(),
                                       "version": CARD_VERSION})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "sentinel_controller/save",
                                  vol.Required("section"): str, vol.Required("value"): vol.Any(list, dict, int, float, bool)})
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    rt = _rt(hass)
    if not rt or not rt.ctl:
        connection.send_error(msg["id"], "not_loaded", "Sentinel Controller is not set up.")
        return
    try:
        await rt.async_update_section(msg["section"], msg["value"])
    except (ValueError, TypeError) as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"config": rt.ctl.config, "status": _status_json(rt.status)})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "sentinel_controller/action", vol.Required("action"): str,
                                  vol.Optional("n"): int, vol.Optional("value"): vol.Any(bool, int, str)})
@websocket_api.async_response
async def ws_action(hass, connection, msg):
    rt = _rt(hass)
    if not rt or not rt.ctl:
        connection.send_error(msg["id"], "not_loaded", "Sentinel Controller is not set up.")
        return
    try:
        await rt.async_action(msg["action"], msg.get("n"), msg.get("value"))
    except (ValueError, TypeError) as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"config": rt.ctl.config, "status": _status_json(rt.status)})


@websocket_api.websocket_command({vol.Required("type"): "sentinel_controller/subscribe"})
@callback
def ws_subscribe(hass, connection, msg):
    @callback
    def forward():
        rt = _rt(hass)
        if rt:
            connection.send_message(websocket_api.event_message(msg["id"], {"status": _status_json(rt.status)}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATE, forward)
    connection.send_result(msg["id"])
    forward()


@websocket_api.websocket_command({vol.Required("type"): "sentinel_controller/preview",
                                  vol.Required("kind"): vol.In(["channel", "logic"]), vol.Required("item"): dict})
@callback
def ws_preview(hass, connection, msg):
    rt = _rt(hass)
    if not rt or not rt.ctl:
        connection.send_error(msg["id"], "not_loaded", "Sentinel Controller is not set up.")
        return
    try:
        connection.send_result(msg["id"], _status_json(rt.preview(msg["kind"], msg["item"])))
    except (ValueError, TypeError, KeyError) as err:
        connection.send_error(msg["id"], "invalid", str(err))
