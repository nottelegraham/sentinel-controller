"""Alkalinity dosing advice: recommend a new daily NaOH dose from measured dKH.

Pure functions, no Home Assistant imports (unit-testable). The runtime feeds in
history pulled from the recorder:
  * dKH readings from any sensor (an Aquarino, KH Director, a manual-test input_number...)
  * doser container levels, from which the actual daily use is worked out.

Chemistry: 1 meq/L alkalinity = 2.8 dKH. NaOH (40.00 g/mol) gives 1 meq per mmol,
so a solution of c g/L carries c / 40 meq per mL. Nothing here ever changes a doser;
it only recommends.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

DKH_PER_MEQ = 2.8
NAOH_G_PER_MOL = 40.00
L_PER_GAL = 3.78541
ML_PER_UNIT = {"ml": 1.0, "l": 1000.0, "fl. oz.": 29.5735, "fl oz": 29.5735, "floz": 29.5735, "oz": 29.5735,
               "gal": 3785.41, "": 1.0}
REFILL_ML = 50.0          # a rise bigger than this between two readings is a refill, not noise
MIN_USE_SPAN_DAYS = 1.0   # need at least a day of container history
MIN_TREND_SPAN_H = 48.0   # a trend needs readings spread over at least 2 days...
MIN_TREND_POINTS = 4      # ...and at least 4 of them; short, noisy runs make wild slopes
STEADY_SLOPE = 0.1        # dKH/day: below this the trend counts as flat

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "dkh_entity": "",         # measured dKH
    "target_dkh": 8.0,
    "tolerance": 0.2,         # dKH either side of target that needs no change
    "correction_days": 3,     # spread a correction toward target over this many days
    "max_change_pct": 15,     # never recommend more than this change at once
    "tank_volume": 0,         # net water volume
    "volume_unit": "gal",     # gal | l
    "naoh_entity": "",        # NaOH container level sensor
    "naoh_g_per_l": 0,        # NaOH strength of the dosing solution
    "fluoride_mg_per_l": 0,   # fluoride in that solution
    "kalk_entity": "",        # kalkwasser container level sensor (shown for context)
    "window_days": 7,         # history used for daily use and the dKH trend
    "notify": True,
}


def to_ml(value: float, unit: str | None) -> float:
    return float(value) * ML_PER_UNIT.get(str(unit or "").strip().lower(), 1.0)


def tank_liters(cfg: dict) -> float:
    v = float(cfg.get("tank_volume") or 0)
    return v * L_PER_GAL if str(cfg.get("volume_unit", "gal")).lower() == "gal" else v


def daily_use_ml(points: list[tuple[datetime, float]]) -> float | None:
    """mL/day used, from (time, container mL) readings. Refills are skipped; small rises
    (sensor noise) offset earlier drops so jitter doesn't inflate the total."""
    pts = sorted(points)
    if len(pts) < 2:
        return None
    span = (pts[-1][0] - pts[0][0]).total_seconds() / 86400.0
    if span < MIN_USE_SPAN_DAYS:
        return None
    used = 0.0
    for (_, a), (_, b) in zip(pts, pts[1:]):
        rise = b - a
        if rise > REFILL_ML:
            continue
        used -= rise
    return max(0.0, used) / span


def dkh_trend(points: list[tuple[datetime, float]]) -> tuple[float | None, float | None, datetime | None]:
    """(latest value, slope in dKH/day or None, time of latest)."""
    pts = sorted(points)
    if not pts:
        return None, None, None
    latest_t, latest = pts[-1]
    if len(pts) < MIN_TREND_POINTS or (pts[-1][0] - pts[0][0]).total_seconds() / 3600.0 < MIN_TREND_SPAN_H:
        return latest, None, latest_t
    t0 = pts[0][0]
    xs = [(t - t0).total_seconds() / 86400.0 for t, _ in pts]
    ys = [v for _, v in pts]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return latest, None, latest_t
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return latest, slope, latest_t


