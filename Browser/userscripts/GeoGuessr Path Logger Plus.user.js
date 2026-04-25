// ==UserScript==
// @name         GeoGuessr Path Logger Plus
// @namespace    Odinman9847
// @version      1.5.1
// @author       Odinman9847 (Original script by xsanda)
// @description  The 2026 Path Logger Upgrade. Now with duels support, customization, gradients, RDP smoothing, fixed bugs, and more.
// @license      MIT
// @copyright    2026, Odinman9847
// @match        https://www.geoguessr.com/*
// @grant        none
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/564743/GeoGuessr%20Path%20Logger%20Plus.user.js
// @updateURL https://update.greasyfork.org/scripts/564743/GeoGuessr%20Path%20Logger%20Plus.meta.js
// ==/UserScript==

(function () {
  "use strict";

  window.__GPL_GAME_ID = null;
  (function surgicalWebSocketHook() {
    const origAddEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function (type, listener, options) {
      if (type === "message") {
        const wrappedListener = function (...args) {
          const event = args[0];
          try {
            const data = JSON.parse(event.data);
            if (data.code === "DuelNewRound") {
              window.__WS_ROUND = data.duel.state.currentRoundNumber;
            }
            if (data.code === "DuelStarted") {
              window.__GPL_GAME_ID = data.duel.state.gameId;
            }
          } catch {}
          if (typeof listener === "function") {
            return listener.apply(this, args);
          } else {
            return listener.handleEvent(event);
          }
        };
        return origAddEventListener.call(this, type, wrappedListener, options);
      }
      return origAddEventListener.call(this, type, listener, options);
    };
    WebSocket.prototype.addEventListener.toString = () =>
      "function addEventListener() { [native code] }";
  })();
  const SETTINGS_KEY = "pl_settings_v2";
  const DEFAULT_STATE = {
    style: "gradient",
    solidColor: "#ff0000",
    gradStart: "#22c55e",
    gradMiddle: "#eab308",
    gradEnd: "#ef4444",
    thickness: 6,
  };
  let state = { ...DEFAULT_STATE };
  let capturedMap = null;
  let hasRenderedResult = "";
  function loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) state = { ...DEFAULT_STATE, ...JSON.parse(saved) };
    } catch {
      state = { ...DEFAULT_STATE };
    }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
  }
  loadSettings();
  const hexToHsl = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  };
  const hslToHex = (h, s, l) => {
    l /= 100;
    s /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const interpolateHSL = (c1, c2, t) => {
    const h1 = hexToHsl(c1);
    const h2 = hexToHsl(c2);
    let hue1 = h1.h;
    let hue2 = h2.h;
    if (hue2 - hue1 > 180) hue1 += 360;
    else if (hue2 - hue1 < -180) hue2 += 360;
    return hslToHex(
      (hue1 + (hue2 - hue1) * t) % 360,
      h1.s + (h2.s - h1.s) * t,
      h1.l + (h2.l - h1.l) * t,
    );
  };
  const presets = [
    {
      name: "The Classic",
      start: "#22c55e",
      middle: "#eab308",
      end: "#ef4444",
    },
    { name: "The Fire", start: "#fef08a", middle: "#fb923c", end: "#dc2626" },
    { name: "Ocean", start: "#70e1d4", middle: "#2d568b", end: "#161b5a" },
    { name: "Rose", start: "#fddbff", middle: "#bc57b4", end: "#3a123b" },
    { name: "Forest", start: "#aef29c", middle: "#246149", end: "#06280a" },
    { name: "Peanut", start: "#eae79f", middle: "#ffa500", end: "#171107" },
  ];
  const style = document.createElement("style");
  style.innerHTML = `
        :root { --pl-bg-modal: #1e1b3a; --pl-bg-accent: #2a2650; --pl-bg-hover: #332d5c; --pl-blue: #3b82f6; --pl-blue-hover: #2563eb; --pl-text: #ffffff; --pl-dim: #9ca3af; --pl-border: #2a2650; }
        #pl-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(8px); z-index: 99999; display: none; justify-content: center; align-items: center; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        #pl-modal { background-color: var(--pl-bg-modal); width: 100%; max-width: 550px; max-height: 90vh; border-radius: 20px; border: 1px solid var(--pl-border); color: var(--pl-text); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; animation: pl-fade-in 0.2s ease-out; overflow: hidden; }
        @keyframes pl-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .pl-header { padding: 20px 24px; border-bottom: 1px solid var(--pl-border); flex-shrink: 0; }
        .pl-header h2 { margin: 0; font-size: 20px; font-weight: 700; }
        .pl-header p { margin: 4px 0 0 0; color: var(--pl-dim); font-size: 13px; }
        .pl-content { padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--pl-bg-accent) transparent; }
        .pl-content::-webkit-scrollbar { width: 6px; }
        .pl-content::-webkit-scrollbar-thumb { background: var(--pl-bg-accent); border-radius: 10px; }
        .pl-section { display: flex; flex-direction: column; }
        .pl-title { font-size: 16px; font-weight: 500; color: white; margin-bottom: 10px; }
        .pl-sub-label { font-size: 13px; color: var(--pl-dim); margin-bottom: 6px; display: block; }
        .pl-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .pl-btn-group { display: flex; gap: 8px; }
        .pl-btn-toggle { flex: 1; padding: 10px; border-radius: 10px; border: none; background: var(--pl-bg-accent); color: var(--pl-dim); cursor: pointer; font-weight: 500; transition: 0.2s; font-size: 14px;}
        .pl-btn-toggle.active { background: var(--pl-blue); color: white; }
        .pl-color-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .pl-swatch { height: 40px; border-radius: 8px; border: 2px solid var(--pl-border); position: relative; cursor: pointer; overflow: hidden; }
        .pl-native-picker { position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
        .pl-preview-bar { height: 48px; border-radius: 10px; border: 2px solid var(--pl-border); margin-top: 4px; }
        .pl-preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .pl-preset { background: transparent; border: none; padding: 0; cursor: pointer; text-align: center; }
        .pl-preset-bar { height: 32px; border-radius: 6px; border: 2px solid var(--pl-border); margin-bottom: 4px; cursor: pointer; }
        .pl-preset span { font-size: 10px; color: var(--pl-dim); cursor: pointer; }
        .pl-range { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; outline: none; border: none !important; box-shadow: none !important; margin-top: 4px; }
        .pl-range::-webkit-slider-runnable-track { width: 100%; height: 6px; cursor: pointer; background: var(--pl-bg-accent); border-radius: 10px; border: none !important; }
        .pl-range::-moz-range-track { width: 100%; height: 6px; cursor: pointer; background: var(--pl-bg-accent); border-radius: 10px; border: none !important; }
        .pl-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; height: 20px; width: 20px; border-radius: 50%; background: var(--pl-blue); cursor: pointer; border: 2px solid white !important; box-shadow: 0 0 8px rgba(0,0,0,0.4); margin-top: -7px; }
        .pl-range::-moz-range-thumb { height: 20px; width: 20px; border-radius: 50%; background: var(--pl-blue); cursor: pointer; border: 2px solid white !important; box-shadow: 0 0 8px rgba(0,0,0,0.4); }

        .pl-preview-box { background: #0f0d1f; border-radius: 12px; border: 1px solid var(--pl-border); padding: 15px; height: 80px; display: flex; align-items: center; flex-shrink: 0; }
        .pl-footer { padding: 16px 24px; border-top: 1px solid var(--pl-border); display: flex; justify-content: flex-end; gap: 12px; flex-shrink: 0; }
        .pl-btn { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; }
        .pl-btn-cancel { background: var(--pl-bg-accent); color: var(--pl-dim); }
        .pl-btn-save { background: var(--pl-blue); color: white; }
        .pl-hidden { display: none; }
        .pl-switch { position: relative; width: 50px; height: 26px; cursor: pointer; flex-shrink: 0; }
        .pl-switch input { opacity: 0; width: 0; height: 0; }
        .pl-slider-round { position: absolute; inset: 0; background: #4b5563; border-radius: 34px; transition: .3s; }
        .pl-slider-round:before { position: absolute; content: ""; height: 18px; width: 18px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: .3s; }
        .pl-switch input:checked + .pl-slider-round { background: var(--pl-blue); }
        .pl-switch input:checked + .pl-slider-round:before { transform: translateX(24px); }
    `;
  document.head.appendChild(style);
  const backdrop = document.createElement("div");
  backdrop.id = "pl-backdrop";
  backdrop.innerHTML = `
        <div id="pl-modal">
            <div class="pl-header"><h2>Path Logger Settings</h2><p>Customize your GeoGuessr path visualization</p></div>
            <div class="pl-content">
                <div class="pl-section"><h3 class="pl-title">Line Style</h3><div class="pl-btn-group"><button class="pl-btn-toggle" id="pl-style-solid">Solid</button><button class="pl-btn-toggle" id="pl-style-grad">Gradient</button></div></div>
                <div id="pl-grad-ui" class="pl-section">
                    <h3 class="pl-title">Gradient Colors</h3>
                    <div class="pl-color-grid">
                        <div class="pl-section"><span class="pl-sub-label">Start</span><div class="pl-swatch" id="pl-swatch-start"><input type="color" class="pl-native-picker" id="pl-pick-start"></div></div>
                        <div class="pl-section"><span class="pl-sub-label">Middle</span><div class="pl-swatch" id="pl-swatch-mid"><input type="color" class="pl-native-picker" id="pl-pick-mid"></div></div>
                        <div class="pl-section"><span class="pl-sub-label">End</span><div class="pl-swatch" id="pl-swatch-end"><input type="color" class="pl-native-picker" id="pl-pick-end"></div></div>
                    </div>
                    <div style="margin-top:15px"><span class="pl-sub-label">Preview Bar</span><div class="pl-preview-bar" id="pl-grad-bar"></div></div>
                    <div style="margin-top:15px"><span class="pl-sub-label">Presets</span><div class="pl-preset-grid" id="pl-presets"></div></div>
                </div>
                <div id="pl-solid-ui" class="pl-section pl-hidden"><h3 class="pl-title">Solid Color</h3><div class="pl-swatch" id="pl-swatch-solid" style="width: 100px"><input type="color" class="pl-native-picker" id="pl-pick-solid"></div></div>
                <div class="pl-section"><h3 class="pl-title">Line Thickness: <span id="pl-thick-val" style="color:var(--pl-blue)">${state.thickness}px</span></h3><input type="range" min="1" max="12" value="${state.thickness}" class="pl-range" id="pl-thick-range"></div>
                <div class="pl-section"><h3 class="pl-title">Line Preview</h3><div class="pl-preview-box"><svg width="100%" height="50" viewBox="0 0 500 60" preserveAspectRatio="none"><defs><linearGradient id="pl-svg-grad" x1="0%" y1="0%" x2="100%" y2="0%"></linearGradient></defs><path id="pl-svg-path" d="M 20 30 Q 125 0, 250 30 T 480 30" fill="none" stroke-linecap="round" /></svg></div></div>
            </div>
            <div class="pl-footer"><button class="pl-btn pl-btn-cancel" id="pl-cancel">Close</button><button class="pl-btn pl-btn-save" id="pl-save">Save Settings</button></div>
        </div>
    `;
  const syncValue = (id, color) => {
    const swatch = document.getElementById(`pl-swatch-${id}`);
    const picker = document.getElementById(`pl-pick-${id}`);
    if (swatch) swatch.style.backgroundColor = color;
    if (picker) picker.value = color;
  };
  function updateUI() {
    const isGrad = state.style === "gradient";
    document
      .getElementById("pl-solid-ui")
      ?.classList.toggle("pl-hidden", isGrad);
    document
      .getElementById("pl-grad-ui")
      ?.classList.toggle("pl-hidden", !isGrad);
    document
      .getElementById("pl-style-solid")
      ?.classList.toggle("active", !isGrad);
    document
      .getElementById("pl-style-grad")
      ?.classList.toggle("active", isGrad);
    syncValue("start", state.gradStart);
    syncValue("mid", state.gradMiddle);
    syncValue("end", state.gradEnd);
    syncValue("solid", state.solidColor);
    const svgGrad = document.getElementById("pl-svg-grad");
    const gradBar = document.getElementById("pl-grad-bar");
    if (svgGrad) {
      svgGrad.innerHTML = "";
      let gradStr = "linear-gradient(to right, ";
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const color =
          t < 0.5
            ? interpolateHSL(state.gradStart, state.gradMiddle, t * 2)
            : interpolateHSL(state.gradMiddle, state.gradEnd, (t - 0.5) * 2);
        const pos = (t * 100).toFixed(1) + "%";
        gradStr += `${color} ${pos}${i < 40 ? ", " : ")"}`;
        const stop = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "stop",
        );
        stop.setAttribute("offset", pos);
        stop.setAttribute("stop-color", color);
        svgGrad.appendChild(stop);
      }
      if (gradBar) gradBar.style.background = gradStr;
    }
    const thickVal = document.getElementById("pl-thick-val");
    if (thickVal) thickVal.innerText = state.thickness + "px";
    const svgPath = document.getElementById("pl-svg-path");
    if (svgPath) {
      svgPath.setAttribute("stroke-width", state.thickness.toString());
      svgPath.setAttribute(
        "stroke",
        isGrad ? "url(#pl-svg-grad)" : state.solidColor,
      );
    }
    saveSettings();
    mapState = "";
    hasRenderedResult = "";
    if (capturedMap) onMapUpdate(capturedMap);
  }
  const showModal = () => {
    backdrop.style.display = "flex";
    updateUI();
  };
  const hideModal = () => {
    backdrop.style.display = "none";
  };
  const injectUI = () => {
    if (!document.getElementById("pl-backdrop"))
      document.body.appendChild(backdrop);
    const presetContainer = document.getElementById("pl-presets");
    if (presetContainer) {
      presetContainer.innerHTML = presets
        .map(
          (p) => `
              <button class="pl-preset" data-s="${p.start}" data-m="${p.middle}" data-e="${p.end}">
                  <div class="pl-preset-bar" style="background:linear-gradient(to right, ${p.start}, ${p.middle}, ${p.end})"></div>
                  <span>${p.name}</span>
              </button>
          `,
        )
        .join("");
    }
    document.querySelectorAll(".pl-preset").forEach(
      (b) =>
        (b.onclick = () => {
          state.gradStart = b.dataset.s || state.gradStart;
          state.gradMiddle = b.dataset.m || state.gradMiddle;
          state.gradEnd = b.dataset.e || state.gradEnd;
          updateUI();
        }),
    );
    const styleSolidBtn = document.getElementById("pl-style-solid");
    if (styleSolidBtn) {
      styleSolidBtn.onclick = () => {
        state.style = "solid";
        updateUI();
      };
    }
    const styleGradBtn = document.getElementById("pl-style-grad");
    if (styleGradBtn) {
      styleGradBtn.onclick = () => {
        state.style = "gradient";
        updateUI();
      };
    }
    const pickStartBtn = document.getElementById("pl-pick-start");
    if (pickStartBtn) {
      pickStartBtn.oninput = (e) => {
        state.gradStart = e.target.value;
        updateUI();
      };
    }
    const pickMidBtn = document.getElementById("pl-pick-mid");
    if (pickMidBtn) {
      pickMidBtn.oninput = (e) => {
        state.gradMiddle = e.target.value;
        updateUI();
      };
    }
    const pickEndBtn = document.getElementById("pl-pick-end");
    if (pickEndBtn) {
      pickEndBtn.oninput = (e) => {
        state.gradEnd = e.target.value;
        updateUI();
      };
    }
    const pickSolidBtn = document.getElementById("pl-pick-solid");
    if (pickSolidBtn) {
      pickSolidBtn.oninput = (e) => {
        state.solidColor = e.target.value;
        updateUI();
      };
    }
    const thickRangeBtn = document.getElementById("pl-thick-range");
    if (thickRangeBtn) {
      thickRangeBtn.oninput = (e) => {
        state.thickness = parseInt(e.target.value);
        updateUI();
      };
    }
    const cancelBtn = document.getElementById("pl-cancel");
    if (cancelBtn) cancelBtn.onclick = hideModal;
    const saveBtn = document.getElementById("pl-save");
    if (saveBtn) saveBtn.onclick = hideModal;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) hideModal();
    };
  };
  const injectButton = () => {
    const headerRight = document.querySelector(
      "[class*=header-desktop_desktopSectionRight__]",
    );
    if (headerRight && !document.getElementById("pl-settings-btn")) {
      const btn = document.createElement("div");
      btn.id = "pl-settings-btn";
      btn.style =
        "cursor:pointer; display:flex; align-items:center; margin-right:15px; transition:opacity 0.2s;";
      btn.innerHTML = `<img src="https://www.svgrepo.com/show/455171/route-destination.svg" style="width: 22px; height: 22px; filter: brightness(0) invert(1); opacity: 1.0;">`;
      btn.onclick = showModal;
      headerRight.insertBefore(btn, headerRight.firstChild);
      injectUI();
    }
  };
  const uiObserver = new MutationObserver(() => {
    injectButton();
    if (resultShown() && capturedMap) {
      const currentState = `true-${isGameFinished()}`;
      if (hasRenderedResult !== currentState) {
        setTimeout(() => {
          if (capturedMap) onMapUpdate(capturedMap);
        }, 200);
      }
    }
  });
  uiObserver.observe(document.body, { childList: true, subtree: true });
  const RDP_EPSILON = 2e-5;
  const TELEPORT_DISTANCE = 120;
  const getDistMeters = (p1, p2) => {
    const R = 6371e3;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };
  const findPerpDist = (p, l1, l2) => {
    if (l1.lat === l2.lat && l1.lng === l2.lng)
      return Math.sqrt((p.lat - l1.lat) ** 2 + (p.lng - l1.lng) ** 2);
    const num = Math.abs(
      (l2.lng - l1.lng) * p.lat -
        (l2.lat - l1.lat) * p.lng +
        l2.lat * l1.lng -
        l2.lng * l1.lat,
    );
    const den = Math.sqrt((l2.lng - l1.lng) ** 2 + (l2.lat - l1.lat) ** 2);
    return num / den;
  };
  const rdp = (points, epsilon) => {
    if (points.length <= 2) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
      const d = findPerpDist(points[i], points[0], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }
    if (dmax > epsilon) {
      const res1 = rdp(points.slice(0, index + 1), epsilon);
      const res2 = rdp(points.slice(index), epsilon);
      return res1.slice(0, res1.length - 1).concat(res2);
    } else {
      return [points[0], points[end]];
    }
  };
  const saveToStorage = (key, value) => {
    const val = JSON.stringify(value);
    while (JSON.stringify(localStorage).length + val.length > 5242880) {
      const ts = JSON.parse(localStorage.getItem("timestamps") || "{}");
      const oldest = Object.entries(ts).sort((a, b) => a[1] - b[1])[0];
      if (!oldest) break;
      delete ts[oldest[0]];
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(oldest[0])) localStorage.removeItem(k);
      });
      localStorage.setItem("timestamps", JSON.stringify(ts));
    }
    localStorage.setItem(key, val);
  };
  const decodePath = (encoded) => {
    if (window.google?.maps?.geometry?.encoding) {
      return window.google.maps.geometry.encoding.decodePath(encoded);
    }
    const len = encoded.length;
    let index = 0;
    const array = [];
    let lat = 0;
    let lng = 0;
    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;
      array.push(new window.google.maps.LatLng(lat * 1e-5, lng * 1e-5));
    }
    return array;
  };
  const interpolatePath = (p1, p2, fraction) => {
    if (window.google?.maps?.geometry?.spherical) {
      return window.google.maps.geometry.spherical.interpolate(
        p1,
        p2,
        fraction,
      );
    }
    const lat = p1.lat() + (p2.lat() - p1.lat()) * fraction;
    const lng = p1.lng() + (p2.lng() - p1.lng()) * fraction;
    return new window.google.maps.LatLng(lat, lng);
  };
  const markers = [];
  let inGame = false;
  let route = [];
  let mapState = "";
  let lastObservedSpawn = null;
  const isGamePage = () => {
    const path = location.pathname;
    return (
      path.includes("/challenge/") ||
      path.includes("/results/") ||
      path.includes("/game/") ||
      path.includes("/duels/") ||
      path.includes("/multiplayer") ||
      path.includes("/summary")
    );
  };
  const resultShown = () => {
    if (document.querySelector('[data-qa="result-view-bottom"]')) return true;
    if (document.querySelector('[data-qa="round-result"]')) return true;
    if (document.querySelector('[class*="round-score_root"]')) return true;
    if (location.href.includes("results") || location.href.includes("summary"))
      return true;
    return false;
  };
  const isGameFinished = () => {
    if (location.href.includes("results") || location.href.includes("summary"))
      return true;
    if (
      document.querySelector('[data-qa="play-again-button"]') ||
      document.querySelector('[class*="play-again-button"]')
    )
      return true;
    return false;
  };
  const isSpectating = () => {
    if (
      document.querySelector('[class*="post-guess-player-spectator_root"]') ||
      location.href.includes("/replay")
    ) {
      return true;
    }
    return false;
  };
  const getGameID = () => {
    const urlMatch = location.href.match(/\w{15,}/);
    if (urlMatch && !location.pathname.includes("multiplayer")) {
      return urlMatch[0];
    }
    if (window.__GPL_GAME_ID) {
      return window.__GPL_GAME_ID;
    }
    if (urlMatch) return urlMatch[0];
    return "unknown_game";
  };
  const getRoundNumber = () => {
    const spEl = document.querySelector("[data-qa=round-number] :nth-child(2)");
    if (spEl) return parseInt(spEl.innerHTML);
    if (window.__WS_ROUND) return window.__WS_ROUND;
    return 1;
  };
  const onMove = (sv) => {
    const isMoving = sv.get("clickToGo");
    if (!isGamePage() || !isMoving) return;
    const lat = sv.getPosition()?.lat();
    const lng = sv.getPosition()?.lng();
    if (lat === void 0 || lng === void 0) return;
    const pos = { lat, lng };
    if (resultShown()) {
      lastObservedSpawn = pos;
    }
    if (isSpectating()) return;
    if (!inGame) {
      inGame = true;
      route = lastObservedSpawn ? [[lastObservedSpawn]] : [[]];
    }
    const currentSeg = route[route.length - 1];
    const last = currentSeg[currentSeg.length - 1];
    if (last && getDistMeters(last, pos) > TELEPORT_DISTANCE) {
      route.push([]);
    }
    route[route.length - 1].push(pos);
  };
  const onMapUpdate = (map) => {
    const google = window.google;
    if (!isGamePage()) {
      return;
    }
    const actResultShown = resultShown();
    if (actResultShown) {
      const isFinished = isGameFinished();
      const resultState = `${actResultShown}-${isFinished}`;
      if (hasRenderedResult === resultState) {
        return;
      }
      hasRenderedResult = resultState;
    } else {
      hasRenderedResult = "";
    }
    const newState = `${inGame}-${actResultShown}-${isGameFinished()}-${getRoundNumber()}`;
    if (newState === mapState) return;
    mapState = newState;
    markers.forEach((m) => m.setMap(null));
    markers.length = 0;
    if (actResultShown) {
      const settings = state;
      const currentGameID = getGameID();
      if (inGame) {
        const rNum = getRoundNumber();
        const saveID = currentGameID + "-" + rNum;
        const simplifiedRoute = route.map((segment) =>
          rdp(segment, RDP_EPSILON),
        );
        const encoded = simplifiedRoute.map((p) =>
          google.maps.geometry.encoding.encodePath(
            p.map((x) => new google.maps.LatLng(x)),
          ),
        );
        saveToStorage(saveID, encoded);
        const ts = JSON.parse(localStorage.timestamps || "{}");
        ts[currentGameID] = Date.now();
        localStorage.timestamps = JSON.stringify(ts);
        inGame = false;
      }
      const keysToShow = isGameFinished()
        ? Object.keys(localStorage).filter(
            (k) => k.startsWith(currentGameID) && !k.includes("timestamp"),
          )
        : [currentGameID + "-" + getRoundNumber()];
      keysToShow.forEach((k) => {
        const raw = localStorage.getItem(k);
        if (raw) {
          const segs = JSON.parse(raw).map((x) => decodePath(x));
          const totalSegments = segs.reduce((a, b) => a + (b.length - 1), 0);
          const upscaleFactor = Math.max(
            1,
            Math.ceil(50 / (totalSegments || 1)),
          );
          let pointsDone = 0;
          segs.forEach((path) => {
            for (let i = 0; i < path.length - 1; i++) {
              const p1 = path[i];
              const p2 = path[i + 1];
              for (let j = 0; j < upscaleFactor; j++) {
                const subP1 =
                  upscaleFactor === 1
                    ? p1
                    : interpolatePath(p1, p2, j / upscaleFactor);
                const subP2 =
                  upscaleFactor === 1
                    ? p2
                    : interpolatePath(p1, p2, (j + 1) / upscaleFactor);
                const t = pointsDone / (totalSegments * upscaleFactor || 1);
                const color =
                  settings.style === "solid"
                    ? settings.solidColor
                    : t < 0.5
                      ? interpolateHSL(
                          settings.gradStart,
                          settings.gradMiddle,
                          t * 2,
                        )
                      : interpolateHSL(
                          settings.gradMiddle,
                          settings.gradEnd,
                          (t - 0.5) * 2,
                        );
                markers.push(
                  new google.maps.Polyline({
                    path: [subP1, subP2],
                    strokeColor: color,
                    strokeWeight: settings.thickness,
                    geodesic: true,
                    zIndex: Math.floor(t * 100),
                    clickable: false,
                  }),
                );
                pointsDone++;
              }
            }
          });
        }
      });
      markers.forEach((m) => m.setMap(map));
    }
  };
  const setupMVCInterceptor = () => {
    const timer = setInterval(() => {
      const MVCObject = window.google?.maps?.MVCObject;
      if (!MVCObject) return;
      clearInterval(timer);
      if (window.__GPL_HIJACKED) return;
      window.__GPL_HIJACKED = true;
      const originalSet = MVCObject.prototype.set;
      MVCObject.prototype.set = function (key, value) {
        const res = originalSet.apply(this, [key, value]);
        if (this.__GPL_TRACKED) return res;
        if (
          typeof this.setZoom === "function" &&
          typeof this.getBounds === "function"
        ) {
          this.__GPL_TRACKED = true;
          capturedMap = this;
          this.addListener("idle", () => onMapUpdate(this));
          if (this.getBounds()) {
            onMapUpdate(this);
          }
        } else if (
          typeof this.setPano === "function" &&
          typeof this.getPosition === "function"
        ) {
          this.__GPL_TRACKED = true;
          this.addListener("position_changed", () => onMove(this));
          if (this.getPosition()) {
            onMove(this);
          }
        }
        return res;
      };
    }, 10);
  };
  setupMVCInterceptor();
})();
