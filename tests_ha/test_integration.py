from datetime import timedelta
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

DOMAIN = "sentinel_controller"


async def test_full_flow(hass, hass_ws_client):
    assert await async_setup_component(hass, "input_boolean", {"input_boolean": {"heater": {"name": "Heater"}}})
    hass.states.async_set("sensor.tank_temp", "76.5")
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="Sentinel Controller")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "sentinel_controller/get"})
    r = await ws.receive_json()
    assert r["success"], r
    cfg = r["result"]["config"]
    assert len(cfg["channels"]) == 48 and len(cfg["timers"]) == 32

    probes = [{"id": "p1", "name": "Tank", "kind": "temperature", "entity": "sensor.tank_temp", "unit": "°F",
               "nominal": 77, "hysteresis": 0.36, "alarm": {"active": True, "deviation": 2}}]
    await ws.send_json({"id": 2, "type": "sentinel_controller/save", "section": "probes", "value": probes})
    r = await ws.receive_json(); assert r["success"], r
    chans = r["result"]["config"]["channels"]
    chans[0].update({"name": "Heater", "entity": "input_boolean.heater",
                     "fn": {"type": "temperature", "param": "p1", "mode": "heater"}})
    await ws.send_json({"id": 3, "type": "sentinel_controller/save", "section": "channels", "value": chans})
    r = await ws.receive_json(); assert r["success"], r
    await hass.async_block_till_done()
    assert hass.states.get("input_boolean.heater").state == "on"

    hass.states.async_set("sensor.tank_temp", "77.3")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=20))
    await hass.async_block_till_done()
    assert hass.states.get("input_boolean.heater").state == "off"

    # feed pause via service, binary sensor reflects it
    await hass.services.async_call(DOMAIN, "start_feed_pause", {"n": 1}, blocking=True)
    await hass.async_block_till_done()
    fp = [s for s in hass.states.async_all("binary_sensor") if s.entity_id.endswith("feed_pause_1")]
    assert fp and fp[0].state == "on"

    # alarm entity: temp way off
    hass.states.async_set("sensor.tank_temp", "73.0")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=40))
    await hass.async_block_till_done()
    al = [s for s in hass.states.async_all("binary_sensor") if s.entity_id.endswith("_alarm")]
    assert al and al[0].state == "on", al
    assert "Tank" in " ".join(al[0].attributes["alarms"])

    # subscribe gets pushes
    await ws.send_json({"id": 4, "type": "sentinel_controller/subscribe"})
    r = await ws.receive_json(); assert r["success"]
    r = await ws.receive_json(); assert "status" in r["event"]

    # bad action rejected cleanly
    await ws.send_json({"id": 5, "type": "sentinel_controller/action", "action": "start_water_change", "n": 1})
    r = await ws.receive_json()
    while r.get("type") == "event":
        r = await ws.receive_json()
    assert not r["success"]

    # reload keeps config
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    rt = hass.data[DOMAIN]["runtime"]
    assert rt.ctl.config["channels"][0]["entity"] == "input_boolean.heater"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_preview(hass, hass_ws_client):
    assert await async_setup_component(hass, "input_boolean", {"input_boolean": {"heater": {"name": "Heater"}}})
    hass.states.async_set("sensor.tank_temp", "76.5")
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="Sentinel Controller")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)
    probes = [{"id": "p1", "name": "Tank", "kind": "temperature", "entity": "sensor.tank_temp",
               "nominal": 77, "hysteresis": 0.36, "alarm": {"active": False}}]
    await ws.send_json({"id": 1, "type": "sentinel_controller/save", "section": "probes", "value": probes})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 2, "type": "sentinel_controller/preview", "kind": "channel",
                        "item": {"n": 5, "fn": {"type": "temperature", "param": "p1", "mode": "heater"}}})
    r = await ws.receive_json()
    assert r["success"] and r["result"]["out"] is True, r
    assert hass.states.get("input_boolean.heater").state == "off"  # preview never switches anything
    assert hass.data[DOMAIN]["runtime"].ctl.config["channels"][4]["fn"]["type"] == "always_off"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_card_version_endpoint(hass, hass_client):
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="Sentinel Controller")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_client()
    r = await client.get("/api/sentinel_controller/card_version")
    assert r.status == 200 and r.headers.get("Cache-Control") == "no-store"
    v = (await r.json())["version"]
    assert "-" in v and len(v.split("-")[1]) == 10
    r = await client.get("/sentinel_controller_static/sentinel-controller-loader.js")
    assert r.status == 200 and "card_version" in await r.text()
    assert await hass.config_entries.async_unload(entry.entry_id)
