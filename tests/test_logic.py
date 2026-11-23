"""Scenario tests taken from the ProfiLux 4 / 4e Resource Guide examples."""
import importlib.util
import pathlib
from datetime import datetime, timedelta

_p = pathlib.Path(__file__).parents[1] / "custom_components" / "sentinel_controller" / "logic.py"
_spec = importlib.util.spec_from_file_location("logic", _p)
logic = importlib.util.module_from_spec(_spec)
import sys; sys.modules["logic"] = logic
_spec.loader.exec_module(logic)
Controller, Input = logic.Controller, logic.Input

T0 = datetime(2026, 11, 11, 10, 0, 0)  # Wednesday


def ctl(**over):
    c = Controller(started=T0 - timedelta(hours=1))
    for k, v in over.items():
        c.config[k] = v
    return c


def inp(**states):
    return {k: Input(str(v), T0) for k, v in states.items()}


def ch(c, n, **kw):
    c.config["channels"][n - 1].update(kw)


def run(c, now, inputs):
    for k in inputs.values():
        k.updated = now
    return c.tick(now, inputs)


TEMP = {"id": "t1", "name": "Tank temperature", "kind": "temperature", "entity": "sensor.temp",
        "nominal": 77.0, "hysteresis": 0.36, "alarm": {"active": True, "deviation": 2.0,
                                                         "no_alarm_on_wc": False, "deactivate_control": True}}


def test_heater_with_hysteresis():
    c = ctl(probes=[dict(TEMP)])
    ch(c, 1, entity="switch.heater", fn={"type": "temperature", "param": "t1", "mode": "heater"})
    assert run(c, T0, inp(**{"sensor.temp": 76.7}))["channels"][1]["out"] is True   # <= 76.82
    assert run(c, T0, inp(**{"sensor.temp": 77.0}))["channels"][1]["out"] is True   # inside band: holds
    assert run(c, T0, inp(**{"sensor.temp": 77.2}))["channels"][1]["out"] is False  # >= 77.18
    assert run(c, T0, inp(**{"sensor.temp": 77.0}))["channels"][1]["out"] is False  # holds off


def test_two_heaters_same_function_and_cooler():
    c = ctl(probes=[dict(TEMP)])
    ch(c, 1, fn={"type": "temperature", "param": "t1", "mode": "heater"})
    ch(c, 2, fn={"type": "temperature", "param": "t1", "mode": "heater"})
    ch(c, 3, fn={"type": "temperature", "param": "t1", "mode": "cooler"})
    s = run(c, T0, inp(**{"sensor.temp": 76.5}))
    assert s["channels"][1]["out"] and s["channels"][2]["out"] and not s["channels"][3]["out"]


def test_alarm_deviation_and_deactivate_control():
    c = ctl(probes=[dict(TEMP)])
    ch(c, 1, fn={"type": "temperature", "param": "t1", "mode": "heater"})
    s = run(c, T0, inp(**{"sensor.temp": 74.5}))  # 2.5 below nominal > 2.0 deviation
    assert any(a["key"] == "probe_t1" for a in s["alarms"])
    assert s["channels"][1]["out"] is False  # deactivate control


def test_stale_or_missing_probe_uses_fallback():
    c = ctl(probes=[dict(TEMP)])
    ch(c, 1, fn={"type": "temperature", "param": "t1", "mode": "heater"}, fallback="off")
    c.config["data_timeout_min"] = 5
    s = c.tick(T0, {"sensor.temp": Input("76.0", T0 - timedelta(minutes=10))})
    assert s["channels"][1]["out"] is False and s["channels"][1]["reason"].startswith("fallback")
    assert any(a["key"] == "probe_t1_fault" for a in s["alarms"])


