/* Loads the current Sentinel Controller card. This file never changes, so a cached copy is fine:
 * it asks Home Assistant which card build is installed and imports that exact build. */
(async () => {
  if (customElements.get("sentinel-controller-card")) return;
  let v = String(Date.now());
  try { const r = await fetch("/api/sentinel_controller/card_version", { cache: "no-store" }); if (r.ok) v = (await r.json()).version; } catch (e) { /* fall back to a fresh load */ }
  await import(`/sentinel_controller_static/sentinel-controller-card.js?v=${encodeURIComponent(v)}`);
})();
