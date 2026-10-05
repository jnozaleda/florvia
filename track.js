// Anonymous page-visit counter for the landing and the blog: no cookies, no ids. It tells the Worker which page was opened and the
// host the visitor came from (never the full address). Skipped when the browser sends «Do Not Track» / Global Privacy Control.
(() => {
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  if (!/^(www\.)?florvia\.app$/.test(location.hostname)) return;
  let ref = "";
  try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch {}
  fetch("https://api.florvia.app/hit", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ path: location.pathname, ref }), keepalive: true }).catch(() => {});
})();