def test_calcium_reactor_ph_control_downwards():
    ph = {"id": "p2", "name": "CaRx pH", "entity": "sensor.carx", "nominal": 6.6, "hysteresis": 0.1,
          "alarm": {"active": False}}
    c = ctl(probes=[ph])
    ch(c, 1, fn={"type": "ph", "param": "p2", "mode": "down"})
    assert run(c, T0, inp(**{"sensor.carx": 6.8}))["channels"][1]["out"] is True   # too high -> CO2 on
    assert run(c, T0, inp(**{"sensor.carx": 6.5}))["channels"][1]["out"] is False  # reached -> off


def test_feed_pause_filter():
    c = ctl()
    ch(c, 1, fn={"type": "filter", "param": 1})
    assert run(c, T0, {})["channels"][1]["out"] is True
    c.start_feed_pause(1, T0)
    assert run(c, T0 + timedelta(minutes=2), {})["channels"][1]["out"] is False
    assert run(c, T0 + timedelta(minutes=6), {})["channels"][1]["out"] is True  # 5 min default


def test_feed_pause_started_by_event_timer():
    c = ctl()
    c.config["timers"][0].update({"mode": "event", "entries": [{"on": "10:00"}]})
    c.config["feed_pauses"][0]["timer"] = 1
    ch(c, 1, fn={"type": "filter", "param": 1})
    assert run(c, T0, {})["channels"][1]["out"] is False


def test_normal_timer_weekdays_and_interval():
    c = ctl()
    c.config["timers"][0].update({"mode": "normal", "entries": [{"on": "08:00", "off": "20:00"}],
                                  "weekdays": [2]})  # Wednesday
    c.config["timers"][1].update({"mode": "normal", "entries": [{"on": "22:00", "off": "02:00"}]})
    c.config["timers"][2].update({"mode": "normal", "entries": [{"on": "08:00", "off": "20:00"}],
                                  "day_mode": "interval", "every_days": 3, "start_date": "2026-11-09"})
    ch(c, 1, fn={"type": "timer", "param": 1})
    ch(c, 2, fn={"type": "timer", "param": 2})
    ch(c, 3, fn={"type": "timer", "param": 3})
    s = run(c, T0, {})
    assert s["channels"][1]["out"] and not s["channels"][2]["out"] and not s["channels"][3]["out"]
    s = run(c, T0.replace(hour=1), {})  # after midnight, previous day's on period
    assert s["channels"][2]["out"] is True
    s = run(c, T0 + timedelta(days=1), {})  # Thursday 12th = 3 days after 9th
    assert s["channels"][1]["out"] is False and s["channels"][3]["out"] is True


def test_maintenance_sockets_and_maintenance_delay_via_logic():
    c = ctl()
    # Skimmer on ch 2: AND( Always on , NOT PL1 ), PL1 = Delayed OFF(Maintenance 1, 600 s)
    c.config["maintenance"][0].update({"minutes": 30, "sockets": [{"ch": 1, "state": "off"}]})
    c.config["logic"][0].update({"op": "delayed_off", "in1": {"type": "maintenance", "param": 1}, "seconds": 600})
    c.config["logic"][1].update({"op": "and", "in1": {"type": "always_on"},
                                 "in2": {"type": "logic", "param": 1, "invert": True}})
    ch(c, 1, fn={"type": "always_on"})
    ch(c, 2, fn={"type": "logic", "param": 2})
    assert run(c, T0, {})["channels"][2]["out"] is True
    c.start_maintenance(1, T0)
    s = run(c, T0 + timedelta(seconds=10), {})
    assert s["channels"][1]["out"] is False and s["channels"][2]["out"] is False
    s = run(c, T0 + timedelta(minutes=31), {})  # maintenance over, delay running
    assert s["channels"][1]["out"] is True and s["channels"][2]["out"] is False
    s = run(c, T0 + timedelta(minutes=42), {})  # 11 min after end
    assert s["channels"][2]["out"] is True


