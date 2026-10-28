(() => {
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { if (location.hostname !== "simulator.worldcoin.org") return; }
  const role = () => { try { return localStorage.getItem("__wtRole") || "campaigner"; } catch { return "campaigner"; } };
  const call = async (method, params) => {
    const r = await fetch("http://127.0.0.1:3499", { method: "POST", body: JSON.stringify({ role: role(), method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
    return j.result;
  };
  if (location.hostname === "localhost") window.ethereum = { isMetaMask: true, request: ({ method, params }) => call(method, params), on() {}, removeListener() {} };
  window.__wtDraw = () => {
    if (location.hostname !== "localhost") return;
    let raw; try { raw = JSON.parse(sessionStorage.getItem("__wt") || "null"); } catch {}
    let el = document.getElementById("__wt");
    if (!raw) { el?.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "__wt"; document.documentElement.appendChild(el); }
    el.textContent = raw[0];
    el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:${raw[1] === "help" ? "18px" : "6px"} 14px;font:${raw[1] === "help" ? "700 20px" : "600 13px"} system-ui;text-align:center;color:#fff;background:${raw[1] === "help" ? "#c2410c" : "#1d4ed8"};pointer-events:none`;
  };
  setInterval(() => window.__wtDraw(), 800);
})();
