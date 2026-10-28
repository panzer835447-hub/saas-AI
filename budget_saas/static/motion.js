// 本專案設計系統的互動：在 <html data-style="own"> 時作用（index.html 預設開啟）
// 1. 滑動選取塊：分段控制、分頁、側邊導覽的選取塊會以彈性動畫滑到新位置（位置寫進 CSS 變數，由 own.css 繪製）
// 2. 數字滾動：大數字（總覽主數字、指標卡、預警金額、成本驅動）在出現或改變時，從舊值滾動到新值
// 系統設定「減少動態效果」時不做數字滾動（選取塊的動畫也由 own.css 關閉）
(function () {
  var on = function () { return document.documentElement.dataset.style === "own"; };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function thumbs() {
    document.querySelectorAll(".seg, .tabs").forEach(function (g) {
      var b = g.querySelector('[aria-pressed="true"], [aria-selected="true"]');
      g.style.setProperty("--tx", b ? b.offsetLeft + "px" : "0px");
      g.style.setProperty("--tw", b ? b.offsetWidth + "px" : "0px");
    });
    var nav = document.querySelector(".nav"), a = nav && nav.querySelector(".nav-item.active");
    if (nav) { nav.style.setProperty("--nav-y", a ? a.offsetTop + "px" : "0px"); nav.style.setProperty("--nav-h", a ? a.offsetHeight + "px" : "0px"); }
  }

  var SEL = ".kpi-value, .headline .big, .acard-amt, .driver .big";
  var NUM = /[+\-−]?\d[\d,]*(\.\d+)?/;
  var seen = new WeakMap(), busy = new WeakSet();
  function count(el) {
    if (busy.has(el)) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
    while ((node = walker.nextNode()) && !NUM.test(node.nodeValue)) {}
    if (!node) return;
    var text = node.nodeValue, m = text.match(NUM), raw = m[0];
    var target = parseFloat(raw.replace(/,/g, "").replace("−", "-"));
    var prev = seen.get(el);
    seen.set(el, target);
    if (prev === target || reduce || !isFinite(target)) return;
    var from = prev == null ? 0 : prev, dec = m[1] ? m[1].length - 1 : 0, comma = raw.indexOf(",") >= 0, plus = raw[0] === "+", minus = raw[0] === "−" ? "−" : "-";
    var fmt = function (v) {
      var s = Math.abs(v).toFixed(dec);
      if (comma) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (v < 0 ? minus : plus ? "+" : "") + s;
    };
    var t0 = performance.now(), dur = 750, last = text;
    busy.add(el);
    var step = function (t) {
      // 若期間畫面本身更新了這段文字（例如換年度），就停止滾動，交給下一輪重新計算
      if (!el.isConnected || node.nodeValue !== last) { busy.delete(el); return; }
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      last = k < 1 ? text.replace(raw, fmt(from + (target - from) * e)) : text;
      node.nodeValue = last;
      if (k < 1) requestAnimationFrame(step); else busy.delete(el);
    };
    requestAnimationFrame(step);
  }

  var queued = false;
  function run() {
    queued = false;
    if (!on()) return;
    thumbs();
    document.querySelectorAll(SEL).forEach(count);
  }
  // 用計時器而非 requestAnimationFrame 排程：分頁在背景時 rAF 會暫停，選取塊位置就算不出來
  function schedule() { if (!queued) { queued = true; setTimeout(run, 0); } }
  function start() {
    var app = document.getElementById("app");
    if (!app) return;
    new MutationObserver(schedule).observe(app, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-pressed", "aria-selected", "class"] });
    window.addEventListener("resize", schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