def test_feed_pause_delay_via_logic():
    c = ctl()
    c.config["logic"][0].update({"op": "delayed_on", "in1": {"type": "filter", "param": 1}, "seconds": 300})
    c.config["logic"][1].update({"op": "and", "in1": {"type": "filter", "param": 1},
                                 "in2": {"type": "logic", "param": 1}})
    ch(c, 1, fn={"type": "logic", "param": 2})
    run(c, T0 - timedelta(minutes=10), {})
    assert run(c, T0, {})["channels"][1]["out"] is True
    c.start_feed_pause(1, T0)
    assert run(c, T0 + timedelta(minutes=1), {})["channels"][1]["out"] is False
    assert run(c, T0 + timedelta(minutes=5, seconds=2), {})["channels"][1]["out"] is False  # FP just ended
    assert run(c, T0 + timedelta(minutes=7), {})["channels"][1]["out"] is False   # 2 min after FP end
    assert run(c, T0 + timedelta(minutes=11), {})["channels"][1]["out"] is True   # 6 min after


def test_or_and_three_function_combo():
    c = ctl()
    c.config["timers"][0].update({"mode": "normal", "entries": [{"on": "08:00", "off": "20:00"}]})
    c.config["level_sensors"][0].update({"entity": "binary_sensor.high"})
    c.config["level_circuits"][0].update({"mode": "leak", "sensor1": 1})
    c.config["logic"][0].update({"op": "and", "in1": {"type": "timer", "param": 1}, "in2": {"type": "filter", "param": 1}})
    c.config["logic"][1].update({"op": "and", "in1": {"type": "fill_water", "param": 1}, "in2": {"type": "logic", "param": 1}})
    c.config["logic"][2].update({"op": "or", "in1": {"type": "filter", "param": 1}, "in2": {"type": "timer", "param": 1}})
    ch(c, 1, fn={"type": "logic", "param": 2})
    ch(c, 2, fn={"type": "logic", "param": 3})
    s = run(c, T0, inp(**{"binary_sensor.high": "off"}))
    assert s["channels"][1]["out"] is True and s["channels"][2]["out"] is True
    s = run(c, T0, inp(**{"binary_sensor.high": "on"}))  # sump too high
    assert s["channels"][1]["out"] is False
    assert any(a["key"] == "level_1" for a in s["alarms"])
    s = run(c, T0, inp(**{"binary_sensor.high": "off"}))  # auto reset
    assert s["channels"][1]["out"] is True


def test_leak_manual_reset_and_return_pump_inverted_sensor():
    c = ctl()
    c.config["level_sensors"][0].update({"entity": "sensor.leak", "dry_states": "Normal"})
    c.config["level_sensors"][1].update({"entity": "binary_sensor.sump_low", "invert": True})
    c.config["level_circuits"][0].update({"mode": "leak", "sensor1": 1, "auto_reset": False})
    c.config["level_circuits"][1].update({"mode": "leak", "sensor1": 2})
    ch(c, 1, fn={"type": "fill_water", "param": 1})
    ch(c, 2, fn={"type": "fill_water", "param": 2})
    s = run(c, T0, inp(**{"sensor.leak": "Leak", "binary_sensor.sump_low": "on"}))
    assert s["channels"][1]["out"] is False and s["channels"][2]["out"] is True
    s = run(c, T0, inp(**{"sensor.leak": "Normal", "binary_sensor.sump_low": "off"}))  # float out of water
    assert s["channels"][1]["out"] is False  # manual reset required
    assert s["channels"][2]["out"] is False
    c.reset_level_error(1)
    assert run(c, T0, inp(**{"sensor.leak": "Normal", "binary_sensor.sump_low": "on"}))["channels"][1]["out"] is True


