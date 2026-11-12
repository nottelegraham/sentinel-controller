"""Register the card loader as a dashboard (Lovelace) resource.

Extra JS URLs are baked into Home Assistant's start page, which the iOS/Android
companion apps keep cached; dashboard resources are fetched fresh on every
dashboard load, so they reach the phone apps too.
"""
from __future__ import annotations

import logging

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, HomeAssistant

_LOGGER = logging.getLogger(__name__)


def _collection(hass: HomeAssistant):
    try:
        from homeassistant.components.lovelace.const import LOVELACE_DATA
        data = hass.data.get(LOVELACE_DATA)
        res = getattr(data, "resources", None)
    except ImportError:  # older HA
        res = (hass.data.get("lovelace") or {}).get("resources")
    return res if res is not None and hasattr(res, "async_create_item") else None


async def _ensure(hass: HomeAssistant, base: str, url: str, also: tuple[str, ...]) -> None:
    res = _collection(hass)
    if res is None:  # YAML resource mode or lovelace not loaded: extra JS URL still covers browsers
        _LOGGER.debug("Lovelace storage resources unavailable; not registering %s", base)
        return
    if not res.loaded:
        await res.async_load()
        res.loaded = True
    # Match any resource that loads a copy of this file (hand-added, /local/ copies, old
    # versions): point the first at the served card, delete the rest, so no stale copy
    # can register the element before the current one.
    names = {base.rsplit("/", 1)[-1], *also}
    matches = [i for i in res.async_items()
               if i.get("url", "").split("?")[0].rsplit("/", 1)[-1] in names]
    if matches:
        keep, *extra = matches
        if keep.get("url") != url or keep.get("type") != "module":
            await res.async_update_item(keep["id"], {"res_type": "module", "url": url})
        for item in extra:
            await res.async_delete_item(item["id"])
        return
    await res.async_create_item({"res_type": "module", "url": url})


def async_register_resource(hass: HomeAssistant, base: str, url: str, also: tuple[str, ...] = ()) -> None:
    async def run(_=None) -> None:
        try:
            await _ensure(hass, base, url, also)
        except Exception:  # never block setup over this
            _LOGGER.exception("Could not register dashboard resource %s", base)

    if hass.state is CoreState.running:
        hass.async_create_task(run())
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, run)
