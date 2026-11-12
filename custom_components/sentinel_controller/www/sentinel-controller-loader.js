/* Sentinel Controller loader. This file never changes, so a cached copy is fine.
 * It registers <sentinel-controller-card> immediately (so dashboards never see a missing card),
 * then asks Home Assistant which card build is installed and loads that build inside it. */
(() => {
  if (customElements.get("sentinel-controller-card")) return;
  let impl;
  const loadImpl = () => impl || (impl = (async () => {
    let v = String(Date.now());
    try { const r = await fetch("/api/sentinel_controller/card_version", { cache: "no-store" }); if (r.ok) v = (await r.json()).version; } catch (e) { /* use a fresh load */ }
    await import(`/sentinel_controller_static/sentinel-controller-card.js?v=${encodeURIComponent(v)}`);
    await customElements.whenDefined("sentinel-controller-card-impl");
  })());
  class SentinelControllerShell extends HTMLElement {
    setConfig(c) { this._c = c || {}; if (this._i) this._i.setConfig(this._c); }
    getCardSize() { return 14; }
    set hass(h) { this._h = h; if (this._i) this._i.hass = h; else this._mount(); }
    connectedCallback() { this.style.display = "block"; if (!this._i && !this.firstChild) this.innerHTML = '<div style="padding:16px;color:#4a6378">Loading Sentinel Controller…</div>'; }
    async _mount() {
      if (this._mounting) return; this._mounting = true;
      try {
        await loadImpl();
        const i = document.createElement("sentinel-controller-card-impl");
        i.setConfig(this._c || {}); this.innerHTML = ""; this.appendChild(i); this._i = i; i.hass = this._h;
      } catch (e) {
        this._mounting = false;
        this.innerHTML = `<div style="padding:16px;color:#b02a2a">Sentinel Controller could not load: ${String(e && e.message || e)}. Pull down to refresh.</div>`;
      }
    }
  }
  customElements.define("sentinel-controller-card", SentinelControllerShell);
  window.customCards = window.customCards || [];
  if (!window.customCards.find((c) => c.type === "sentinel-controller-card"))
    window.customCards.push({ type: "sentinel-controller-card", name: "Sentinel Controller", description: "Reef controller for Home Assistant" });
})();