def test_ato_single_sensor_max_on_time_and_reaction():
    c = ctl()
    c.config["level_sensors"][0].update({"entity": "binary_sensor.ato", "reaction_s": 5})
    c.config["level_circuits"][0].update({"mode": "ato", "sensor1": 1, "max_on_s": 120})
    ch(c, 1, fn={"type": "fill_ato", "param": 1})
    s = run(c, T0, inp(**{"binary_sensor.ato": "on"}))
    assert s["channels"][1]["out"] is False
    s = run(c, T0 + timedelta(seconds=2), inp(**{"binary_sensor.ato": "off"}))
    assert s["channels"][1]["out"] is False  # reaction time not yet elapsed
    s = run(c, T0 + timedelta(seconds=8), inp(**{"binary_sensor.ato": "off"}))
    assert s["channels"][1]["out"] is True
    s = run(c, T0 + timedelta(seconds=200), inp(**{"binary_sensor.ato": "off"}))
    assert s["channels"][1]["out"] is False and any(a["key"] == "level_1" for a in s["alarms"])
    s = run(c, T0 + timedelta(seconds=300), inp(**{"binary_sensor.ato": "on"}))
    s = run(c, T0 + timedelta(seconds=306), inp(**{"binary_sensor.ato": "on"}))
    assert not any(a["key"] == "level_1" for a in s["alarms"])  # auto reset


def test_minmax_and_two_sensor_ato():
    c = ctl()
    c.config["level_sensors"][0].update({"entity": "binary_sensor.low"})
    c.config["level_sensors"][1].update({"entity": "binary_sensor.high"})
    c.config["level_circuits"][0].update({"mode": "minmax", "sensor1": 1, "sensor2": 2, "max_on_s": 0})
    c.config["level_circuits"][1].update({"mode": "ato2", "sensor1": 1, "sensor2": 2, "max_on_s": 0})
    ch(c, 1, fn={"type": "fill_ato", "param": 1})
    ch(c, 2, fn={"type": "fill_ato", "param": 2})
    s = run(c, T0, inp(**{"binary_sensor.low": "off", "binary_sensor.high": "off"}))
    assert s["channels"][1]["out"] and s["channels"][2]["out"]
    s = run(c, T0, inp(**{"binary_sensor.low": "on", "binary_sensor.high": "off"}))
    assert s["channels"][1]["out"] is True and s["channels"][2]["out"] is False  # minmax keeps filling
    s = run(c, T0, inp(**{"binary_sensor.low": "on", "binary_sensor.high": "on"}))
    assert s["channels"][1]["out"] is False


def test_water_change_sequence_and_no_alarm_on_wc():
    t = dict(TEMP)
    t["alarm"] = {"active": True, "deviation": 1.0, "no_alarm_on_wc": True, "deactivate_control": False}
    c = ctl(probes=[t])
    c.config["level_sensors"][0].update({"entity": "binary_sensor.min"})
    c.config["level_sensors"][1].update({"entity": "binary_sensor.max"})
    c.config["timers"][4].update({"mode": "event", "entries": [{"on": "10:00"}]})
    c.config["level_circuits"][0].update({"mode": "wc", "sensor1": 1, "sensor2": 2, "max_on_s": 600, "wc_timer": 5})
    ch(c, 1, fn={"type": "drain_water", "param": 1})
    ch(c, 2, fn={"type": "fill_awc", "param": 1})
    s = run(c, T0, inp(**{"binary_sensor.min": "on", "binary_sensor.max": "on", "sensor.temp": 75.5}))
    assert s["water_change_active"] and s["channels"][1]["out"] and not s["channels"][2]["out"]
    assert not any(a["key"] == "probe_t1" for a in s["alarms"])  # suppressed during WC
    s = run(c, T0 + timedelta(minutes=2), inp(**{"binary_sensor.min": "off", "binary_sensor.max": "off", "sensor.temp": 77}))
    assert not s["channels"][1]["out"] and s["channels"][2]["out"]
    s = run(c, T0 + timedelta(minutes=4), inp(**{"binary_sensor.min": "on", "binary_sensor.max": "on", "sensor.temp": 77}))
    assert not s["water_change_active"] and not s["channels"][2]["out"]


