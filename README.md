# Sentinel Controller

A ProfiLux-4-style control scheme that runs inside Home Assistant. It drives ordinary Home Assistant
switches and smart plugs (for example a Kasa KP303) the way a GHL ProfiLux 4 drives its powerbar.
Every setting comes from the GHL *ProfiLux 4 / 4e Resource Guide (GHL Connect edition)*.

It does **not** talk to a GHL controller. Probe values come from any Home Assistant sensor
(for example the ProfiLux Mini values your bridge publishes over MQTT).

## What it does

| P4 menu | Here |
|---|---|
| Sensors | Probes (temperature, pH, other): description, source sensor, nominal value, hysteresis, alarm active, max. deviation, no alarm on water change, deactivate control |
| Switch channels | 48 channels. Description, device, function, invert, blackout delay, fallback state, operating hours, manual override |
| Functions | Always off/on, Temperature (Heater/Cooler), pH value (Control upwards/downwards), Timer, Illumination, Filter (feed pause), Maintenance, Fill water, Fill water ATO only, Fill water AWC only, Drain water, Programmable logic |
| Processes | 32 timers. Normal (ON/OFF pairs) or Event start; special weekdays or day intervals (repeat every N days, starting date) |
| Illumination | 16 non-dimmable channels with ON/OFF times; temperature-dependent light reduction (OFF for the rest of the day at nominal + limit) |
| Feed pause | 4 feed pauses, 1–120 min, Filter off, started manually or by an Event-start timer |
| Maintenance / Power cut | 4 modes: sockets ON or OFF for up to 240 min; any mode can be the power-cut emergency program |
| Level control | 8 control circuits: Auto top off, Min/Max control, ATO with 2 sensors, Water change, ATO & water change, Leakage detection; maximum on-time failsafe, automatic error reset, ATO timer, water change timer. 8 level sensors with invert and reaction time |
| Programmable logic | 32 gates: AND, OR, Delayed ON, Delayed OFF; inputs can be inverted and can be other gates |
| Reminders | 16 reminders, days, repeat |
| Notifications | Any `notify.*` service: new alarm, cleared, repeat while active, daily status |

Entities: `binary_sensor` Alarm (attributes list the alarms), Feed pause 1–4, Maintenance 1–4,
Water change, Power cut; `sensor` Channels on (attributes list every assigned channel).

Services: `sentinel_controller.start_feed_pause`, `stop_feed_pause`, `start_maintenance`,
`stop_maintenance`, `start_water_change`, `stop_water_change`, `reset_level_error`,
`acknowledge_reminder`, `manual_override`, `channel_manual`.

## Where this differs from, or goes beyond, the resource guide

The guide does not spell these out, so this is how Sentinel Controller does them:

* **Hysteresis**: switch points are nominal − hysteresis ÷ 2 and nominal + hysteresis ÷ 2. The card shows both points.
* **pH "Control downwards"** turns the outlet ON when pH is above the band and OFF when below it (a calcium reactor CO2 solenoid lowers pH). The guide's prose on page 58 states the reverse; the function name was followed.
* **Water change sequence**: drain until sensor 1 (lower) is dry, then fill until sensor 2 (upper) detects water. The maximum on-time applies to each phase.
* **Blackout delay**: the outlet stays OFF for that many minutes after Home Assistant starts or power returns.
* **Manual override** starts from each channel's current state.
* **Fallback state** (the guide's powerbar fallback) is used when a function has no data: probe unavailable or older than the data timeout.

## Not included

1-10V interfaces and stream groups, the GHL Vortech controller, Mitras lightbars, dimmable
illumination, dosing-pump schedules, probe calibration, firmware and Wi-Fi settings. These need GHL
hardware or stay on the GHL controller.

## Install (HACS)

HACS → Integrations → ⋮ → Custom repositories → add this repository as *Integration* →
install **Sentinel Controller** → restart Home Assistant → Settings → Devices & services →
Add integration → Sentinel Controller. Then add the card to a dashboard:

```yaml
type: custom:sentinel-controller-card
```

## Safety

Smart plugs hold their last state if Home Assistant or Wi-Fi goes down. Set a heater's own
thermostat 1–2 °F above the setpoint as a hardware backup.