def recommend(cfg: dict, dkh: list[tuple[datetime, float]], naoh: list[tuple[datetime, float]],
              kalk: list[tuple[datetime, float]] | None = None) -> dict[str, Any]:
    """Return the advice shown on the dashboard and sent as a notification."""
    c = {**DEFAULTS, **(cfg or {})}
    out: dict[str, Any] = {"state": "setup", "text": "", "target": float(c["target_dkh"]),
                           "tolerance": float(c["tolerance"]), "max_change_pct": float(c["max_change_pct"])}
    liters = tank_liters(c)
    g_per_l = float(c.get("naoh_g_per_l") or 0)
    missing = [w for w, ok in (("dKH sensor", c.get("dkh_entity")), ("tank volume", liters > 0),
                               ("NaOH container", c.get("naoh_entity")), ("NaOH strength", g_per_l > 0)) if not ok]
    if missing:
        out["text"] = "Set up: " + ", ".join(missing)
        return out

    latest, slope, latest_t = dkh_trend(dkh)
    use = daily_use_ml(naoh)
    out.update({"dkh": latest, "dkh_at": latest_t.isoformat() if latest_t else None, "slope": slope,
                "naoh_now": use, "kalk_now": daily_use_ml(kalk or [])})
    if latest is None:
        out.update(state="no_data", text="No dKH reading yet")
        return out
    if use is None:
        out.update(state="no_data", text="Not enough NaOH container history yet (needs about a day)")
        return out
    if use <= 0:
        out.update(state="no_data", text="NaOH container level isn't dropping, so the current dose can't be worked out")
        return out

    target, tol = float(c["target_dkh"]), float(c["tolerance"])
    gap = target - latest
    days = max(1.0, float(c["correction_days"]))
    # Inside the no-change zone, hold unless the trend would carry dKH out of it within the correction period.
    projected = latest + (slope or 0.0) * days
    if abs(gap) <= tol and abs(target - projected) <= tol:
        out.update(state="hold", change_ml=0.0, change_pct=0.0, naoh_new=use, text=f"dKH {latest:.2f} is on target — keep NaOH at {use:.0f} mL/day")
        _fluoride(out, c, liters, use, use)
        return out

    # dKH/day the dosing must add on top of today's: stop the drift, then close the gap over N days.
    need = -(slope or 0.0) + gap / days
    meq_per_ml = g_per_l / NAOH_G_PER_MOL
    change = need * liters / DKH_PER_MEQ / meq_per_ml
    cap = use * float(c["max_change_pct"]) / 100.0
    capped = abs(change) > cap
    if capped:
        change = cap if change > 0 else -cap
    new = max(0.0, use + change)
    change = new - use
    pct = change / use * 100.0
    if abs(pct) < 1.0:
        out.update(state="hold", change_ml=0.0, change_pct=0.0, naoh_new=use, text=f"dKH {latest:.2f} — no change needed, keep NaOH at {use:.0f} mL/day")
        _fluoride(out, c, liters, use, use)
        return out
    out.update(state="raise" if change > 0 else "lower", change_ml=change, change_pct=pct, naoh_new=new, capped=capped,
               text=f"dKH {latest:.2f} (target {target:g}): {'raise' if change > 0 else 'lower'} NaOH from {use:.0f} to {new:.0f} mL/day ({pct:+.0f}%)"
                    + (" — limited to the max change; check again after the next test" if capped else ""))
    _fluoride(out, c, liters, use, new)
    return out


def _fluoride(out: dict, c: dict, liters: float, old_ml: float, new_ml: float) -> None:
    f = float(c.get("fluoride_mg_per_l") or 0)
    if f <= 0:
        return
    old_mg, new_mg = old_ml * f / 1000.0, new_ml * f / 1000.0
    out["fluoride"] = {"mg_day_now": old_mg, "mg_day_new": new_mg,
                       "ppm_day_now": old_mg / liters, "ppm_day_new": new_mg / liters}
    if abs(new_mg - old_mg) > 1e-9:
        out["text"] += f". Fluoride goes from {old_mg:.1f} to {new_mg:.1f} mg/day"