def test_illumination_and_temperature_dependent_light_reduction():
    c = ctl(probes=[dict(TEMP)])
    c.config["illumination"][0].update({"entries": [{"on": "09:00", "off": "21:00"}], "temp_reduction": True})
    c.config["light_reduction"] = {"probe": "t1", "limit": 3.0}
    ch(c, 1, fn={"type": "illumination", "param": 1})
    assert run(c, T0, inp(**{"sensor.temp": 78}))["channels"][1]["out"] is True
    assert run(c, T0, inp(**{"sensor.temp": 80.1}))["channels"][1]["out"] is False
    assert run(c, T0 + timedelta(hours=2), inp(**{"sensor.temp": 77}))["channels"][1]["out"] is False  # rest of day
    assert run(c, T0 + timedelta(days=1), inp(**{"sensor.temp": 77}))["channels"][1]["out"] is True


def test_power_cut_program_and_blackout_delay():
    c = ctl()
    c.config["power_cut"] = {"enabled": True, "entity": "sensor.ac_in", "mode": "below", "threshold": 80}
    c.config["maintenance"][3].update({"power_cut": True, "after_power": "stop",
                                       "sockets": [{"ch": 1, "state": "on"}, {"ch": 2, "state": "off"}]})
    ch(c, 1, fn={"type": "always_off"})
    ch(c, 2, fn={"type": "always_on"}, blackout_min=10)
    s = run(c, T0, inp(**{"sensor.ac_in": 0}))
    assert s["power_cut"] and s["channels"][1]["out"] and not s["channels"][2]["out"]
    s = run(c, T0 + timedelta(minutes=1), inp(**{"sensor.ac_in": 120}))
    assert not s["power_cut"] and not s["channels"][1]["out"]
    assert s["channels"][2]["out"] is False  # blackout delay after power returns
    assert run(c, T0 + timedelta(minutes=12), inp(**{"sensor.ac_in": 120}))["channels"][2]["out"] is True


def test_manual_override_snapshot_and_invert():
    c = ctl()
    ch(c, 1, fn={"type": "always_on"})
    ch(c, 2, fn={"type": "always_on"}, invert=True)
    s = run(c, T0, {})
    assert s["channels"][1]["out"] and not s["channels"][2]["out"]
    c.set_manual_override(True, {n: v["out"] for n, v in s["channels"].items()})
    c.config["channels"][0]["manual"] = "off"
    s = run(c, T0, {})
    assert not s["channels"][1]["out"] and not s["channels"][2]["out"]


def test_reminders():
    c = ctl()
    c.config["reminders"][0].update({"text": "Replace carbon", "days": 30, "repeat": True,
                                     "start": "2026-10-01", "enabled": True})
    s = run(c, T0, {})
    assert any(a.get("reminder") == 1 for a in s["alarms"])
    c.ack_reminder(1, T0.date())
    assert not any(a.get("reminder") == 1 for a in run(c, T0, {})["alarms"])
    assert any(a.get("reminder") == 1 for a in run(c, T0 + timedelta(days=30), {})["alarms"])


def test_steady_value_is_not_stale_by_default_and_source_check():
    c = ctl(probes=[dict(TEMP)])
    s = c.tick(T0, {"sensor.temp": Input("77.0", T0 - timedelta(hours=2))})
    assert s["probes"]["t1"]["value"] == 77.0
    c.config["data_source"] = {"entity": "sensor.bridge", "ok_states": "Connected"}
    s = c.tick(T0, {"sensor.temp": Input("77.0", T0), "sensor.bridge": Input("Disconnected", T0)})
    assert s["probes"]["t1"]["value"] is None
    s = c.tick(T0, {"sensor.temp": Input("77.0", T0), "sensor.bridge": Input("Connected", T0)})
    assert s["probes"]["t1"]["value"] == 77.0


def test_per_probe_status_entity_overrides_global():
    p = dict(TEMP)
    p.update(status_entity="sensor.hydros_online", status_ok="Online")
    c = ctl(probes=[p])
    c.config["data_source"] = {"entity": "sensor.ghl_conn", "ok_states": "Connected"}
    s = c.tick(T0, {"sensor.temp": Input("77", T0), "sensor.ghl_conn": Input("Disconnected", T0),
                    "sensor.hydros_online": Input("Online", T0)})
    assert s["probes"]["t1"]["value"] == 77.0


def test_select_option_apex_style():
    opts = ["Off", "Auto", "On"]
    assert logic.select_option(opts, True) == "On"
    assert logic.select_option(opts, False) == "Off"
    assert logic.select_option(["off", "on"], True) == "on"
    assert logic.select_option(["Low", "High"], True) is None
    assert logic.select_option(None, False) is None


def test_source_kinds_default_and_merge():
    assert logic.default_config()["source_kinds"] == {}
    cfg = logic.merge_config({"source_kinds": {"dev1": "strip"}, "controllers": [{"device_id": "d", "name": "D", "outlets": ["switch.a"]}]})
    assert cfg["source_kinds"] == {"dev1": "strip"}
    assert cfg["controllers"][0]["outlets"] == ["switch.a"]


def test_feed_pause_holds_outlets_on_top_of_their_function():
    c = ctl(probes=[TEMP])
    ch(c, 1, entity="switch.heater", fn={"type": "temperature", "param": "t1", "mode": "heater"})
    ch(c, 2, entity="switch.return", fn={"type": "always_on"})
    ch(c, 3, entity="switch.light", fn={"type": "always_off"})
    c.config["feed_pauses"][0]["sockets"] = [{"ch": 1, "state": "off"}, {"ch": 2, "state": "off"}, {"ch": 3, "state": "on"}]
    s = run(c, T0, inp(**{"sensor.temp": 75}))
    assert s["channels"][1]["out"] is True and s["channels"][2]["out"] is True and s["channels"][3]["out"] is False
    c.start_feed_pause(1, T0)
    s = run(c, T0 + timedelta(minutes=1), inp(**{"sensor.temp": 75}))
    assert s["channels"][1] == {"out": False, "reason": "feed pause"}
    assert s["channels"][2]["out"] is False and s["channels"][3]["out"] is True
    # maintenance beats the feed pause on the same outlet
    c.config["maintenance"][0]["sockets"] = [{"ch": 2, "state": "on"}]
    c.start_maintenance(1, T0)
    s = run(c, T0 + timedelta(minutes=2), inp(**{"sensor.temp": 75}))
    assert s["channels"][2] == {"out": True, "reason": "maintenance"}
    s = run(c, T0 + timedelta(minutes=6), inp(**{"sensor.temp": 75}))  # feed pause (5 min) over
    assert s["channels"][1]["out"] is True and s["channels"][3]["out"] is False


def test_old_saved_feed_pauses_get_empty_sockets():
    cfg = logic.merge_config({"feed_pauses": [{"n": 1, "name": "Feed", "minutes": 3, "filter_off": True, "timer": 0}]})
    assert cfg["feed_pauses"][0]["sockets"] == [] and cfg["feed_pauses"][0]["name"] == "Feed"


# ---------------- alkalinity advice
_pa = pathlib.Path(__file__).parents[1] / "custom_components" / "sentinel_controller" / "advisor.py"
_sa = importlib.util.spec_from_file_location("advisor", _pa)
advisor = importlib.util.module_from_spec(_sa); _sa.loader.exec_module(advisor)

ADV = {"dkh_entity": "sensor.dkh", "target_dkh": 8.0, "tank_volume": 100, "volume_unit": "gal",
       "naoh_entity": "sensor.naoh", "naoh_g_per_l": 40.0, "fluoride_mg_per_l": 500}


def _naoh(ml_per_day, days=7, start=2000.0, refill_day=None):
    pts, v = [], start
    for h in range(days * 24 + 1):
        if refill_day is not None and h == refill_day * 24:
            v += 1500
        pts.append((T0 - timedelta(hours=days * 24 - h), v))
        v -= ml_per_day / 24
    return pts


def test_daily_use_skips_refills_and_noise():
    assert abs(advisor.daily_use_ml(_naoh(240, refill_day=3)) - 240) < 2  # the refill hour is unseen
    noisy = [(t, v + (3 if i % 2 else -3)) for i, (t, v) in enumerate(_naoh(240))]
    assert abs(advisor.daily_use_ml(noisy) - 240) < 3
    assert advisor.daily_use_ml(_naoh(240)[:10]) is None  # under a day of history


def test_advice_hold_raise_lower_cap_and_fluoride():
    flat = [(T0 - timedelta(days=d), 8.05) for d in (3, 2, 1, 0)]
    a = advisor.recommend(ADV, flat, _naoh(240))
    assert a["state"] == "hold" and abs(a["naoh_new"] - 240) < 1
    # 0.5 dKH low and steady: 100 gal = 378.5 L; need 0.5/3 dKH/day = 22.5 meq/day; 1 meq/mL -> +22.5 mL
    low = [(T0 - timedelta(days=d), 7.5) for d in (3, 2, 1, 0)]
    a = advisor.recommend(ADV, low, _naoh(240))
    assert a["state"] == "raise" and abs(a["change_ml"] - 22.53) < 0.5 and not a["capped"]
    assert abs(a["fluoride"]["mg_day_new"] - a["naoh_new"] * 0.5) < 1e-6 and "Fluoride" in a["text"]
    # falling 0.3 dKH/day while on target: dose must rise to stop the drift; big -> capped at 15 %
    falling = [(T0 - timedelta(days=d), 8.0 + 0.3 * d) for d in (3, 2, 1, 0)]
    a = advisor.recommend({**ADV, "naoh_g_per_l": 10}, falling, _naoh(240))
    assert a["state"] == "raise" and a["capped"] and abs(a["change_pct"] - 15) < 0.01
    high = [(T0 - timedelta(days=d), 8.6) for d in (3, 2, 1, 0)]
    assert advisor.recommend(ADV, high, _naoh(240))["state"] == "lower"


def test_advice_setup_and_missing_data():
    assert advisor.recommend({}, [], [])["state"] == "setup"
    assert advisor.recommend(ADV, [], _naoh(240))["state"] == "no_data"
    assert advisor.recommend(ADV, [(T0, 7.5)], _naoh(240, days=0))["state"] == "no_data"
    one = advisor.recommend(ADV, [(T0, 7.5)], _naoh(240))  # one reading: no trend, gap only
    assert one["state"] == "raise" and one["slope"] is None
    assert abs(advisor.to_ml(10, "fl. oz.") - 295.735) < 1e-6


def test_short_noisy_history_has_no_trend_and_holds_inside_band():
    # 12 h of readings rising 7.63 -> 7.79 (the real case that gave "lower 15 %")
    pts = [(T0 - timedelta(hours=h), 7.79 - 0.16 * h / 12) for h in (12, 10, 8, 6, 4, 2, 0)]
    latest, slope, _ = advisor.dkh_trend(pts)
    assert slope is None
    a = advisor.recommend({**ADV, "tolerance": 0.5, "correction_days": 7}, pts, _naoh(120))
    assert a["state"] == "hold"


def test_inside_band_but_trend_heads_out_still_acts():
    pts = [(T0 - timedelta(days=d), 8.0 + 0.15 * d) for d in (3, 2, 1, 0)]  # on target, falling 0.15/day
    a = advisor.recommend({**ADV, "tolerance": 0.3, "correction_days": 3}, pts, _naoh(240))
    assert a["state"] == "raise"
