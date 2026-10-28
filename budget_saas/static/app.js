import { html, render, useState, useEffect, useRef, useMemo } from "https://unpkg.com/htm@3.1.1/preact/standalone.module.js";

// ===== 語言：App 每次繪製前設定 LANG，所有文字用 t(中文, English) =====
let LANG = "zh";
// 預警門檻（%）：財務長可在系統設定調整，每次繪製前由 App 更新
const DEFAULT_TH = [105, 102, 90];
let TH = { high: 105, watch: 102, lag: 90 };
const t = (zh, en) => (LANG === "en" ? en : zh);
const DEPT_EN = {
  資訊部: "IT", 行銷部: "Marketing", 核保部: "Underwriting", 理賠部: "Claims", 精算部: "Actuarial",
  財務部: "Finance", 人資行政部: "HR & Admin", 法遵風控部: "Risk & Compliance",
};
const dn = (name) => (LANG === "en" ? DEPT_EN[name] || name : name); // 部門顯示名稱；資料與網址仍用中文名稱當代號
const STATUS_TEXT = { high: ["高風險超支", "High overspend risk"], watch: ["需注意", "Monitor closely"], lag: ["執行落後", "Behind plan"], ok: ["預算正常", "On track"] };
const sl = (key) => t(...STATUS_TEXT[key]);
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mon = (m) => t(`${m}月`, MONTH_EN[m - 1]);
const months = () => Array.from({ length: 12 }, (_, i) => mon(i + 1));
const list = (items) => items.join(t("、", ", "));

// ===== 格式 =====
const trim2 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function fmc(v, signed = false) {
  // 中文：1 億以上用「億」，以下用「萬」；英文：NT$ B / M。與 Streamlit 版相同
  const a = Math.abs(v);
  const body = LANG === "en"
    ? (a >= 1e9 ? `NT$${trim2(a / 1e9)}B` : a >= 1e6 ? `NT$${(a / 1e6).toFixed(1)}M` : `NT$${Math.round(a / 1e3).toLocaleString("en-US")}K`)
    : (a >= 1e8 ? `${trim2(a / 1e8)} 億` : a >= 1e4 ? `${Math.round(a / 1e4).toLocaleString("en-US")} 萬` : `${Math.round(a).toLocaleString("en-US")} 元`);
  const zero = /^(0 |NT\$0K|NT\$0\.0M)/.test(body);
  return (v < 0 && !zero ? "-" : signed && v > 0 && !zero ? "+" : "") + body;
}
// 表格數字：中文為新台幣萬元整數，英文為 NT$ 百萬（一位小數）；單位寫在表頭（UNIT）
const wan = (v, signed = false) => {
  const n = LANG === "en" ? Math.round(v / 1e5) / 10 : Math.round(v / 1e4);
  const s = LANG === "en" ? Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : Math.abs(n).toLocaleString("en-US");
  return (n < 0 ? "-" : signed && n > 0 ? "+" : "") + s;
};
const unit = () => t("新台幣萬元", "NT$ millions");
const pct = (v, signed = false, d = 1) => (signed && v > 0 ? "+" : "") + Number(v).toFixed(d) + "%";
const STATUS_TONE = { high: "high", watch: "watch", lag: "lag", ok: "ok" };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ===== 圖示（線條 SVG，不使用 emoji） =====
const ICONS = {
  logo: html`<polyline points="3 17 9 11 13 15 21 7"></polyline><polyline points="15 7 21 7 21 13"></polyline>`,
  grid: html`<rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect>`,
  bars: html`<line x1="6" y1="20" x2="6" y2="12"></line><line x1="12" y1="20" x2="12" y2="5"></line><line x1="18" y1="20" x2="18" y2="9"></line>`,
  alert: html`<path d="M12 3l9 16H3z"></path><line x1="12" y1="10" x2="12" y2="14"></line><line x1="12" y1="17" x2="12" y2="17.5"></line>`,
  sliders: html`<line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="17" x2="20" y2="17"></line><circle cx="9" cy="7" r="2.2"></circle><circle cx="15" cy="17" r="2.2"></circle>`,
  spark: html`<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"></path><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"></path>`,
  chevron: html`<polyline points="6 9 12 15 18 9"></polyline>`,
  sun: html`<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>`,
  moon: html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path>`,
  close: html`<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>`,
  building: html`<rect x="4" y="3" width="16" height="18" rx="1.5"></rect><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"></path>`,
  check: html`<polyline points="5 12 10 17 19 7"></polyline>`,
  arrow: html`<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline>`,
  send: html`<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="6 11 12 5 18 11"></polyline>`,
  copy: html`<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h8"></path>`,
  trash: html`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path>`,
  shield: html`<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"></path><polyline points="8.5 12 11 14.5 15.5 10"></polyline>`,
  trend: html`<polyline points="3 17 9 11 13 15 21 7"></polyline>`,
  swap: html`<polyline points="17 3 21 7 17 11"></polyline><line x1="21" y1="7" x2="7" y2="7"></line><polyline points="7 21 3 17 7 13"></polyline><line x1="3" y1="17" x2="17" y2="17"></line>`,
  target: html`<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle>`,
  lock: html`<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>`,
  upload: html`<path d="M12 16V4"></path><polyline points="7 9 12 4 17 9"></polyline><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path>`,
  download: html`<path d="M12 4v12"></path><polyline points="7 11 12 16 17 11"></polyline><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path>`,
  file: html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><polyline points="14 3 14 8 19 8"></polyline>`,
  settings: html`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>`,
  info: html`<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16.5"></line><line x1="12" y1="7.5" x2="12" y2="7.6"></line>`,
};
const Icon = ({ name, size = 18, sw = 2 }) => html`<svg aria-hidden="true" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// ===== 網址狀態：頁面、年度、部門、比較基準都放在網址，重新整理或分享連結都會保留 =====
const ROUTES = [
  { path: "/", label: ["總覽", "Overview"], title: ["預算總覽", "Budget overview"], icon: "grid", ready: true },
  { path: "/analysis", label: ["預算分析", "Budget analysis"], icon: "bars", ready: true },
  { path: "/forecast", label: ["預測與預警", "Forecast & alerts"], icon: "alert", badge: true, ready: true },
  { path: "/scenarios", label: ["情境與資料品質", "Scenarios & data quality"], icon: "sliders", ready: true },
  { path: "/assistant", label: ["AI 助理", "AI assistant"], icon: "spark", group: ["智慧工具", "Intelligence"], ready: true },
];
function readUrl() {
  const q = new URLSearchParams(location.search);
  let lang = q.get("lang");
  if (lang !== "en" && lang !== "zh") lang = store.get("lang", localStorage) === "en" ? "en" : "zh";
  return {
    path: ROUTES.some((r) => r.path === location.pathname) ? location.pathname : "/",
    year: Number(q.get("year")) || null,
    depts: q.get("depts") ? q.get("depts").split(",") : [],
    compare: q.get("compare") === "prior" ? "prior" : "budget",
    lang,
  };
}
function writeUrl(s, push) {
  const q = new URLSearchParams();
  if (s.year) q.set("year", s.year);
  if (s.depts.length) q.set("depts", s.depts.join(","));
  if (s.compare !== "budget") q.set("compare", s.compare);
  if (s.lang === "en") q.set("lang", "en"); // 分享英文版連結給評審時保留語言
  const url = s.path + (q.toString() ? "?" + q : "");
  history[push ? "pushState" : "replaceState"](null, "", url);
}

// 瀏覽器儲存：私密視窗或封鎖網站資料時會丟例外，失敗就當作沒有
const store = {
  get: (k, area = sessionStorage) => { try { return area.getItem(k); } catch (e) { return null; } },
  set: (k, v, area = sessionStorage) => { try { v == null ? area.removeItem(k) : area.setItem(k, v); } catch (e) {} },
};

// ===== 檢視身分（展示用；正式導入時由公司 SSO 帶入，使用者不能自己切換） =====
const ROLES = {
  cfo: { label: ["財務長", "CFO"], scope: ["全公司", "Whole company"], short: ["CFO", "CFO"],
    help: ["可檢視全公司資料、匯入資料與所有設定。", "Sees every department, can import data and change settings."] },
  fpa: { label: ["財務分析師", "FP&A analyst"], scope: ["全公司 · 個資遮罩", "Whole company · personal data masked"], short: ["FPA", "FPA"],
    help: ["可檢視全公司數字與匯入資料；經辦人等個資欄位遮罩（個資最小化）。", "Sees all figures and can import data; personal fields such as handler names are masked (data minimisation)."] },
  head: { label: ["部門主管", "Department head"], scope: ["僅本部門", "Own department only"], short: ["主管", "Head"],
    help: ["只看得到本部門的預算、預測與 AI 回答；不能匯入資料。", "Sees only their own department's budget, forecast and AI answers; cannot import data."] },
};
// 部門主管的部門篩選固定為自己的部門
const viewOf = (s) => (s.role === "head" && s.roleDept ? { ...s, depts: [s.roleDept] } : s);
function scopeParams(s, extra = {}) {
  const p = { ...extra, ds: s.ds || "", role: s.role, depts: s.depts.join(","), lang: s.lang || "zh" };
  if (s.th && s.th.join() !== DEFAULT_TH.join()) p.th = s.th.join(",");
  if (s.role === "head") p.dept = s.roleDept;
  return new URLSearchParams(p);
}

// ===== ECharts 包裝 =====
function EChart({ option, cls = "chart", label, height }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    inst.current = echarts.init(ref.current, null, { renderer: "svg" });
    const ro = new ResizeObserver(() => inst.current && inst.current.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); inst.current.dispose(); inst.current = null; };
  }, []);
  useEffect(() => { inst.current && inst.current.setOption(styleChart(option), true); }, [option]);
  return html`<div ref=${ref} class=${cls} style=${height ? { height: height + "px" } : null} role="img" aria-label=${label}></div>`;
}
// 圖表外觀依設計 token 統一套用（平滑曲線、長條圓角、格線樣式、提示框深淺、線寬倍率、動畫時間），
// 各張圖表自己的設定不用逐一修改；換版面風格時只要改 CSS token
function styleChart(o) {
  const num = (k, d) => { const v = parseFloat(css(k)); return Number.isFinite(v) ? v : d; };
  const smooth = num("--chart-smooth", 0), r = num("--chart-bar-r", 4), lw = num("--chart-line-w", 1), glow = num("--chart-glow", 0);
  const grid = css("--chart-grid") || "solid", dark = css("--chart-tooltip") === "dark";
  const fix = (br) => (Array.isArray(br) ? br.map((x) => (x ? r : 0)) : typeof br === "number" && br ? r : br);
  const ax = (a) => (a && a.splitLine && a.splitLine.show !== false
    ? { ...a, splitLine: grid === "none" ? { show: false } : { ...a.splitLine, lineStyle: { ...(a.splitLine.lineStyle || {}), type: grid } } } : a);
  const out = { ...o, animationDuration: num("--chart-anim", 500), animationEasing: "cubicOut" };
  // 圖表聚焦只用在 6 條線以上的圖（例如 8 個部門的趨勢）：累計軌跡圖的今年、預測、預算、往年都是比較基準，不該被淡化；
  // 其他線只淡到 35%，仍看得到走勢可以比較，提示框也照常列出所有數值
  const focus = css("--chart-focus") === "1" && (o.series || []).filter((s) => s.type === "line" && !s.stack).length >= 6;
  out.series = (o.series || []).map((s) => {
    const n = { ...s };
    if (s.type === "line") {
      if (smooth && !s.stack) n.smooth = smooth;
      if (focus && !s.stack) {
        n.emphasis = { focus: "series", blurScope: "coordinateSystem", ...(s.emphasis || {}) };
        n.blur = { lineStyle: { opacity: 0.35 }, itemStyle: { opacity: 0.35 }, label: { opacity: 0.35 } };
      }
      if (s.lineStyle && s.lineStyle.width) n.lineStyle = { ...s.lineStyle, width: s.lineStyle.width * lw };
      // 主線柔光（--chart-glow，深色主題用）：只加在最粗的主線上
      if (glow && s.lineStyle && s.lineStyle.width >= 3 && s.lineStyle.color) n.lineStyle = { ...n.lineStyle, shadowBlur: glow, shadowColor: s.lineStyle.color };
    }
    if (s.type === "bar") {
      if (s.itemStyle && s.itemStyle.borderRadius != null) n.itemStyle = { ...s.itemStyle, borderRadius: fix(s.itemStyle.borderRadius) };
      if (Array.isArray(s.data)) n.data = s.data.map((d) => (d && typeof d === "object" && d.itemStyle && d.itemStyle.borderRadius != null ? { ...d, itemStyle: { ...d.itemStyle, borderRadius: fix(d.itemStyle.borderRadius) } } : d));
    }
    return n;
  });
  out.xAxis = Array.isArray(o.xAxis) ? o.xAxis.map(ax) : ax(o.xAxis);
  out.yAxis = Array.isArray(o.yAxis) ? o.yAxis.map(ax) : ax(o.yAxis);
  if (o.tooltip) out.tooltip = { ...o.tooltip, borderWidth: dark ? 0 : 1, backgroundColor: dark ? css("--text") : css("--surface"),
    textStyle: { ...(o.tooltip.textStyle || {}), color: dark ? css("--surface") : css("--text") }, extraCssText: `border-radius:${css("--r-md")};box-shadow:${css("--shadow-lg")}` };
  return out;
}
const moneyAxis = (v) => (v === 0 ? "0" : LANG === "en"
  ? (Math.abs(v) >= 1e9 ? `${trim2(v / 1e9)}B` : `${trim2(v / 1e6)}M`)
  : (Math.abs(v) >= 1e8 ? `${trim2(v / 1e8)} 億` : `${Math.round(v / 1e4).toLocaleString("en-US")} 萬`));
// 橫向長條圖的金額軸：依資料範圍取約 3 格的整齊間距，避免「3,000 萬6,000 萬9,000 萬」擠在一起
// 回傳 { min, max, interval }，刻度對齊 0；右側多留一格給長條尾端的金額標籤
function moneyScale(values, n = 3) {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  if (hi === lo) return {};
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) * mag;
  let max = Math.ceil(hi / step) * step;
  if (hi > 0 && max - hi < step * 0.3) max += step;
  return { min: Math.floor(lo / step) * step, max, interval: step };
}
// 長條圖的滑鼠指示陰影：ECharts 把它畫在長條上面，所以必須半透明，否則被指到的長條會整條消失
const SHADOW_POINTER = () => ({ type: "shadow", shadowStyle: { color: css("--text"), opacity: 0.07 } });
function baseChart() {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: css("--font"), color: css("--muted") },
    grid: { left: 8, right: 16, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis", backgroundColor: css("--surface"), borderColor: css("--border"), padding: [8, 12],
      textStyle: { color: css("--text"), fontSize: 12 }, axisPointer: { lineStyle: { color: css("--border-strong") } },
    },
    xAxis: { type: "category", data: months(), boundaryGap: false, axisLine: { lineStyle: { color: css("--border") } }, axisTick: { show: false }, axisLabel: { color: css("--muted") } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: css("--divider") } }, axisLabel: { color: css("--muted"), formatter: moneyAxis } },
  };
}
function tooltipRows(params, skip = []) {
  const rows = params.filter((p) => p.value != null && !skip.includes(p.seriesName));
  if (!rows.length) return "";
  return `<b>${params[0].axisValue}</b><br>` + rows.map((p) => `${p.marker}${p.seriesName}　<b>${fmc(p.value)}</b>`).join("<br>");
}

// ===== 外框元件 =====
function Sidebar({ path, go, data, meta, role, openImport, openSettings }) {
  const alerts = data ? data.departments.filter((d) => d.statusKey !== "ok").length : null;
  const info = meta && meta.dataset;
  const locked = role === "head";
  const navRef = useRef(null);
  useEffect(() => {
    // 窄螢幕的選單是橫向捲動列，把目前頁面捲進畫面
    const el = navRef.current && navRef.current.querySelector(".nav-item.active");
    if (el && navRef.current.scrollWidth > navRef.current.clientWidth) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  return html`<nav class="sidebar" ref=${navRef} aria-label=${t("主選單", "Main menu")}>
    <div class="brand">
      <div class="brand-mark"><${Icon} name="logo" sw=${2.4} /></div>
      <div><div class="brand-name">${t("預算決策中心", "Budget Command Center")}</div><div class="brand-sub">Cardif Taiwan · FP&A</div></div>
    </div>
    <div class="nav">
      <div class="nav-label">${t("工作區", "Workspace")}</div>
      ${ROUTES.map((r) => html`
        ${r.group ? html`<div class="nav-label">${t(...r.group)}</div>` : null}
        <a href=${r.path} class=${"nav-item" + (path === r.path ? " active" : "")} aria-current=${path === r.path ? "page" : null}
           onClick=${(e) => { e.preventDefault(); go(r.path); }}>
          <${Icon} name=${r.icon} />${t(...r.label)}
          ${r.badge && alerts ? html`<span class="count num">${alerts}</span>` : !r.ready ? html`<span class="soon">${t("建置中", "Soon")}</span>` : null}
        </a>`)}
    </div>
    ${data ? html`<div class="side-status">
      <div class="row"><span>${t(`FY${data.year} 結算進度`, `FY${data.year} closed`)}</span><b class="num">${data.cutoff} / 12</b></div>
      <div class="meter"><i style=${{ width: (data.cutoff / 12) * 100 + "%" }}></i></div>
      <div class="ds-line">
        <${Icon} name=${info && info.source === "upload" ? "file" : "building"} size=${14} />
        <span title=${info && info.source === "upload" ? info.name : ""}>${info && info.source === "upload" ? info.name : t(`合成示範資料 · 量級 ${fmc((info ? info.scale : 30) * 1e8)}`, `Synthetic demo data · ${fmc((info ? info.scale : 30) * 1e8)}`)}</span>
      </div>
      <button type="button" class="ds-btn" disabled=${locked} onClick=${openImport}
        title=${locked ? t("部門主管身分沒有匯入資料的權限", "Department heads cannot import data") : t("匯入 ERP／財務系統匯出的 CSV", "Import a CSV exported from your ERP or finance system")}>
        <${Icon} name=${locked ? "lock" : "upload"} size=${14} />${t("匯入資料", "Import data")}
      </button>
      <button type="button" class="ds-btn" disabled=${locked} onClick=${openSettings}
        title=${locked ? t("部門主管身分沒有變更系統設定的權限", "Department heads cannot change settings") : t("預警門檻與示範資料量級", "Alert thresholds and demo data scale")}>
        <${Icon} name=${locked ? "lock" : "settings"} size=${14} />${t("系統設定", "Settings")}
      </button>
    </div>` : null}
  </nav>`;
}

function usePopover() {
  // 點外面或按 Esc 關閉
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return [open, setOpen, wrap];
}

// 把內容畫在 <body> 底下：卡片的進場動畫或 hover 會留下 transform，
// 放在卡片裡的 position: fixed 會改以卡片為基準，位置跑掉、還會被相鄰卡片蓋住
function Portal({ children }) {
  const host = useRef(null);
  if (!host.current) host.current = document.createElement("div");
  useEffect(() => {
    document.body.appendChild(host.current);
    return () => { render(null, host.current); host.current.remove(); };
  }, []);
  useEffect(() => { render(children, host.current); });
  return null;
}

// 「怎麼看」說明收在標題旁的 ⓘ：滑鼠移上去或點一下才顯示，平常畫面保持乾淨
function Info({ children, label }) {
  const [open, setOpen, wrap] = usePopover();
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const pop = useRef(null);
  const show = () => {
    // 固定定位並夾在畫面內，窄螢幕或靠右的圖示也不會超出畫面
    const r = wrap.current.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 32);
    setPos({ top: r.bottom + 6, left: Math.max(16, Math.min(r.left - 6, window.innerWidth - 16 - w)), maxWidth: w, anchor: r });
    setOpen(true);
  };
  useEffect(() => {
    // 下方空間不夠時改放到圖示上方；兩邊都不夠就貼齊畫面底部
    const el = pop.current;
    if (!open || !pos || !el) return;
    const h = el.offsetHeight;
    if (pos.top + h <= window.innerHeight - 16) return;
    const above = pos.anchor.top - 6 - h;
    el.style.top = (above >= 16 ? above : Math.max(16, window.innerHeight - 16 - h)) + "px";
  }, [open, pos]);
  useEffect(() => {
    if (!open) { setPinned(false); return; }
    const hide = () => setOpen(false); // 固定定位的說明框不會跟著捲動，捲動時直接收起
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [open]);
  // 說明框不在圖示裡面，滑鼠從圖示移到說明框中間會先離開；稍等一下再收，移進說明框就取消
  const leaving = useRef(null);
  const stay = () => clearTimeout(leaving.current);
  const leave = () => { stay(); if (!pinned) leaving.current = setTimeout(() => setOpen(false), 150); };
  useEffect(() => stay, []);
  return html`<span class="info" ref=${wrap} onMouseEnter=${() => { stay(); if (!open) show(); }} onMouseLeave=${leave}>
    <button type="button" class="info-btn" aria-expanded=${open} aria-label=${label || t("說明", "About this")}
      onClick=${() => { if (open && pinned) setOpen(false); else { show(); setPinned(true); } }}
      onFocus=${show} onBlur=${() => !pinned && setOpen(false)}><${Icon} name="info" size=${16} /></button>
    ${open && pos ? html`<${Portal}><span class="info-pop" role="tooltip" ref=${pop} style=${{ top: pos.top + "px", left: pos.left + "px", maxWidth: pos.maxWidth + "px" }}
      onMouseEnter=${stay} onMouseLeave=${leave} onMouseDown=${(e) => e.stopPropagation()}>${children}</span></${Portal}>` : null}
  </span>`;
}

// 下拉選單：取代瀏覽器原生 <select>（原生清單由作業系統繪製，字型、圓角、配色都不跟網站設計）
// 鍵盤：↑↓ 移動、Home／End、Enter 或空白鍵選取、Esc 關閉；以 listbox／option 角色提供給螢幕閱讀器
function Select({ value, options, onChange, label, prefix, icon, cls = "ctl", numeric }) {
  const [open, setOpen, wrap] = usePopover();
  const [hi, setHi] = useState(0);
  const list = useRef(null);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  useEffect(() => { if (open) setHi(idx); }, [open]);
  useEffect(() => { const el = open && list.current && list.current.children[hi]; if (el) el.scrollIntoView({ block: "nearest" }); }, [open, hi]);
  const pick = (o) => { setOpen(false); if (o.value !== value) onChange(o.value); };
  const key = (e) => {
    if (!open) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); } return; }
    const go = { ArrowDown: Math.min(options.length - 1, hi + 1), ArrowUp: Math.max(0, hi - 1), Home: 0, End: options.length - 1 }[e.key];
    if (go != null) { e.preventDefault(); setHi(go); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(options[hi]); }
    else if (e.key === "Tab") setOpen(false);
  };
  return html`<div class="pop-wrap" ref=${wrap}>
    <button type="button" class=${cls + " select-btn"} aria-haspopup="listbox" aria-expanded=${open} aria-label=${label} onClick=${() => setOpen(!open)} onKeyDown=${key}>
      ${icon ? html`<${Icon} name=${icon} size=${16} />` : null}${prefix ? html`<span class="k">${prefix}</span>` : null}<b class=${numeric ? "num" : ""}>${options[idx] ? options[idx].label : ""}</b><${Icon} name="chevron" size=${14} />
    </button>
    ${open ? html`<ul class="popover menu" role="listbox" aria-label=${label} ref=${list}>
      ${options.map((o, i) => html`<li role="option" aria-selected=${o.value === value} class=${"menu-opt" + (i === hi ? " hi" : "") + (numeric ? " num" : "")}
        onMouseEnter=${() => setHi(i)} onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(o)}>
        <span>${o.label}</span>${o.value === value ? html`<${Icon} name="check" size=${14} />` : null}</li>`)}
    </ul>` : null}
  </div>`;
}

function DeptPicker({ meta, depts, setDepts }) {
  const [open, setOpen, wrap] = usePopover();
  const all = meta.departments.map((d) => d.name);
  const picked = depts.length ? depts : all;
  const label = picked.length === all.length ? t(`全部 ${all.length} 個`, `All ${all.length}`) : picked.length === 1 ? dn(picked[0]) : t(`${picked.length} 個部門`, `${picked.length} departments`);
  const toggle = (name) => {
    const next = picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name];
    setDepts(next.length === all.length || !next.length ? [] : all.filter((n) => next.includes(n)));
  };
  return html`<div class="pop-wrap" ref=${wrap}>
    <button type="button" class="ctl" aria-expanded=${open} aria-haspopup="true" onClick=${() => setOpen(!open)}>
      <${Icon} name="building" size=${16} /><span class="k">${t("部門", "Departments")}</span><b>${label}</b><${Icon} name="chevron" size=${14} />
    </button>
    ${open ? html`<div class="popover" role="dialog" aria-label=${t("選擇部門", "Choose departments")}>
      <div class="head"><span>${t("選擇要分析的部門", "Departments to analyse")}</span><button type="button" onClick=${() => setDepts([])}>${t("全選", "Select all")}</button></div>
      ${meta.departments.map((d) => html`<label class="check">
        <input type="checkbox" checked=${picked.includes(d.name)} onChange=${() => toggle(d.name)} />
        <span class="dot" style=${{ background: d.color }}></span>${dn(d.name)}
      </label>`)}
    </div>` : null}
  </div>`;
}

function RoleMenu({ meta, state, setRole }) {
  const [open, setOpen, wrap] = usePopover();
  const r = ROLES[state.role];
  return html`<div class="pop-wrap" ref=${wrap}>
    <button type="button" class=${"avatar" + (state.role === "head" ? " head" : "")} aria-expanded=${open} aria-haspopup="true"
      aria-label=${t(`目前身分：${r.label[0]}${state.role === "head" ? "（" + state.roleDept + "）" : ""}，點選切換`,
        `Viewing as ${r.label[1]}${state.role === "head" ? " (" + dn(state.roleDept) + ")" : ""}; click to switch`)} onClick=${() => setOpen(!open)}>${t(...r.short)}</button>
    ${open ? html`<div class="popover role-menu" role="dialog" aria-label=${t("切換檢視身分", "Switch viewing role")}>
      <div class="head"><span>${t("檢視身分（展示用）", "Viewing as (demo)")}</span></div>
      ${Object.entries(ROLES).map(([k, v]) => html`<label class=${"role-opt" + (state.role === k ? " on" : "")}>
        <input type="radio" name="role" checked=${state.role === k} onChange=${() => setRole(k, state.roleDept)} />
        <span><b>${t(...v.label)}</b><small>${t(...v.scope)}</small><em>${t(...v.help)}</em></span>
      </label>`)}
      ${state.role === "head" ? html`<div class="role-dept"><span>${t("所屬部門", "Department")}</span>
        <${Select} label=${t("所屬部門", "Department")} value=${state.roleDept} onChange=${(v) => setRole("head", v)}
          options=${meta.departments.map((d) => ({ value: d.name, label: dn(d.name) }))} /></div>` : null}
      <p class="role-note"><${Icon} name="shield" size=${14} />${t("正式導入時由公司 SSO 帳號自動帶入，使用者不能自行切換。", "In production this comes from company SSO and users cannot switch it.")}</p>
    </div>` : null}
  </div>`;
}

// 摘要報告：先抓回 PDF 再存檔，才能用伺服器給的檔名，並在產生中／失敗時給回饋（瀏覽器下載列只會顯示「網路錯誤」）
// 把伺服器回傳的檔案存到使用者電腦，檔名取自 Content-Disposition（中文檔名用 filename*）
async function saveResponse(r, fallback) {
  if (!r.ok) throw new Error();
  const m = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get("content-disposition") || "");
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: m ? decodeURIComponent(m[1]) : fallback });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReportButton({ state, year }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const download = async () => {
    setBusy(true);
    setErr(false);
    try {
      await saveResponse(await fetch("/api/report.pdf?" + scopeParams(viewOf(state), { year })), `FY${year}.pdf`);
    } catch (e) {
      setErr(true);
      setTimeout(() => setErr(false), 4000);
    }
    setBusy(false);
  };
  return html`<button type="button" class=${"ghost-btn report-btn" + (err ? " err" : "")} disabled=${busy} onClick=${download} aria-live="polite"
    title=${t("下載目前年度與部門範圍的預算摘要報告（PDF）", "Download the budget summary for the current year and departments (PDF)")}>
    <${Icon} name=${err ? "alert" : "download"} size=${16} /><span class="lbl">${busy ? t("產生中…", "Preparing…") : err ? t("下載失敗，請再試一次", "Download failed, try again") : t("摘要報告", "Summary PDF")}</span>
  </button>`;
}

function Topbar({ meta, state, set, setRole, setLang, theme, setTheme, go, openImport, openSettings }) {
  const route = ROUTES.find((r) => r.path === state.path);
  const head = state.role === "head";
  const upload = meta.dataset.source === "upload";
  return html`<header class="topbar">
    <div class="topbar-title">
      <div class="crumb">${t("管理會計", "Management accounting")} / ${t(...route.label)}</div>
      <h1 class="page-title">${t(...(route.title || route.label))}</h1>
    </div>
    <div class="filters">
      <${Select} label=${t("會計年度", "Fiscal year")} prefix=${t("會計年度", "Fiscal year")} numeric value=${state.year}
        options=${meta.years.map((y) => ({ value: y, label: `FY${y}` }))} onChange=${(year) => set({ year })} />
      ${head ? html`<span class="ctl locked" title=${t("部門主管只能查看本部門", "Department heads can only view their own department")}>
          <${Icon} name="lock" size=${14} /><span class="k">${t("部門", "Department")}</span><b>${dn(state.roleDept)}</b></span>`
        : html`<${DeptPicker} meta=${meta} depts=${state.depts} setDepts=${(depts) => set({ depts })} />`}
      <div class="seg" role="group" aria-label=${t("比較基準", "Compare with")}>
        <button type="button" aria-pressed=${state.compare === "budget"} onClick=${() => set({ compare: "budget" })}>${t("vs 預算", "vs budget")}</button>
        <button type="button" aria-pressed=${state.compare === "prior"} onClick=${() => set({ compare: "prior" })}>${t("vs 去年同期", "vs last year")}</button>
      </div>
      <span class="stamp">${t("資料截至", "Data through")} ${meta.cutoff.year}/${String(meta.cutoff.month).padStart(2, "0")}</span>
      ${upload ? html`<span class="chip-up" title=${meta.dataset.name}><${Icon} name="file" size=${12} />${t("上傳資料", "Uploaded data")}</span>` : null}
      ${head ? html`<span class="chip-role"><${Icon} name="lock" size=${12} />${t(`${state.roleDept}主管檢視`, `${dn(state.roleDept)} head view`)}</span>` : null}
      ${state.th.join() !== DEFAULT_TH.join() ? html`<button type="button" class="chip-up chip-btn" disabled=${head} onClick=${openSettings}
          title=${t("預警門檻已依系統設定調整，點選查看", "Alert thresholds were customised; click to review")}>
          <${Icon} name="settings" size=${12} />${t("自訂門檻", "Custom thresholds")} <span class="num">${state.th[0]}/${state.th[1]}/${state.th[2]}%</span></button>` : null}
    </div>
    <div class="actions">
      <button type="button" class="icon-btn only-narrow" disabled=${head} onClick=${openImport}
        aria-label=${head ? t("匯入資料（部門主管無權限）", "Import data (department heads have no access)") : t("匯入資料", "Import data")}
        title=${head ? t("部門主管身分沒有匯入資料的權限", "Department heads cannot import data") : t("匯入資料", "Import data")}>
        <${Icon} name=${head ? "lock" : "upload"} size=${16} />
      </button>
      <button type="button" class="icon-btn only-narrow" disabled=${head} onClick=${openSettings}
        aria-label=${head ? t("系統設定（部門主管無權限）", "Settings (department heads have no access)") : t("系統設定", "Settings")}
        title=${head ? t("部門主管身分沒有變更系統設定的權限", "Department heads cannot change settings") : t("系統設定", "Settings")}>
        <${Icon} name=${head ? "lock" : "settings"} size=${16} />
      </button>
      <div class="seg lang" role="group" aria-label=${t("介面語言", "Interface language")}>
        <button type="button" lang="zh-Hant" aria-pressed=${state.lang !== "en"} onClick=${() => setLang("zh")}>中</button>
        <button type="button" lang="en" aria-pressed=${state.lang === "en"} onClick=${() => setLang("en")}>EN</button>
      </div>
      <button type="button" class="icon-btn" aria-label=${theme === "dark" ? t("切換為淺色主題", "Switch to light theme") : t("切換為深色主題", "Switch to dark theme")} onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}>
        <${Icon} name=${theme === "dark" ? "sun" : "moon"} size=${16} />
      </button>
      <${ReportButton} state=${state} year=${state.year || meta.cutoff.year} />
      <button type="button" class="btn-primary ask-btn" aria-label=${t("問 AI", "Ask AI")} onClick=${() => go("/assistant")}><${Icon} name="spark" size=${16} /><span class="lbl">${t("問 AI", "Ask AI")}</span></button>
      <${RoleMenu} meta=${meta} state=${state} setRole=${setRole} />
    </div>
  </header>`;
}

// ===== 總覽頁 =====
function AlertBanner({ data, openDept }) {
  const a = data.alert;
  const closed = data.cutoff >= 12;
  if (!a.count) {
    return html`<section class="alert ok" aria-label=${t("系統預警", "System alert")}><div class="lead"><${Icon} name="check" size=${20} /><b>${closed ? t("這一年沒有部門超支超過 5%", "No department overspent by more than 5% this year") : t("目前沒有部門預估高風險超支", "No department is projected at high overspend risk")}</b></div></section>`;
  }
  const n = a.count, s = n > 1 ? "s" : "";
  return html`<section class="alert" aria-label=${t("系統預警", "System alert")}>
    <div class="lead"><${Icon} name="alert" size=${20} sw=${2.2} /><span>${closed
      ? t(html`<b>${n} 個部門全年超支超過 5%</b>，合計 <b class="num">${fmc(a.total)}</b>`, html`<b>${n} department${s} overspent by more than 5%</b>, <b class="num">${fmc(a.total)}</b> in total`)
      : t(html`<b>${n} 個部門預估年底高風險超支</b>，合計 <b class="num">${fmc(a.total)}</b>`, html`<b>${n} department${s} at high risk of overspending</b>, <b class="num">${fmc(a.total)}</b> in total`)}</span></div>
    <div class="chips">${a.items.map((i) => html`<button type="button" class="chip" onClick=${() => openDept(i.id)}>${dn(i.name)} <b class="num">${fmc(i.variance, true)}</b></button>`)}</div>
    <button type="button" class="go" onClick=${() => openDept(a.items[0].id)}>${t("查看原因 →", "See why →")}</button>
  </section>`;
}

// 只看一個部門時（部門主管或只選一個部門），建議問題改成問這個部門，不再問「哪些部門」或別的部門
const soleDept = (data) => (data.departments.length === 1 ? data.departments[0].name : null);
const QUICK_PROMPTS = (data) => {
  const one = soleDept(data);
  return one ? [
    t(`${one}年底會超支嗎？原因是什麼？`, `Will ${dn(one)} overspend by year end, and why?`),
    t(`${one}今年的花費和去年比差在哪？`, `How does ${dn(one)}'s spending this year compare with last year?`),
    t(`若${one}年底要省下 5% 支出，該從哪裡調整？`, `If ${dn(one)} needs to cut 5% of spending by year end, where should it adjust?`),
  ] : [
    t("超支風險最高的部門是哪些？原因是什麼？", "Which departments are most at risk of overspending, and why?"),
    t("資訊部今年的花費和去年比差在哪？", "How does IT's spending this year compare with last year?"),
    t("若年底要省下 5% 總支出，該從哪裡調整？", "If we need to cut total spending by 5% by year end, where should we adjust?"),
  ];
};

function Hero({ data, go }) {
  const tt = data.totals, p = data.prior;
  const over = tt.variance > 0;
  const closed = data.cutoff >= 12; // 已結算完整年度：顯示全年實際，不再有預測區間
  return html`<section class="hero">
    <div class="hero-main">
      <div class="eyebrow">${closed ? t(`FY${data.year} 全年實際支出`, `FY${data.year} full-year actual spending`) : t(`FY${data.year} 年底預估支出`, `FY${data.year} projected year-end spending`)}</div>
      <div class="headline">
        <span class="big num">${fmc(tt.forecast)}</span>
        <span class=${"pill num " + (over ? "high" : "ok")}>${fmc(tt.variance, true)} · ${pct(tt.variancePct, true)}</span>
      </div>
      <div class="hero-sub">${t("年度預算", "Annual budget")} <b class="num">${fmc(tt.budget)}</b>${p.budgetYoy != null ? html` ${t("（較 ", "(")}FY${p.year} <span class="num">${pct(p.budgetYoy, true)}</span>${t("）", ")")}` : null}${closed ? html` · ${t("12 個月皆已結算", "all 12 months closed")}` : html` · ${t("P80 合理區間", "P80 likely range")} <span class="num">${pct(tt.lowPct)}–${pct(tt.highPct)}</span>`}</div>
      <div class="tags">${data.statusCounts.map((s) => html`<span class="tally"><i class=${"bg-" + s.key}></i>${sl(s.key)} <b class="num">${s.count}</b></span>`)}</div>
    </div>
    <div class="card ai-card">
      <div class="ai-head"><${Icon} name="spark" size=${16} />${t("AI 摘要", "AI summary")}<${Info}><p>${t("摘要裡的金額與百分比都由系統直接計算，AI 只負責把結果寫成文字。", "Every amount and percentage here is calculated by the system; AI only puts the results into words.")}</p></${Info}></div>
      <ul>${data.summary.map((s) => html`<li>${s}</li>`)}</ul>
      <div class="prompts">${QUICK_PROMPTS(data).map((q) => html`<button type="button" class="prompt" onClick=${() => go("/assistant", q)}>${q}</button>`)}</div>
    </div>
  </section>`;
}

function Kpis({ data, compare }) {
  const tt = data.totals, p = data.prior;
  const gap = tt.spentPct - tt.planPct;
  const kpi = (label, value, sub) => html`<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-sub">${sub}</div></div>`;
  const tone = (v, badWhenUp = true) => (Math.abs(v) < 0.05 ? "neutral" : (v > 0) === badWhenUp ? "up-bad" : "up-good");
  return html`<section class="card kpis" aria-label=${t("關鍵指標", "Key figures")}>
    ${kpi(t("年度總預算", "Annual budget"), fmc(tt.budget),
      p.budgetYoy != null ? html`<span class="num neutral">${p.budgetYoy >= 0 ? "▲" : "▼"} ${pct(Math.abs(p.budgetYoy))}</span> vs FY${p.year}` : t("選取部門合計", "Selected departments"))}
    ${compare === "prior" && p.actualYtd
      ? kpi(t(`已花費（1–${data.cutoff} 月）`, `Spent (${mon(1)}–${mon(data.cutoff)})`), fmc(tt.actualYtd),
          html`<span class=${"num " + tone(p.ytdYoy)}>${pct(p.ytdYoy, true)}</span> ${t("vs 去年同期", "vs same period last year")} ${fmc(p.actualYtd)}`)
      : kpi(t("已執行進度", "Spent so far"), pct(tt.spentPct),
          html`${t("計畫", "Plan")} <span class="num">${pct(tt.planPct)}</span> · <span class=${"num " + tone(gap)}>${gap >= 0 ? "+" : ""}${gap.toFixed(1)} ${t("個百分點", "pp")}</span>`)}
    ${kpi(t("年底預算使用率", "Year-end budget use"), html`<span class=${{ high: "c-high", watch: "c-watch", lag: "c-lag", ok: "" }[STATUS_BY_USE(tt.usePct)]}>${pct(tt.usePct)}</span>`,
      data.cutoff >= 12 ? t("全年實際數", "Full-year actual") : html`${t("P80 區間", "P80 range")} <span class="num">${pct(tt.lowPct)}–${pct(tt.highPct)}</span>`)}
    ${compare === "prior" && p.fullActual
      ? kpi(t("年底預估 vs 去年全年", "Year-end vs last full year"), pct((tt.forecast / p.fullActual - 1) * 100, true), html`${t(`FY${p.year} 全年實際`, `FY${p.year} actual`)} <span class="num">${fmc(p.fullActual)}</span>`)
      : kpi(data.cutoff >= 12 ? t("超支部門", "Departments over budget") : t("預估超支部門", "Departments over budget"), html`${tt.overCount} <small>/ ${data.departmentCount}</small>`, html`${t("年底差異", "Year-end gap")} <span class=${"num " + tone(tt.variance)}>${fmc(tt.variance, true)}</span>`)}
  </section>`;
}

function trajectoryOption(data, compare, theme) {
  const s = data.series, accent = css("--accent"), cutoff = data.cutoff;
  const priorYears = data.history.slice(-2);
  // 歷年線用兩階灰：都要和卡片底色有 3:1 以上對比，較近的年份較亮（邊線色太淡，深色模式幾乎看不見）
  const greys = [css("--muted"), css("--text-2")];
  const over = data.totals.variance > 0;
  const o = baseChart();
  const lowName = t("區間下緣", "Range low"), bandName = t("P80 區間", "P80 range");
  const m = months();
  o.tooltip.formatter = (ps) => tooltipRows(ps, [lowName, bandName]);
  o.series = [
    { name: lowName, type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, data: m.map((_, i) => { const b = s.band.find((x) => x.m === i + 1); return b ? b.low : null; }) },
    { name: bandName, type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: accent, opacity: theme === "dark" ? 0.18 : 0.12 }, data: m.map((_, i) => { const b = s.band.find((x) => x.m === i + 1); return b ? b.high - b.low : null; }) },
    ...priorYears.map((h, i) => ({
      name: t(`FY${h.year} 實際`, `FY${h.year} actual`), type: "line", symbol: "none", data: h.cum, z: 1,
      lineStyle: { width: compare === "prior" && i === priorYears.length - 1 ? 3 : 1.5, color: greys[i] },
      itemStyle: { color: greys[i] },
    })),
    { name: t("累計預算", "Cumulative budget"), type: "line", symbol: "none", data: s.budgetCum, lineStyle: { type: [2, 4], width: 1.5, color: css("--text") }, itemStyle: { color: css("--text") } },
    {
      name: t("預測", "Forecast"), type: "line", symbol: "none", data: s.forecastCum, lineStyle: { type: [6, 5], width: 3, color: accent }, itemStyle: { color: accent },
      markPoint: {
        symbol: "circle", symbolSize: 8, itemStyle: { color: over ? css("--high") : css("--ok") },
        label: { show: true, position: "left", distance: 8, formatter: () => cutoff >= 12 ? t(`全年 ${fmc(data.totals.forecast)}`, `Full year ${fmc(data.totals.forecast)}`) : t(`預估 ${fmc(data.totals.forecast)}`, `Forecast ${fmc(data.totals.forecast)}`), color: over ? css("--high-ink") : css("--ok-ink"), fontWeight: 600, fontSize: 12 },
        data: [{ coord: [11, s.forecastCum[11]] }],
      },
    },
    {
      name: t(`FY${data.year} 實際`, `FY${data.year} actual`), type: "line", data: s.actualCum, showSymbol: false, symbolSize: 8, lineStyle: { width: 3, color: accent }, itemStyle: { color: accent },
      markPoint: { symbol: "circle", symbolSize: 8, itemStyle: { color: css("--surface"), borderColor: accent, borderWidth: 2.5 }, label: { show: false }, data: [{ coord: [cutoff - 1, s.actualCum[cutoff - 1]] }] },
      // 底色維持單一；實際與預測的分界用一條垂直虛線標示，不再用色塊或漸層（兩種底色會像畫面出錯）
      ...(cutoff < 12 ? { markLine: { silent: true, symbol: "none", lineStyle: { color: css("--series-muted"), type: [4, 4], width: 1 },
        label: { show: true, position: "end", rotate: 0, formatter: t("預測 →", "Forecast →"), color: css("--muted"), fontSize: 11 }, data: [{ xAxis: m[cutoff - 1] }] } } : {}),
    },
  ];
  return o;
}

function Trajectory({ data, compare, theme }) {
  const option = useMemo(() => trajectoryOption(data, compare, theme), [data, compare, theme, LANG]);
  const prev = data.history[data.history.length - 1];
  const y = data.prior.ytdYoy;
  return html`<div class="card card-pad" style="min-width:0">
    <div class="card-head">
      <h2 class="card-title">${t("累計支出軌跡：今年 vs 預算 vs 歷年", "Cumulative spending: this year vs budget vs past years")}</h2>
      <${Info}><p>${t("彩色實線（今年實際）高於點線（預算），代表花得比預算快；彩色虛線是剩餘月份的預測，淡色帶是 P80 合理區間；垂直虛線右側是尚未發生的月份。灰線是前兩年，越亮越近。", "The coloured solid line (this year) above the dotted budget line means spending is ahead of budget. The coloured dashed line is the forecast for the remaining months, the light band is the P80 likely range, and everything right of the vertical dashed line is months that have not happened yet. Grey lines are the two previous years; the brighter one is more recent.")}</p></${Info}>
      <span class="card-sub">${data.cutoff >= 12 ? t("全年已結算", "Full year closed") : t(`${data.cutoff} 月後為預測`, `Forecast after ${mon(data.cutoff)}`)}${prev && y != null ? t(
        html` · 1–${data.cutoff} 月比 FY${prev.year} 同期${y >= 0 ? "多" : "少"}花 <b class="num">${pct(Math.abs(y))}</b>`,
        html` · ${mon(1)}–${mon(data.cutoff)} <b class="num">${pct(Math.abs(y))}</b> ${y >= 0 ? "above" : "below"} FY${prev.year}`) : null}</span>
      <div class="legend right">
        <span><i class="sw" style=${{ borderColor: "var(--accent)" }}></i>${t(`FY${data.year} 實際`, `FY${data.year} actual`)}</span>
        <span><i class="sw" style=${{ borderColor: "var(--accent)", borderTopStyle: "dashed" }}></i>${t("預測", "Forecast")}</span>
        <span><i class="sw" style=${{ borderColor: "var(--text)", borderTopStyle: "dotted", borderTopWidth: "2px" }}></i>${t("預算", "Budget")}</span>
        ${data.history.slice(-2).map((h, i) => html`<span><i class="sw" style=${{ borderColor: i ? "var(--text-2)" : "var(--muted)", borderTopWidth: "2px" }}></i>FY${h.year}</span>`)}
      </div>
    </div>
    <${EChart} option=${option} label=${t(`累計支出軌跡，年底預估 ${fmc(data.totals.forecast)}，預算 ${fmc(data.totals.budget)}`, `Cumulative spending; year-end forecast ${fmc(data.totals.forecast)}, budget ${fmc(data.totals.budget)}`)} />
  </div>`;
}

function Priority({ data, openDept, go }) {
  const items = data.departments.filter((d) => d.statusKey !== "ok").sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 5);
  const slack = data.departments.filter((d) => d.statusKey === "lag").reduce((s, d) => s - d.variance, 0);
  return html`<div class="card card-pad prio">
    <div class="card-head"><h2 class="card-title">${t("優先處理", "Priority review")}</h2><span class="card-sub">${t("依年底差異大小排序", "Largest year-end gaps first")}</span></div>
    ${items.length ? items.map((d) => html`<button type="button" class="prio-item" onClick=${() => openDept(d.id)}>
      <span class=${"prio-bar bg-" + d.statusKey}></span>
      <span style="flex:1;min-width:0"><div class="prio-name">${dn(d.name)}</div><div class="prio-why">${d.reason || sl(d.statusKey)}</div></span>
      <span class=${"prio-amt num c-" + d.statusKey}>${fmc(d.variance, true)}<small>${pct(d.usePct)}</small></span>
    </button>`) : html`<div class="empty in-card">${t("所有部門都在正常範圍內", "Every department is within range")}</div>`}
    ${slack > 0 ? html`<button type="button" class="prio-cta spaced" onClick=${() => go("/assistant", t("建議如何把執行落後部門的結餘調撥給超支部門？", "How should we move unused budget from departments behind plan to those overspending?"))}>${t("評估調撥：可用結餘", "Explore reallocation: unused")} ${fmc(slack)}</button>` : null}
  </div>`;
}

const SORTS = {
  status: (a, b) => ["high", "watch", "lag", "ok"].indexOf(a.statusKey) - ["high", "watch", "lag", "ok"].indexOf(b.statusKey) || Math.abs(b.variance) - Math.abs(a.variance),
  use: (a, b) => b.usePct - a.usePct,
  variance: (a, b) => b.variance - a.variance,
};
function DeptTable({ data, compare, openDept }) {
  const [sort, setSort] = useState("status");
  const rows = [...data.departments].sort(SORTS[sort]);
  const scale = (v) => Math.min(100, (v / 125) * 100); // 進度條刻度 0–125%，100% 在 80% 位置
  const th = (key, label, cls = "") => html`<th class=${"sortable " + cls} aria-sort=${sort === key ? "descending" : null} onClick=${() => setSort(key)}>${label}${sort === key ? " ↓" : ""}</th>`;
  return html`<section class="card clip">
    <div class="card-pad table-head"><div class="card-head">
      <h2 class="card-title">${t("部門執行明細", "Department detail")}</h2><span class="card-sub">${t("金額單位：新台幣萬元 · 點任一列查看部門細節", "Amounts in NT$ millions · click a row for details")}</span>
      <div class="legend right">
        <span><i class="sw-block"></i>${t("已花", "Spent")}</span>
        <span><i class="sw-block est"></i>${t("預計再花", "Still to spend")}</span>
        <span><i class="sw-mark"></i>${t("預算 100%", "Budget 100%")}</span>
      </div>
    </div></div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${t("部門", "Department")}</th>${th("status", t("狀態", "Status"))}<th>${t("執行進度 → 年底", "Progress → year end")}</th>${th("use", t("年底使用率", "Year-end use"), "r")}${th("variance", t("預測差異", "Forecast gap"), "r")}
        <th class="r">${compare === "prior" ? t("較去年同期", "vs last year") : t("同期執行率", "Spend vs plan")}</th><th class="grow">${t("主要原因", "Main driver")}</th>
      </tr></thead>
      <tbody>${rows.map((d) => {
        const yoy = d.prevYtd ? (d.actualYtd / d.prevYtd - 1) * 100 : null;
        return html`<tr tabindex="0" onClick=${() => openDept(d.id)} onKeyDown=${(e) => { if (e.key === "Enter") openDept(d.id); }}>
          <td><span class="dept-cell">${dn(d.name)}</span></td>
          <td><span class=${"tag " + d.statusKey}>${sl(d.statusKey)}</span></td>
          <td><div class="bar" title=${t(`已花 ${pct(d.spentPct)} ＋ 預計再花 ${pct(d.usePct - d.spentPct)} ＝ ${pct(d.usePct)}`, `Spent ${pct(d.spentPct)} + still to spend ${pct(d.usePct - d.spentPct)} = ${pct(d.usePct)}`)}>
            <span class="spent" style=${{ width: scale(d.spentPct) + "%" }}></span>
            <span class=${"est est-" + d.statusKey} style=${{ width: Math.max(0, scale(d.usePct) - scale(d.spentPct)) + "%" }}></span>
            <span class="mark"></span></div></td>
          <td class="r num fw-strong">${pct(d.usePct)}</td>
          <td class=${"r num c-" + d.statusKey}>${wan(d.variance, true)}</td>
          <td class="r num">${compare === "prior" ? (yoy == null ? "—" : pct(yoy, true)) : pct(d.execRate)}</td>
          <td class="why grow" title=${d.reason}>${d.reason || html`<span class="text-muted">—</span>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
  </section>`;
}

function deptMonthlyOption(d) {
  const o = baseChart();
  o.xAxis.boundaryGap = true;
  o.tooltip.formatter = (ps) => tooltipRows(ps);
  o.legend = { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.grid.top = 32;
  o.series = [
    { name: t("實際", "Actual"), type: "bar", stack: "s", barMaxWidth: 16, data: d.monthly.actual, itemStyle: { color: css("--accent"), borderRadius: [4, 4, 0, 0] } },
    { name: t("預估", "Estimate"), type: "bar", stack: "s", barMaxWidth: 16, data: d.monthly.estimate, itemStyle: { color: css("--est"), borderRadius: [4, 4, 0, 0] } },
    { name: t("預算", "Budget"), type: "line", step: "middle", symbol: "none", data: d.monthly.budget, lineStyle: { color: css("--text"), width: 1.5, type: [3, 3] }, itemStyle: { color: css("--text") } },
  ];
  return o;
}
function deptHistoryOption(d, year) {
  const o = baseChart();
  const tone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" };
  o.xAxis = { ...o.xAxis, boundaryGap: true, axisLabel: { ...o.xAxis.axisLabel, interval: 0 }, data: [...d.history.map((h) => `FY${h.year}`), t(`FY${year} 預估`, `FY${year} fcst`)] };
  // 下限 60%，上傳資料若有更低的使用率就往下延伸，避免長條被切掉
  o.yAxis = { ...o.yAxis, min: (v) => Math.min(60, Math.floor(v.min / 10) * 10), axisLabel: { color: css("--muted"), formatter: "{value}%" } };
  o.tooltip = { ...o.tooltip, formatter: (ps) => `<b>${ps[0].axisValue}</b><br>${t("預算使用率", "Budget use")}　<b>${pct(ps[0].value)}</b>` };
  o.series = [{
    type: "bar", barMaxWidth: 24,
    data: [...d.history.map((h) => ({ value: h.use, itemStyle: { color: css("--series-muted") } })), { value: d.usePct, itemStyle: { color: css(tone[d.statusKey]) } }],
    itemStyle: { borderRadius: [4, 4, 0, 0] },
    label: { show: true, position: "top", formatter: (p) => pct(p.value), color: css("--text-2"), fontSize: 11 },
    markLine: { silent: true, symbol: "none", lineStyle: { color: css("--text"), type: [3, 3] }, label: { show: false }, data: [{ yAxis: 100 }] },
  }];
  return o;
}

function Drawer({ dept, data, theme, close, go }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current && closeRef.current.focus();
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const monthly = useMemo(() => deptMonthlyOption(dept), [dept, theme]);
  const hist = useMemo(() => deptHistoryOption(dept, data.year), [dept, theme]);
  return html`<div class="scrim" onClick=${close}></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div class="drawer-head">
      <div style="flex:1">
        <h2 id="drawer-title" class="drawer-title">${dn(dept.name)}</h2>
        <div class="drawer-meta"><span class=${"tag " + dept.statusKey}>${sl(dept.statusKey)}</span>${dept.reason ? html`<span class="card-sub">${dept.reason}</span>` : null}</div>
      </div>
      <button type="button" class="icon-btn" aria-label=${t("關閉", "Close")} ref=${closeRef} onClick=${close}><${Icon} name="close" size=${16} /></button>
    </div>
    <div class="drawer-body">
      <div class="stats">
        <div class="stat"><div class="card-sub">${t("年度預算", "Annual budget")}</div><div class="v num">${fmc(dept.budget)}</div></div>
        <div class="stat"><div class="card-sub">${t("年底預估", "Year-end forecast")}</div><div class="v num">${fmc(dept.forecast)}</div></div>
        <div class="stat"><div class="card-sub">${t("預估差異", "Forecast gap")}</div><div class=${"v num c-" + dept.statusKey}>${fmc(dept.variance, true)}</div></div>
      </div>
      <div>
        <div class="section-title">${t("為什麼亮燈", "Why it is flagged")}</div>
        <ul class="evidence">${dept.evidence.map((e) => html`<li>${e}</li>`)}</ul>
      </div>
      <div>
        <div class="section-title">${t("每月支出：實際、預估與預算", "Monthly spending: actual, estimate and budget")}</div>
        <${EChart} option=${monthly} cls="chart-sm" label=${t(`${dept.name}每月支出`, `${dn(dept.name)} monthly spending`)} />
      </div>
      <div>
        <div class="section-title">${t("歷年預算使用率", "Budget use by year")}<${Info}><p>${t("灰色為過去完整年度的實際使用率；彩色為今年的年底預估。", "Grey = actual use in past complete years; coloured = this year's year-end forecast.")}</p></${Info}></div>
        <${EChart} option=${hist} cls="chart-sm" label=${t(`${dept.name}歷年預算使用率`, `${dn(dept.name)} budget use by year`)} />
      </div>
      <button type="button" class="btn-primary btn-block" onClick=${() => go("/assistant", t(`分析${dept.name}今年的預算執行狀況，和往年相比有什麼差異？建議怎麼處理？`, `Analyse ${dn(dept.name)}'s budget this year: how does it differ from past years, and what should we do?`))}>
        <${Icon} name="spark" size=${16} />${t(`請 AI 分析${dept.name}`, `Ask AI about ${dn(dept.name)}`)}
      </button>
    </div>
  </aside>`;
}

function Overview({ data, compare, theme, go }) {
  const [openId, setOpenId] = useState(null);
  const dept = openId && data.departments.find((d) => d.id === openId);
  return html`<div class="content">
    <${AlertBanner} data=${data} openDept=${setOpenId} />
    <${Hero} data=${data} go=${go} />
    <${Kpis} data=${data} compare=${compare} />
    <section class="bento">
      <${Trajectory} data=${data} compare=${compare} theme=${theme} />
      <${Priority} data=${data} openDept=${setOpenId} go=${go} />
    </section>
    <${DeptTable} data=${data} compare=${compare} openDept=${setOpenId} />
    ${dept ? html`<${Drawer} dept=${dept} data=${data} theme=${theme} close=${() => setOpenId(null)} go=${go} />` : null}
  </div>`;
}

function Skeleton() {
  return html`<div class="content" aria-busy="true" aria-label=${t("載入中", "Loading")}>
    <div class="skeleton" style="height:48px"></div>
    <div class="hero"><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div></div>
    <div class="skeleton" style="height:110px"></div>
    <div class="bento"><div class="skeleton" style="height:380px"></div><div class="skeleton" style="height:380px"></div></div>
  </div>`;
}

function ComingSoon({ route, go }) {
  return html`<div class="content"><div class="card empty">
    <h2>${t(`${route.label[0]}正在搬移到新版`, `${route.label[1]} is moving to the new version`)}</h2>
    <p>${t("這一頁的功能仍在舊版系統中，新版會沿用相同的計算邏輯。", "This page still lives in the previous system; the new version keeps the same calculations.")}</p>
    <button type="button" class="btn-primary" onClick=${() => go("/")}>${t("回到總覽", "Back to overview")}</button>
  </div></div>`;
}

// ===== 預算分析 =====
// 同期執行率的顏色：超過 100% 就是花得比計畫快，高風險與落後沿用預警門檻
const paceKey = (rate) => (rate > TH.high ? "high" : rate > 100 ? "watch" : rate < TH.lag ? "lag" : "ok");
const monthVar = (d, cutoff) => d.monthly.budget.slice(0, cutoff).map((b, i) => (d.monthly.actual[i] == null || !b ? null : ((d.monthly.actual[i] - b) / b) * 100));

function hBarBase(names, right = 64) {
  const o = baseChart();
  o.grid = { left: 8, right, top: 8, bottom: 4, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: "item" };
  o.xAxis = { type: "value", splitLine: { lineStyle: { color: css("--divider") } }, axisLabel: { color: css("--muted"), hideOverlap: true } };
  o.yAxis = { type: "category", data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: css("--border") } }, axisLabel: { color: css("--text-2") } };
  return o;
}

function ytdVarianceOption(rows) {
  const sorted = [...rows].sort((a, b) => a.v - b.v);
  const o = hBarBase(sorted.map((r) => dn(r.name)), 110);
  o.xAxis.axisLabel.formatter = moneyAxis;
  Object.assign(o.xAxis, moneyScale(sorted.map((r) => r.v)));
  o.tooltip.formatter = (p) => { const r = sorted[p.dataIndex]; return `<b>${dn(r.name)}</b><br>${t("實際", "Actual")} ${fmc(r.actualYtd)} / ${t("同期預算", "budget to date")} ${fmc(r.budgetYtd)}<br>${t("差異", "Variance")} <b>${fmc(r.v, true)}</b>（${pct(r.vPct, true)}）`; };
  o.series = [{
    type: "bar", barMaxWidth: 16,
    data: sorted.map((r) => ({ value: r.v, itemStyle: { color: css(r.v > 0 ? "--high" : "--lag"), borderRadius: r.v > 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: "right", formatter: (p) => `${fmc(p.value, true)} (${pct(sorted[p.dataIndex].vPct, true)})`, color: css("--text-2"), fontSize: 11 },
  }];
  return o;
}

function Spark({ values }) {
  // 每月差異率小長條：往上紅＝超出當月預算，往下藍＝低於
  const max = Math.max(5, ...values.filter((v) => v != null).map(Math.abs));
  const w = 8, gap = 3, h = 28;
  return html`<svg class="spark" width=${values.length * (w + gap)} height=${h} viewBox=${`0 0 ${values.length * (w + gap)} ${h}`} aria-hidden="true">
    <line x1="0" x2=${values.length * (w + gap)} y1=${h / 2} y2=${h / 2} stroke="var(--border-strong)" stroke-width="1"></line>
    ${values.map((v, i) => v == null ? null : html`<rect x=${i * (w + gap)} width=${w} rx="1.5"
      y=${v > 0 ? h / 2 - (v / max) * (h / 2) : h / 2} height=${Math.max(1, (Math.abs(v) / max) * (h / 2))} fill=${v > 0 ? "var(--high)" : "var(--lag)"}></rect>`)}
  </svg>`;
}

function VarianceTab({ data, openDept }) {
  const rows = data.departments.map((d) => ({ ...d, v: d.actualYtd - d.budgetYtd, vPct: d.execRate - 100, mv: monthVar(d, data.cutoff) }));
  const net = rows.reduce((s, r) => s + r.v, 0), netPct = (net / data.totals.budgetYtd) * 100;
  const overRows = rows.filter((r) => r.v > 0);
  const big = rows.reduce((a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a));
  const opt = useMemo(() => ytdVarianceOption(rows), [data, css("--high")]);
  // 色階上限 30%：一次性支出（例如 +100% 的月份）不會把其他格子都洗成淡色
  const heatMax = Math.min(30, Math.max(5, ...rows.flatMap((r) => r.mv.filter((v) => v != null).map(Math.abs))));
  const heat = (v) => {
    if (v == null) return {};
    const k = Math.min(1, Math.abs(v) / heatMax);
    return { background: `color-mix(in srgb, var(${v > 0 ? "--high" : "--lag"}) ${Math.round(k * 85)}%, var(--raised))`, color: k > 0.5 ? "#fff" : "var(--text)" };
  };
  const sorted = [...rows].sort((a, b) => b.v - a.v);
  return html`
    <section class="card kpis kpis-3">
      <div class="kpi"><div class="kpi-label">${t("整體同期差異", "Net variance to date")}</div><div class=${"kpi-value num " + (net > 0 ? "c-high" : "c-lag")}>${pct(netPct, true)}</div>
        <div class="kpi-sub">${t("約", "About")} <span class="num">${fmc(net, true)}</span> · ${t(`截至 ${data.cutoff} 月`, `through ${mon(data.cutoff)}`)}${net > 0 ? t("，高於同期預算", ", above plan") : t("，低於同期預算", ", below plan")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("高於同期預算的部門", "Departments above plan")}</div><div class="kpi-value num">${overRows.length}<small> / ${rows.length}</small></div>
        <div class="kpi-sub">${t("合計多花", "Over by")} <span class="num">${fmc(overRows.reduce((s, r) => s + r.v, 0))}</span></div></div>
      <div class="kpi"><div class="kpi-label">${t("差異最大的部門", "Largest variance")}</div><div class="kpi-value">${dn(big.name)}</div>
        <div class="kpi-sub"><span class=${"num " + (big.v > 0 ? "up-bad" : "c-lag")}>${fmc(big.v, true)} (${pct(big.vPct, true)})</span></div></div>
    </section>
    <section class="duo">
      <div class="card card-pad">
        <div class="card-head"><h2 class="card-title">${t(`截至 ${data.cutoff} 月，誰花得比預算多？`, `Through ${mon(data.cutoff)}, who spent more than planned?`)}</h2>
          <${Info}><p>${t("差異＝實際支出 − 同期預算。", "Variance = actual spending − budget to date.")}</p><p>${t("中線＝剛好等於同期預算；往右（紅）＝已超出同期預算，往左（藍）＝花得比計畫慢。", "Centre line = exactly on budget to date. Right (red) = over plan; left (blue) = spending slower than planned.")}</p></${Info}></div>
        <${EChart} option=${opt} label=${t("各部門同期差異", "Variance to date by department")} />
      </div>
      <div class="card">
        <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("差異明細", "Variance detail")}</h2><span class="card-sub">${unit()} · ${t("點一列看部門細節", "click a row for details")}</span></div></div>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>${t("部門", "Department")}</th><th class="r">${t("同期預算", "Budget to date")}</th><th class="r">${t("實際", "Actual")}</th><th class="r">${t("差異", "Variance")}</th><th class="r">${t("差異率", "Variance %")}</th><th>${t("每月差異率", "Monthly variance")}</th></tr></thead>
          <tbody>${sorted.map((r) => html`<tr onClick=${() => openDept(r.id)}>
            <td><div class="dept-cell">${dn(r.name)}</div></td>
            <td class="r num">${wan(r.budgetYtd)}</td><td class="r num">${wan(r.actualYtd)}</td>
            <td class=${"r num " + (r.v > 0 ? "c-high" : "c-lag")}>${wan(r.v, true)}</td><td class=${"r num " + (r.v > 0 ? "c-high" : "c-lag")}>${pct(r.vPct, true)}</td>
            <td><${Spark} values=${r.mv} /></td>
          </tr>`)}</tbody>
        </table></div>
      </div>
    </section>
    <section class="card">
      <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("哪幾個月、哪些部門偏離當月預算？", "Which months and departments drifted from the monthly budget?")}</h2>
        <${Info}><p>${t("每格＝（實際 − 當月預算）÷ 當月預算，只顯示已結算月份。", "Each cell = (actual − monthly budget) ÷ monthly budget, closed months only.")}</p><p>${t("紅色＝那個月花超過當月預算，整排都紅的部門最值得追問原因。年底集中支出的部門（行銷、人資、核保、財務）前三季會偏藍，這是預算時程的特性，不一定是問題。",
        "Red = that month exceeded its budget; a whole red row is the first thing to ask about. Departments that spend late in the year (Marketing, HR, Underwriting, Finance) look blue through Q1–Q3; that is their budget timing, not necessarily a problem.")}</p></${Info}>
        <span class="card-sub">${t("點一列看部門細節", "Click a row for details")}</span></div></div>
      <div class="table-wrap"><table class="heat">
        <thead><tr><th></th>${Array.from({ length: data.cutoff }, (_, i) => html`<th class="c">${mon(i + 1)}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr onClick=${() => openDept(r.id)}>
          <td class="rd">${dn(r.name)}</td>
          ${r.mv.map((v, i) => html`<td class="hc num" style=${heat(v)} title=${`${dn(r.name)} ${mon(i + 1)}: ${v == null ? "—" : pct(v, true)}`}>${v == null ? "—" : pct(v, true, 0)}</td>`)}
        </tr>`)}</tbody>
      </table></div>
    </section>`;
}

function utilOption(rows) {
  const sorted = [...rows].sort((a, b) => a.execRate - b.execRate);
  const o = hBarBase(sorted.map((r) => dn(r.name)), 56);
  const tone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" };
  // 刻度固定每 20%，上限取 20 的倍數，避免最後一格刻度間距不均
  o.xAxis = { ...o.xAxis, min: 0, interval: 20, max: Math.max(140, Math.ceil((Math.max(...rows.map((r) => r.execRate)) + 5) / 20) * 20), axisLabel: { color: css("--muted"), formatter: "{value}%" } };
  o.tooltip.formatter = (p) => { const r = sorted[p.dataIndex]; return `<b>${dn(r.name)}</b><br>${t("同期執行率", "Spend vs plan")} <b>${pct(r.execRate)}</b><br>${t("實際", "Actual")} ${fmc(r.actualYtd)} / ${t("同期預算", "budget to date")} ${fmc(r.budgetYtd)}`; };
  o.series = [{
    type: "bar", barMaxWidth: 16,
    data: sorted.map((r) => ({ value: r.execRate, itemStyle: { color: css(tone[paceKey(r.execRate)]), borderRadius: [0, 4, 4, 0] } })),
    label: { show: true, position: "right", formatter: "{c}%", color: css("--text"), fontSize: 11 },
    markArea: { silent: true, label: { show: true, position: "insideTop", formatter: t("正常範圍", "Normal range"), color: css("--muted"), fontSize: 11 }, itemStyle: { color: css("--ok-soft"), opacity: 0.7 }, data: [[{ xAxis: TH.lag }, { xAxis: 100 }]] },
    markLine: { silent: true, symbol: "none", lineStyle: { color: css("--text"), width: 1.5, type: "solid" },
      label: { formatter: t("100%＝照預算進度", "100% = on plan"), position: "end", color: css("--muted"), fontSize: 11 }, data: [{ xAxis: 100 }] },
  }];
  o.grid.top = 26;
  return o;
}

function Meter({ value, max, tone }) {
  return html`<div class="meter-cell"><div class="meter-track"><i class=${"bg-" + tone} style=${{ width: Math.min(100, (value / max) * 100) + "%" }}></i>
    ${max > 100 ? html`<b style=${{ left: (100 / max) * 100 + "%" }}></b>` : null}</div><span class="num">${pct(value)}</span></div>`;
}

function UtilTab({ data, openDept }) {
  const opt = useMemo(() => utilOption(data.departments), [data, css("--high")]);
  const rows = [...data.departments].sort((a, b) => b.execRate - a.execRate);
  return html`
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t(`截至 ${data.cutoff} 月，各部門花錢速度是否超前預算？`, `Through ${mon(data.cutoff)}, is each department spending ahead of plan?`)}</h2>
        <${Info}><p>${t(`長條超過 100% 直線＝花錢速度比預算計畫快；綠色帶（${TH.lag}–100%）是正常範圍，太短（藍）代表執行落後。`, `A bar past the 100% line means spending faster than planned; the green band (${TH.lag}–100%) is normal; short blue bars are behind plan.`)}</p></${Info}>
        <span class="card-sub">${t("同期執行率 = 實際支出 ÷ 同期預算", "Spend vs plan = actual ÷ budget to date")}</span></div>
      <${EChart} option=${opt} cls="chart chart-tall" label=${t("各部門同期執行率", "Spend vs plan by department")} />
    </section>
    <section class="card">
      <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("三種使用率對照", "Three utilisation measures")}</h2>
        <span class="card-sub">${t("直線標記 = 100% · 點一列看部門細節", "Tick = 100% · click a row for details")}</span></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${t("部門", "Department")}</th><th>${t("狀態", "Status")}</th><th>${t("同期執行率", "Spend vs plan")}<br /><span class="th-sub">${t("實際 ÷ 同期預算", "actual ÷ budget to date")}</span></th><th>${t("全年使用率", "Annual use so far")}<br /><span class="th-sub">${t("實際 ÷ 年度預算", "actual ÷ annual budget")}</span></th><th>${t("預測使用率", "Forecast use")}<br /><span class="th-sub">${t("年底預估 ÷ 年度預算", "year-end forecast ÷ annual budget")}</span></th></tr></thead>
        <tbody>${rows.map((d) => html`<tr onClick=${() => openDept(d.id)}>
          <td><div class="dept-cell">${dn(d.name)}</div></td>
          <td><span class=${"tag " + d.statusKey}>${sl(d.statusKey)}</span></td>
          <td><${Meter} value=${d.execRate} max=${130} tone=${paceKey(d.execRate)} /></td>
          <td><${Meter} value=${d.spentPct} max=${100} tone="none" /></td>
          <td><${Meter} value=${d.usePct} max=${125} tone=${d.statusKey} /></td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;
}

function companyHistoryOption(data) {
  const tt = data.totals, open = data.cutoff < 12;
  const years = [...data.history.map((h) => `FY${h.year}`), `FY${data.year}`];
  const o = baseChart();
  o.xAxis = { ...o.xAxis, boundaryGap: true, data: years };
  o.legend = { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.grid.top = 36;
  o.tooltip = { ...o.tooltip, axisPointer: SHADOW_POINTER(), formatter: (ps) => tooltipRows(ps) };
  // 年底預估用與部門燈號相同的門檻（105 / 102 / 90），和總覽頁的顏色一致
  const curTone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" }[STATUS_BY_USE(tt.usePct)] || "--accent";
  o.series = [
    { name: t("年度預算", "Annual budget"), type: "bar", barMaxWidth: 24, barGap: "12%", data: [...data.history.map((h) => h.budget), tt.budget], itemStyle: { color: css("--series-muted"), borderRadius: [4, 4, 0, 0] } },
    { name: t("實際支出", "Actual"), type: "bar", stack: "a", barMaxWidth: 24, data: [...data.history.map((h) => h.actual), tt.actualYtd],
      itemStyle: { color: css("--accent"), borderRadius: open ? 0 : [4, 4, 0, 0] },
      label: { show: true, position: "top", color: css("--text-2"), fontSize: 11,
        formatter: (p) => (p.dataIndex < data.history.length ? `${Math.round((data.history[p.dataIndex].actual / data.history[p.dataIndex].budget) * 100)}%` : open ? "" : `${Math.round(tt.spentPct)}%`) } },
    ...(open ? [{ name: t("今年預估剩餘", "Rest-of-year forecast"), type: "bar", stack: "a", barMaxWidth: 24, data: [...data.history.map(() => null), tt.forecast - tt.actualYtd],
      itemStyle: { color: css(curTone), opacity: 0.55, borderRadius: [4, 4, 0, 0], decal: { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [3, 5], rotation: -0.8, color: "rgba(255,255,255,.35)" } },
      label: { show: true, position: "top", formatter: t(`預估 ${Math.round(tt.usePct)}%`, `Fcst ${Math.round(tt.usePct)}%`), color: css("--text"), fontSize: 11 } }] : []),
  ];
  return o;
}

function deptTrendOption(data) {
  const years = [...new Set([...data.departments.flatMap((d) => d.history.map((h) => h.year)), data.year])].sort();
  const o = baseChart();
  o.xAxis = { ...o.xAxis, boundaryGap: false, data: years.map((y) => `FY${y}`) };
  o.legend = { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.grid.top = 44;
  o.grid.right = 32;
  o.tooltip = { ...o.tooltip, formatter: (ps) => `<b>${ps[0].axisValue}</b><br>` + ps
    // 今年只有點線（預估）有值，其他年份只看實線，避免同一部門出現兩次
    .filter((p) => p.value != null && (p.dataIndex === years.length - 1) === p.seriesName.endsWith(" ")).sort((a, b) => b.value - a.value)
    .map((p) => `${p.marker}${p.seriesName.trim()}　<b>${fmc(p.value)}</b>${p.dataIndex === years.length - 1 ? t("（預估）", " (forecast)") : ""}`).join("<br>") };
  o.series = data.departments.flatMap((d) => {
    const byYear = Object.fromEntries(d.history.map((h) => [h.year, h.actual]));
    const solid = years.map((y) => byYear[y] ?? null);
    const last = d.history.length ? d.history[d.history.length - 1] : null;
    // 實線＝完整年度實際；點線延伸到今年年底預估，避免把年初至今的金額當成全年比較
    const dotted = years.map((y) => (last && y === last.year ? last.actual : y === data.year ? d.forecast : null));
    return [
      { name: dn(d.name), type: "line", data: solid, symbolSize: 6, lineStyle: { color: d.color, width: 2 }, itemStyle: { color: d.color } },
      { name: dn(d.name) + " ", type: "line", data: dotted, connectNulls: true, symbol: "emptyCircle", symbolSize: (v, p) => (p.dataIndex === years.length - 1 ? 8 : 0),
        lineStyle: { color: d.color, width: 2, type: [3, 3] }, itemStyle: { color: d.color }, legendHoverLink: false },
    ];
  });
  o.legend.data = data.departments.map((d) => dn(d.name));
  return o;
}

function HistoryTab({ data, theme, openDept }) {
  const coOpt = useMemo(() => companyHistoryOption(data), [data, theme]);
  const trendOpt = useMemo(() => deptTrendOption(data), [data, theme]);
  const years = [...new Set(data.departments.flatMap((d) => d.history.map((h) => h.year)))].sort();
  const cellTone = STATUS_BY_USE;
  if (!data.history.length && !years.length) return html`<div class="card empty"><h2>${t("所選年度之前沒有完整年度可以比較", "There is no complete earlier year to compare with")}</h2></div>`;
  return html`
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("歷年預算執行：每年花得比預算多還是少？", "Year by year: did we spend more or less than budget?")}</h2>
        <${Info}><p>${t("看每年是超支還是有結餘，判斷今年的狀況是常態還是例外。今年的斜紋部分是尚未發生、由系統預估的剩餘支出。", "See whether each year ended over or under budget, to judge whether this year is normal or an exception. This year's striped segment is the estimated rest-of-year spending.")}</p></${Info}>
        <span class="card-sub">${t("柱上百分比＝執行率（實際 ÷ 預算）", "Labels = actual ÷ budget")}</span></div>
      <${EChart} option=${coOpt} cls="chart chart-tall" label=${t("歷年預算與實際支出", "Budget and actual by year")} />
    </section>
    <section class=${years.length ? "duo" : "stack"}>
    <div class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("各部門歷年實際支出", "Annual spending by department")}</h2>
        <${Info}><p>${t(`實線為完整年度實際支出；點線延伸到 FY${data.year} 年底預估（空心圓）。突然跳升的年份通常有一次性支出。`, `Solid lines are complete-year actuals; dotted segments run to the FY${data.year} year-end forecast (hollow circle). Sudden jumps usually come from one-off spending.`)}</p></${Info}>
        <span class="card-sub">${t("點圖例可隱藏部門", "Click the legend to hide a department")}</span></div>
      <${EChart} option=${trendOpt} cls="chart chart-tall" label=${t("各部門歷年實際支出", "Annual spending by department")} />
    </div>
    ${years.length ? html`<div class="card">
      <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("歷年預算執行率（實際 ÷ 預算）", "Budget execution by year (actual ÷ budget)")}</h2><span class="card-sub">${t("含一次性支出；超過 100% 代表當年超支 · 最後一欄為今年預估", "Includes one-offs; above 100% means the year overspent · last column is this year's forecast")}</span></div></div>
      <div class="table-wrap"><table class="exec">
        <thead><tr><th>${t("部門", "Department")}</th>${years.map((y) => html`<th class="r">FY${y}</th>`)}<th class="r">${t(`FY${data.year} 預估`, `FY${data.year} fcst`)}</th></tr></thead>
        <tbody>${data.departments.map((d) => html`<tr onClick=${() => openDept(d.id)}>
          <td><div class="dept-cell">${dn(d.name)}</div></td>
          ${years.map((y) => { const h = d.history.find((x) => x.year === y); return html`<td class="r num">${h ? html`<span class=${"rate " + cellTone(h.use)}>${pct(h.use)}</span>` : "—"}</td>`; })}
          <td class="r num"><span class=${"rate strong " + d.statusKey}>${pct(d.usePct)}</span></td>
        </tr>`)}</tbody>
      </table></div>
    </div>` : null}
    </section>`;
}

function Analysis({ data, theme, go }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("analysisTab") || "variance"; } catch (e) { return "variance"; } });
  const [openId, setOpenId] = useState(null);
  const pick = (k) => { setTab(k); try { sessionStorage.setItem("analysisTab", k); } catch (e) {} };
  const dept = openId && data.departments.find((d) => d.id === openId);
  return html`<div class="content">
    <div class="page-intro">
      <div class="tabs" role="tablist" aria-label=${t("預算分析", "Budget analysis")}>${[["variance", t("差異分析", "Variance")], ["util", t("使用率", "Utilisation")], ["history", t("歷史趨勢", "History")]].map(([k, label]) => html`
        <button type="button" role="tab" aria-selected=${tab === k} onClick=${() => pick(k)}>${label}</button>`)}</div>
    </div>
    <div class="stack" key=${tab}>
      ${tab === "variance" ? html`<${VarianceTab} data=${data} openDept=${setOpenId} />`
        : tab === "util" ? html`<${UtilTab} data=${data} openDept=${setOpenId} />`
        : html`<${HistoryTab} data=${data} theme=${theme} openDept=${setOpenId} />`}
    </div>
    ${dept ? html`<${Drawer} dept=${dept} data=${data} theme=${theme} close=${() => setOpenId(null)} go=${go} />` : null}
  </div>`;
}

// ===== 預測與預警 =====
const FORECAST_TABS = () => [["forecast", t("年底預測", "Year-end forecast")], ["alerts", t("預算預警", "Alerts")], ["costs", t("成本歸因", "Cost drivers")], ["replay", t("提前預警回放", "Early-warning replay")]];
const NEXT_ACTION = {
  high: ["檢視未執行月份的採購、合約與支出計畫，必要時暫緩非必要支出。", "Review planned purchases, contracts and spending for the remaining months; defer discretionary spend if needed."],
  watch: ["每月檢視非必要支出，並設定剩餘月份的支出上限。", "Review discretionary spending monthly and set a cap for the remaining months."],
  lag: ["確認專案時程與剩餘預算需求；若確定有餘額，可列為調撥來源。", "Confirm project timing and remaining needs; confirmed headroom can fund reallocation."],
};

function monthlyOption(data) {
  const s = data.series;
  const o = baseChart();
  o.xAxis.boundaryGap = true;
  o.tooltip.formatter = (ps) => tooltipRows(ps);
  o.legend = { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.grid.top = 32;
  o.series = [
    { name: t("已結算實際", "Closed actual"), type: "bar", stack: "m", barMaxWidth: 24, data: s.monthlyActual, itemStyle: { color: css("--accent"), borderRadius: [4, 4, 0, 0] } },
    { name: t("剩餘月份預估", "Remaining estimate"), type: "bar", stack: "m", barMaxWidth: 24, data: s.monthlyEstimate, itemStyle: { color: css("--est"), borderRadius: [4, 4, 0, 0] } },
    { name: t("每月預算", "Monthly budget"), type: "line", step: "middle", symbol: "none", data: s.monthlyBudget, lineStyle: { color: css("--text"), width: 1.5, type: [3, 3] }, itemStyle: { color: css("--text") } },
  ];
  return o;
}

function Gauge({ tt }) {
  const remaining = tt.forecast - tt.actualYtd;
  const scale = Math.max(tt.forecast, tt.budget) * 1.04 || 1;
  const w = (v) => (Math.max(0, v) / scale) * 100 + "%";
  const over = tt.forecast > tt.budget;
  return html`<section class="card card-pad">
    <div class="card-head"><h2 class="card-title">${t("全公司年底支出怎麼算出來？", "How the year-end total is built")}</h2>
      <${Info}><p>${t("剩餘月份的支出＝55% 依歷年季節性推估＋45% 依目前花費速度推估。", "Remaining months = 55% from past seasonal patterns + 45% from the current spending pace.")}</p><p>${t("一次性支出只計已發生的金額，不會延伸到未來月份。", "One-off costs count only once and are not carried into future months.")}</p></${Info}>
      <span class="card-sub">${t("已花 + 預計再花 = 年底預估；超過預算線的部分就是超支", "Spent + still to spend = year-end forecast; anything past the budget line is overspend")}</span></div>
    <div class="gauge">
      <i class="g-spent" style=${{ width: w(Math.min(tt.actualYtd, tt.budget)) }}><span>${t("已花", "Spent")} ${pct(tt.spentPct, false, 0)}</span></i>
      ${tt.actualYtd > tt.budget ? html`<i class="g-hatch" style=${{ width: w(tt.actualYtd - tt.budget), "--c": css("--high") }}></i>` : null}
      <i class="g-hatch" style=${{ width: w(Math.min(tt.forecast, tt.budget) - tt.actualYtd), "--c": css("--accent") }}><span>${t("預計再花", "Still to spend")}</span></i>
      ${over ? html`<i class="g-hatch" style=${{ width: w(tt.forecast - Math.max(tt.actualYtd, tt.budget)), "--c": css("--high") }}></i>` : null}
      <b class="g-limit" style=${{ left: w(tt.budget) }}><em>${t("年度預算", "Budget")} ${fmc(tt.budget)}</em></b>
    </div>
    <div class="g-legend">
      <span><i class="g-sw" style=${{ background: "var(--accent)" }}></i>${t("已花", "Spent")} <b class="num">${fmc(tt.actualYtd)}</b></span>
      <span><i class="g-sw g-hatch" style=${{ "--c": css("--accent") }}></i>${t("預計再花", "Still to spend")} <b class="num">${fmc(remaining)}</b></span>
      <span>＝ ${t("年底預估", "Year-end forecast")} <b class="num">${fmc(tt.forecast)}</b> (${pct(tt.usePct)})</span>
      ${over ? html`<span class="c-high"><i class="g-sw g-hatch" style=${{ "--c": css("--high") }}></i>${t("超出預算", "Over budget")} <b class="num">${fmc(tt.variance)}</b></span>` : null}
    </div>
  </section>`;
}

function ForecastTab({ data, theme, openDept }) {
  const tt = data.totals;
  const remaining = tt.forecast - tt.actualYtd;
  const over = tt.variance > 0;
  const rows = useMemo(() => [...data.departments].sort((a, b) => b.variance - a.variance), [data]);
  const varOpt = useMemo(() => {
    const o = forecastVarOption(data);
    const sorted = [...data.departments].sort((a, b) => a.variance - b.variance); // 與圖表同順序
    o.tooltip.formatter = (p) => {
      const d = sorted[p.dataIndex];
      return `<b>${dn(d.name)}</b>　${sl(d.statusKey)}<br>${t("年底預估", "Year-end forecast")} <b>${fmc(d.forecast)}</b> / ${t("預算", "budget")} ${fmc(d.budget)}<br>${t("差異", "Gap")} <b>${fmc(d.variance, true)}</b> (${pct(d.variancePct, true)})<br>${t("合理區間", "Likely range")} ${fmc(d.low)} – ${fmc(d.high)}`;
    };
    return o;
  }, [data, theme]);
  const monthOpt = useMemo(() => monthlyOption(data), [data, theme]);
  return html`
    <section class="card kpis">
      <div class="kpi"><div class="kpi-label">${t("已花", "Spent")}</div><div class="kpi-value num">${pct(tt.spentPct)}</div>
        <div class="kpi-sub"><span class="num">${fmc(tt.actualYtd)}</span> · ${t(`截至 ${data.cutoff} 月`, `through ${mon(data.cutoff)}`)}</div></div>
      <div class="kpi"><div class="kpi-label">${t("預計再花", "Still to spend")}</div><div class="kpi-value num">${pct((remaining / tt.budget) * 100)}</div>
        <div class="kpi-sub"><span class="num">${fmc(remaining)}</span> · ${data.cutoff < 12 ? t(`${data.cutoff + 1}–12 月`, `${mon(data.cutoff + 1)}–Dec`) : t("無剩餘月份", "no months left")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("年底預算使用率", "Year-end budget use")}</div><div class=${"kpi-value num " + ({ high: "c-high", watch: "c-watch" }[STATUS_BY_USE(tt.usePct)] || "")}>${pct(tt.usePct)}</div>
        <div class="kpi-sub">${t("P80 合理區間", "P80 likely range")} <span class="num">${pct(tt.lowPct)}–${pct(tt.highPct)}</span></div></div>
      <div class="kpi"><div class="kpi-label">${over ? t("預估年底超支", "Projected overspend") : t("預估年底結餘", "Projected headroom")}</div><div class=${"kpi-value num " + (over ? "c-high" : "")}>${pct(Math.abs(tt.variancePct))}</div>
        <div class="kpi-sub">${t("約", "About")} <span class="num">${fmc(Math.abs(tt.variance))}</span></div></div>
    </section>
    <${Gauge} tt=${tt} />
    <section class="duo">
      <div class="card card-pad">
        <div class="card-head"><h2 class="card-title">${t("哪些部門年底會超支？差多少？", "Which departments will overspend, and by how much?")}</h2>
          <${Info}><p>${t("中線＝剛好用完預算；往右越長，年底超支越多。滑鼠移到長條可看合理區間。", "Centre line = exactly the budget; the longer the bar to the right, the bigger the overspend. Hover a bar for the likely range.")}</p></${Info}></div>
        <${EChart} option=${varOpt} label=${t("各部門年底預估差異", "Year-end gap by department")} />
      </div>
      <div class="card card-pad">
        <div class="card-head"><h2 class="card-title">${t("每個月花多少？", "Spending by month")}</h2>
          <${Info}><p>${t("長條高過虛線的月份，就是預計超出當月預算；年底集中支出的部門會在 11–12 月出現高峰。", "Bars above the dotted line are months expected to exceed their budget; year-end spenders peak in Nov–Dec.")}</p></${Info}>
          <span class="card-sub">${t("已結算（實色）與預估（淡色）對照每月預算", "Closed (solid) and estimated (light) vs monthly budget")}</span></div>
        <${EChart} option=${monthOpt} label=${t("每月實際、預估與預算", "Monthly actual, estimate and budget")} />
      </div>
    </section>
    <section class="card">
      <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("各部門年底預估拆解", "Year-end forecast by department")}</h2>
        <${Info}><p>${t("年底預估＝55% 季節性推估＋45% 依目前速度推估。", "Year-end forecast = 55% seasonal estimate + 45% current-pace estimate.")}</p><p>${t(`季節性與合理區間依各部門過去 ${[...new Set(rows.map((r) => r.historyYears))].join("／")} 個完整年度的同期資料估計。`, `The seasonal estimate and likely range use ${[...new Set(rows.map((r) => r.historyYears))].join("/")} complete past years of same-period data.`)}</p><p>${t("「依目前速度」假設剩餘月份照今年至今的「實際 ÷ 預算」比例花用；「季節性」依歷年同期累計占全年的比例回推全年，能反映年底集中請款。", "Current pace assumes the remaining months keep this year's actual-to-budget ratio; seasonal scales up using the share of the full year that past years had spent by this month, which captures year-end spending.")}</p></${Info}>
        <span class="card-sub">${unit()} · ${t("點一列看部門細節", "click a row for details")}</span></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${t("部門", "Department")}</th><th>${t("狀態", "Status")}</th><th class="r">${t("全年預算", "Budget")}</th><th class="r">${t("已支出", "Spent")}</th><th class="r">${t("剩餘預估", "Remaining")}</th><th class="r">${t("年底預估", "Year-end")}</th>
          <th class="r">${t("差額", "Gap")}</th><th class="r">${t("差額率", "Gap %")}</th><th class="r">${t("依目前速度", "Current pace")}</th><th class="r">${t("季節性推估", "Seasonal")}</th><th class="r">${t("合理區間", "Likely range")}</th></tr></thead>
        <tbody>${rows.map((d) => html`<tr onClick=${() => openDept(d.id)}>
          <td><div class="dept-cell">${dn(d.name)}</div></td>
          <td><span class=${"tag " + d.statusKey}>${sl(d.statusKey)}</span></td>
          <td class="r num">${wan(d.budget)}</td><td class="r num">${wan(d.actualYtd)}</td><td class="r num">${wan(d.forecast - d.actualYtd)}</td>
          <td class="r num"><b>${wan(d.forecast)}</b></td>
          <td class=${"r num c-" + d.statusKey}>${wan(d.variance, true)}</td><td class=${"r num c-" + d.statusKey}>${pct(d.variancePct, true)}</td>
          <td class="r num">${wan(d.runRate)}</td><td class="r num">${d.seasonal == null ? "—" : wan(d.seasonal)}</td>
          <td class="r num">${wan(d.low)}–${wan(d.high)}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;
}

// AI 主管預警簡報：在預警頁直接產生、查看並下載 PDF；依身分、資料集、年度與門檻分開暫存，切換頁籤回來不必重寫
// 逐字顯示：讀伺服器的 Server-Sent Events，每收到一段就把目前全文交給 onText，最後回傳完整結果（含數字查核、圖表）。
// 串流中斷或沒有結果時丟出錯誤，呼叫端改用一次回傳的舊端點。
async function streamPost(url, payload, onText) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok || !r.body) throw new Error("stream");
  // 模型一次送來一大段，畫面以固定節奏把字補上，落後越多補得越快，看起來是平順地逐字出現
  let text = "", shown = 0;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timer = setInterval(() => {
    if (shown >= text.length) return;
    shown = reduce ? text.length : Math.min(text.length, shown + Math.max(2, Math.ceil((text.length - shown) / 10)));
    onText(text.slice(0, shown));
  }, 33);
  const caughtUp = () => new Promise((ok) => { const check = () => (shown >= text.length ? ok() : setTimeout(check, 33)); check(); });
  try {
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, cut).trim();
        buf = buf.slice(cut + 2);
        if (!line.startsWith("data:")) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "done") { await caughtUp(); delete ev.type; return ev; }
        if (ev.type === "reset") { text = ev.text; shown = Math.min(shown, text.length); onText(text.slice(0, shown)); }
        else text += ev.text;
      }
    }
    throw new Error("stream");
  } finally {
    clearInterval(timer);
  }
}

const postJson = async (url, payload) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error();
  return r.json();
};

function BriefPanel({ data, state, go }) {
  const key = `brief:${chatKey(state)}:${data.year}:${(state.th || DEFAULT_TH).join()}:${state.depts.join(",")}:${state.lang || "zh"}`;
  const [brief, setBrief] = useState(() => { try { return JSON.parse(sessionStorage.getItem(key)); } catch (e) { return null; } });
  const [phase, setPhase] = useState("idle"); // idle | writing | error
  const [draft, setDraft] = useState("");
  const [pdf, setPdf] = useState("idle"); // idle | busy | error
  const body = () => ({ year: data.year, depts: state.depts.join(","), ds: state.ds || "", viewRole: state.role, viewDept: state.roleDept || "",
    lang: state.lang || "zh", th: (state.th || DEFAULT_TH).join(",") });
  const write = async (fresh = false) => {
    setPhase("writing");
    setDraft("");
    const payload = { ...body(), fresh };
    let res = null, shown = false;
    try {
      res = await streamPost("/api/brief/stream", payload, (text) => { shown = true; setDraft(text); });
    } catch (e) {}
    try {
      // 還沒顯示任何字就斷線時改用一次回傳；已經寫到一半就不重送，避免重複呼叫 AI
      if (!res && !shown) res = await postJson("/api/brief", payload);
      if (!res) throw new Error();
      const b = { ...res, at: new Date().toLocaleString(state.lang === "en" ? "en-US" : "zh-TW", { hour12: false }) };
      setBrief(b);
      try { sessionStorage.setItem(key, JSON.stringify(b)); } catch (e) {}
      setPhase("idle");
    } catch (e) {
      setPhase("error");
    }
    setDraft("");
  };
  const download = async () => {
    setPdf("busy");
    try {
      const r = await fetch("/api/brief.pdf", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body(), text: brief.text, source: brief.mode === "ai" ? brief.source : sourceText(brief), check: brief.check }) });
      await saveResponse(r, `FY${data.year}_brief.pdf`);
      setPdf("idle");
    } catch (e) {
      setPdf("error");
      setTimeout(() => setPdf("idle"), 4000);
    }
  };
  // 追問前先把簡報放進對話紀錄，AI 才知道「剛才的簡報」寫了什麼
  const followUp = (question) => {
    const ck = chatKey(state);
    const chat = loadChat(ck).filter((m) => !m.error);
    if (!chat.some((m) => m.role === "assistant" && m.content === brief.text)) {
      chat.push({ role: "user", content: t("請寫一份預警簡報", "Write the alert brief") },
        { role: "assistant", content: brief.text, mode: brief.mode, source: brief.source, check: brief.check });
      try { sessionStorage.setItem(ck, JSON.stringify(chat)); } catch (e) {}
    }
    go("/assistant", question);
  };
  if (phase === "writing" && draft) {
    return html`<section class="card card-pad brief">
      <div class="card-head"><h2 class="card-title"><${Icon} name="spark" size=${16} /> ${soleDept(data) ? t(`AI ${soleDept(data)}簡報`, `AI brief: ${dn(soleDept(data))}`) : t("AI 預警簡報", "AI alert brief")}</h2>
        <span class="card-sub">${t("AI 撰寫中…", "AI is writing…")}</span></div>
      <div class="md streaming" dangerouslySetInnerHTML=${{ __html: md(draft) }}></div>
      <div class="msg-meta"><span class="src">${t("寫完後自動查核數字", "Numbers are checked when it finishes")}</span></div>
    </section>`;
  }
  if (!brief || phase === "writing") {
    return html`<div class="ai-banner">
      <${Icon} name="spark" size=${20} />
      <div><b>${soleDept(data) ? t(`需要一份${soleDept(data)}的預算簡報？`, `Need a budget brief for ${dn(soleDept(data))}?`) : state.role === "cfo" ? t("需要一份全公司預警簡報？", "Need a company-wide alert brief?") : t("需要一份提報管理層的預警簡報？", "Need an alert brief for management?")}</b><span>${phase === "writing" ? t("AI 撰寫中，約需 10–20 秒…", "AI is writing; this takes about 10–20 seconds…")
        : phase === "error" ? t("簡報沒有產生成功，請再試一次。", "The brief could not be written; please try again.")
        : t("AI 依下方預警與判斷依據撰寫摘要與建議行動，數字自動查核，可直接下載 PDF。", "AI drafts a summary and actions from the alerts below; every number is checked, and you can download it as a PDF.")}</span></div>
      <button type="button" class="btn-primary" disabled=${phase === "writing"} onClick=${() => write(false)}>${phase === "writing" ? t("撰寫中…", "Writing…") : t("產生預警簡報", "Draft the brief")}</button>
    </div>`;
  }
  return html`<section class="card card-pad brief">
    <div class="card-head"><h2 class="card-title"><${Icon} name="spark" size=${16} /> ${soleDept(data) ? t(`AI ${soleDept(data)}簡報`, `AI brief: ${dn(soleDept(data))}`) : t("AI 預警簡報", "AI alert brief")}</h2>
      <span class="card-sub">${brief.at}</span>
      <div class="right brief-actions">
        <button type="button" class=${"ghost-btn" + (pdf === "error" ? " err" : "")} disabled=${pdf === "busy"} onClick=${download}>
          <${Icon} name=${pdf === "error" ? "alert" : "download"} size=${14} />${pdf === "busy" ? t("產生中…", "Preparing…") : pdf === "error" ? t("下載失敗，請再試一次", "Download failed, try again") : t("下載 PDF", "Download PDF")}</button>
        <button type="button" class="ghost-btn" onClick=${() => write(true)}>${t("重新產生", "Rewrite")}</button>
        <button type="button" class="ghost-btn" onClick=${() => followUp(t("針對剛才的預警簡報，哪一項最需要本週優先處理？", "From the alert brief, which item should be handled first this week?"))}><${Icon} name="arrow" size=${14} />${t("繼續問 AI", "Ask a follow-up")}</button>
      </div></div>
    <div class="md" dangerouslySetInnerHTML=${{ __html: md(brief.text) }}></div>
    <div class="msg-meta"><${CheckBadge} check=${brief.check} /><span class="src">${sourceText(brief)}</span></div>
  </section>`;
}

function AlertsTab({ data, state, openDept, go }) {
  const groups = ["high", "watch", "lag"].map((key) => {
    const rows = data.departments.filter((d) => d.statusKey === key);
    const gap = rows.reduce((s, d) => s + d.variance, 0);
    const base = rows.reduce((s, d) => s + d.budget, 0);
    return { key, label: sl(key), rows, gap, gapPct: base ? (gap / base) * 100 : 0 };
  });
  const alerts = data.departments.filter((d) => d.statusKey !== "ok");
  return html`
    <section class="status-cards">${groups.map((g) => html`<div class=${"card status-card " + g.key}>
      <div class="kpi-label"><span class=${"dot bg-" + g.key}></span>${g.label}</div>
      <div class="kpi-value num">${g.rows.length}<small> ${t("個部門", g.rows.length === 1 ? "department" : "departments")}</small></div>
      <div class="kpi-sub">${g.rows.length ? html`${t("年底合計", "Year-end total")} <b class=${"num c-" + g.key}>${fmc(g.gap, true)}</b> · ${t("對其預算", "vs their budget")} <span class="num">${pct(g.gapPct, true)}</span>` : t("目前沒有", "None")}</div>
    </div>`)}</section>
    <${BriefPanel} key=${`${data.year}|${state.ds}|${state.role}|${state.roleDept}|${(state.th || DEFAULT_TH).join()}|${state.depts.join()}`} data=${data} state=${state} go=${go} />
    ${alerts.length ? alerts.map((d) => html`<article class=${"card acard " + d.statusKey}>
      <div class="acard-main">
      <div class="acard-head">
        <span class=${"tag " + d.statusKey}>${sl(d.statusKey)}</span><h3>${dn(d.name)}</h3>
        <span class=${"acard-amt num c-" + d.statusKey}>${fmc(d.variance, true)}</span>
      </div>
      <p class="acard-msg">${t("年底預估", "Year-end forecast")} <b class="num">${fmc(d.forecast)}</b>${t("，年度預算", " vs budget")} <span class="num">${fmc(d.budget)}</span> (<span class="num">${pct(d.variancePct, true)}</span>) · ${t("合理區間", "likely range")} <span class="num">${fmc(d.low)} – ${fmc(d.high)}</span></p>
      <div class="section-title spaced">${t("為什麼亮燈", "Why it is flagged")}</div>
      <ul class="evidence">${d.evidence.map((e) => html`<li>${e}</li>`)}</ul>
      </div>
      <aside class="acard-side">
        <div class="section-title">${t("建議行動", "Suggested action")}</div>
        <div class="next"><${Icon} name="arrow" size=${14} />${t(...NEXT_ACTION[d.statusKey])}</div>
        <div class="acard-btns">
          <button type="button" class="ghost-btn" onClick=${() => openDept(d.id)}>${t("查看明細", "Details")}</button>
          <button type="button" class="ghost-btn" onClick=${() => go("/assistant", t(`分析${d.name}今年的預算執行狀況，和往年相比有什麼差異？建議怎麼處理？`, `Analyse ${dn(d.name)}'s budget this year: how does it differ from past years, and what should we do?`))}><${Icon} name="spark" size=${14} />${t("請 AI 分析", "Ask AI")}</button>
        </div>
      </aside>
    </article>`) : html`<div class="alert ok"><div class="lead"><${Icon} name="check" size=${20} /><b>${t("目前沒有符合預警條件的部門", "No department currently meets the alert criteria")}</b></div></div>`}`;
}

function replayDeptOption(row, th) {
  const o = baseChart();
  const tone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" };
  const vals = [...row.months.map((m) => m.use), ...row.months.map((m) => m.ytd), row.finalUse, th.high, th.lag];
  o.xAxis = { ...o.xAxis, boundaryGap: false, data: months() };
  o.yAxis = { ...o.yAxis, min: Math.floor(Math.min(...vals) - 3), max: Math.ceil(Math.max(...vals) + 3), axisLabel: { color: css("--muted"), formatter: "{value}%" } };
  o.legend = { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.grid.top = 40;
  o.tooltip.formatter = (ps) => `<b>${t(`${ps[0].axisValue}底`, `End of ${ps[0].axisValue}`)}</b><br>` + ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}　<b>${p.value}%</b>`).join("<br>");
  const flags = row.systemMonth && row.systemMonth === row.reportMonth
    ? [{ m: row.systemMonth, label: t("兩者同時亮燈", "Both flag"), c: css("--accent") }]
    : [row.systemMonth && { m: row.systemMonth, label: t("本系統亮燈", "System flags"), c: css("--accent") }, row.reportMonth && { m: row.reportMonth, label: t("月報亮燈", "Report flags"), c: css("--muted") }].filter(Boolean);
  o.series = [
    { name: t("傳統月報：累計實際 ÷ 累計預算", "Month-end report: actual ÷ budget to date"), type: "line", data: [...row.months.map((m) => m.ytd), null], symbolSize: 6,
      lineStyle: { color: css("--muted"), width: 2, type: [5, 4] }, itemStyle: { color: css("--muted") },
      markArea: { silent: true, label: { show: true, position: "insideTopLeft", formatter: t("正常範圍", "Normal range"), color: css("--muted"), fontSize: 11 }, itemStyle: { color: css("--ok-soft"), opacity: .6 }, data: [[{ yAxis: th.lag }, { yAxis: th.watch }]] },
      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: css("--border-strong"), type: [2, 3] }, data: [{ yAxis: 100 }] } },
    { name: t("本系統：預測年底使用率", "This system: forecast year-end use"), type: "line", data: [...row.months.map((m) => ({ value: m.use, itemStyle: { color: css(tone[m.key]) } })), null],
      symbolSize: 8, lineStyle: { color: css("--accent"), width: 3 }, itemStyle: { color: css("--accent"), borderColor: css("--surface"), borderWidth: 1.5 },
      markLine: flags.length ? { silent: true, symbol: "none", data: flags.map((f) => ({ xAxis: f.m - 1, lineStyle: { color: f.c, type: [3, 3], width: 1.5 },
        label: { formatter: `${f.label} · ${mon(f.m)}`, color: f.c, fontSize: 11, position: "insideEndTop" } })) } : undefined },
    { name: t("年底實際", "Actual year end"), type: "scatter", symbol: "path://M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z", symbolSize: 18,
      data: [...Array(11).fill(null), row.finalUse], itemStyle: { color: css(tone[row.finalKey]) } },
  ];
  return o;
}

function replayVerdict(r) {
  const name = dn(r.name), st = sl(r.finalKey);
  if (r.finalKey === "ok") {
    return t(`${name}年底其實正常（${pct(r.finalUse)}）。傳統月報亮錯燈 ${r.reportFalse} 個月，本系統 ${r.systemFalse} 個月；` +
      (r.reportFalse > r.systemFalse ? "月報看不到年底集中支出，才會一直以為執行落後。" : "兩者差不多。"),
      `${name} actually ended on track (${pct(r.finalUse)}). The month-end report showed a wrong light for ${r.reportFalse} months, this system for ${r.systemFalse}` +
      (r.reportFalse > r.systemFalse ? "; the report cannot see year-end spending, so it kept calling the department behind plan." : "; about the same."));
  }
  if (r.systemMonth) {
    const rep = r.reportMonth ? t(`傳統月報 ${r.reportMonth} 月`, `the month-end report from ${mon(r.reportMonth)}`) : t("傳統月報到 11 月都沒有穩定亮燈", "the month-end report never flagged it steadily");
    return t(`${name}年底${st}（${pct(r.finalUse)}）：本系統 ${r.systemMonth} 月底起穩定亮燈，比 12 月結算早 ${12 - r.systemMonth} 個月；${rep}。`,
      `${name} ended ${st.toLowerCase()} (${pct(r.finalUse)}): this system flagged it steadily from the end of ${mon(r.systemMonth)}, ${12 - r.systemMonth} months before the December close; ${rep}.`);
  }
  return t(`${name}年底${st}（${pct(r.finalUse)}），只略過門檻；本系統在 11 月底前沒有穩定亮燈，這是預測仍需改進的案例。`,
    `${name} ended ${st.toLowerCase()} (${pct(r.finalUse)}), just past the threshold; this system did not flag it steadily before November, a case where the forecast can still improve.`);
}

function ReplayTab({ state, theme }) {
  const [rp, setRp] = useState(null);
  const [year, setYear] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setRp(null);
    fetch("/api/replay?" + scopeParams(state)).then((r) => r.json())
      .then((d) => { if (alive) { setRp(d); setYear(d.defaultYear); } }).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [state.depts.join(","), state.ds, state.role, (state.th || DEFAULT_TH).join()]);
  const yearData = rp && year && rp.byYear[year];
  const focus = useMemo(() => yearData ? yearData.rows.filter((r) => r.finalKey !== "ok" || r.systemFalse || r.reportFalse)
    .sort((a, b) => (b.reportFalse - b.systemFalse) - (a.reportFalse - a.systemFalse)) : [], [yearData]);
  const row = focus.find((r) => r.id === deptId) || focus[0];
  const opt = useMemo(() => row && replayDeptOption(row, rp.thresholds), [row, theme]);
  if (err) return html`<div class="card empty"><h2>${t("回放資料載入失敗，請重新整理頁面", "Could not load the replay; please refresh the page")}</h2></div>`;
  if (!rp) return html`<div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:420px"></div>`;
  if (!rp.years.length) return html`<div class="card empty"><h2>${t("目前沒有已結算完整 12 個月的年度可以回放", "There is no fully closed year to replay yet")}</h2></div>`;
  const o = rp.overall;
  const fewer = o.reportFalse ? Math.round((1 - o.systemFalse / o.reportFalse) * 100) : 0;
  const span = t(`FY${Math.min(...rp.years)}–FY${Math.max(...rp.years)} 共 ${o.deptYears} 個部門年度`, `FY${Math.min(...rp.years)}–FY${Math.max(...rp.years)}, ${o.deptYears} department-years`);
  const cell = (m, key, wrong, steady, label, value) => html`<td class=${"rc k-" + key + (steady ? " steady" : "")} title=${t(`${m} 月底：${label} ${value}%`, `End of ${mon(m)}: ${label} ${value}%`) + (wrong ? t("（亮錯燈）", " (wrong light)") : "")}>${wrong ? "×" : ""}</td>`;
  const sysLabel = t("本系統", "This system"), repLabel = t("傳統月報", "Month-end report");
  return html`
    <div class="lead-line">${t("如果過去幾年就有這套系統，燈號會不會亮對？", "Had this system run in past years, would its lights have been right?")}
      <${Info}><ol>
        <li>${t("挑一個已經結束的年度，回到當年每個月底，只用「當時已經知道」的支出資料。", "Pick a closed year and step through each month-end, using only the spending known at that time.")}</li>
        <li>${t("每個月用本系統重新預測年底並亮燈，同時用傳統月報（累計實際 ÷ 累計預算）當對照。", "Each month, re-run this system's year-end forecast and light, next to the traditional month-end report (actual ÷ budget to date).")}</li>
        <li>${t("和那一年真正的年底結果比對：誰比較早亮對燈、誰比較常亮錯燈。", "Compare with the actual year-end result: who lights the right way earlier, and who lights the wrong way more often.")}</li>
      </ol></${Info}></div>
    <section class="card kpis kpis-3">
      <div class="kpi"><div class="kpi-label">${t("亮錯燈的月份", "Months with a wrong light")}</div>
        <div class="kpi-value num">${o.systemFalse}${t(html`<small> 次</small>`, "")}${o.systemFalse < o.reportFalse ? html` <span class="pill ok">${t(`少 ${fewer}%`, `${fewer}% fewer`)}</span>` : null}</div>
        <div class="kpi-sub">${repLabel} <b class="num">${o.reportFalse}</b> · ${span}</div></div>
      <div class="kpi"><div class="kpi-label">${t("抓到的問題部門", "Problems caught")}</div>
        <div class="kpi-value num">${o.systemCaught}<small> / ${o.problems}</small></div>
        <div class="kpi-sub">${repLabel} <span class="num">${o.reportCaught} / ${o.problems}</span> · ${t("11 月底前穩定亮燈", "steady by November")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("平均提早發現", "Average early warning")}</div>
        <div class="kpi-value num">${o.lead}<small> ${t("個月", "months")}</small></div>
        <div class="kpi-sub">${t("比 12 月結算更早亮燈，且亮起後不再改變", "before the December close, and the light stayed on")}</div></div>
    </section>
    <section class="card">
      <div class="card-pad table-head">
        <div class="card-head"><h2 class="card-title">${t(`FY${year}：本系統 vs 傳統月報，每個月底亮的燈`, `FY${year}: this system vs the month-end report, light at each month-end`)}</h2>
          <${Info}><p>${t("× 代表燈號方向和最右欄的年底結果相反；滑鼠移到格子上可看當月百分比。", "× means the light pointed the opposite way to the year-end result on the right; hover a cell for that month's percentage.")}</p></${Info}>
          <span class="card-sub">${t(html`亮錯燈：本系統 <b class="num">${yearData.systemFalse}</b> 次、傳統月報 <b class="num">${yearData.reportFalse}</b> 次`, html`Wrong lights: this system <b class="num">${yearData.systemFalse}</b>, month-end report <b class="num">${yearData.reportFalse}</b>`)}</span>
          <div class="seg right" role="group" aria-label=${t("回放年度", "Replay year")}>${rp.years.map((y) => html`<button type="button" aria-pressed=${y === year} onClick=${() => { setYear(y); setDeptId(null); }}>FY${y}</button>`)}</div></div>
        <div class="legend">
          <span><i class="lg k-none"></i>${t("沒亮燈", "No light")}</span><span><i class="lg k-high"></i>${sl("high")}</span><span><i class="lg k-watch"></i>${sl("watch")}</span>
          <span><i class="lg k-lag"></i>${sl("lag")}</span><span><i class="lg k-ok"></i>${t("年底正常", "On track at year end")}</span><span><b class="lg-x">×</b>${t("亮錯燈", "Wrong light")}</span><span><i class="lg steady-sw"></i>${t("從這個月起穩定亮對燈", "Right light steadily from here")}</span>
        </div>
      </div>
      <div class="table-wrap"><table class="replay">
        <thead><tr><th>${t("部門", "Department")}</th><th></th>${Array.from({ length: 11 }, (_, i) => html`<th class="c">${mon(i + 1)}</th>`)}<th class="c">${t("年底實際", "Actual")}</th></tr></thead>
        <tbody>${yearData.rows.map((r) => html`
          <tr class="sys" onClick=${() => setDeptId(r.id)}>
            <td rowspan="2" class="rd"><b>${dn(r.name)}</b></td><td class="rm">${sysLabel}</td>
            ${r.months.map((m) => cell(m.m, m.key === "ok" ? "none" : m.key, m.wrong, m.m === r.systemMonth, t("預測年底使用率", "forecast year-end use"), m.use))}
            <td rowspan="2" class=${"rc final k-" + r.finalKey}>${Math.round(r.finalUse)}%</td>
          </tr>
          <tr class="rep" onClick=${() => setDeptId(r.id)}>
            <td class="rm muted">${repLabel}</td>
            ${r.months.map((m) => cell(m.m, m.ytdKey === "ok" ? "none" : m.ytdKey, m.ytdWrong, m.m === r.reportMonth, t("累計執行率", "spend vs plan to date"), m.ytd))}
          </tr>`)}</tbody>
      </table></div>
    </section>
    ${row ? html`<section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t(`${row.name}：本系統 vs 傳統月報，逐月對照`, `${dn(row.name)}: this system vs the month-end report, month by month`)}</h2></div>
      <div class="prompts spaced-below">${focus.map((r) => html`<button type="button" class=${"prompt" + (r.id === row.id ? " on" : "")} aria-pressed=${r.id === row.id} onClick=${() => setDeptId(r.id)}>${dn(r.name)}</button>`)}</div>
      <${EChart} option=${opt} label=${t(row.name + "逐月燈號對照", `${dn(row.name)} lights by month`)} />
      <p class="verdict">${replayVerdict(row)}</p>
    </section>` : null}`;
}

// ===== 成本歸因：發票層級合成明細（不是實際發票），分析對象是科目、專案、供應商與成本中心，不以個人排名 =====
const DRILLS = () => [["account", t("會計科目", "Category")], ["project", t("專案", "Project")], ["vendor", t("供應商", "Vendor")], ["cc", t("成本中心", "Cost centre")]];
const LEDGER_PAGE = 50;

function hbarBase(labels) {
  const o = baseChart();
  o.tooltip = { ...o.tooltip, axisPointer: SHADOW_POINTER() };
  o.grid = { left: 8, right: 12, top: 8, bottom: 4, containLabel: true };
  // 右側留空間給長條尾端的金額標籤
  o.xAxis = { type: "value", max: (v) => v.max * 1.42, splitLine: { lineStyle: { color: css("--divider") } },
    axisLabel: { color: css("--muted"), formatter: moneyAxis, hideOverlap: true, showMaxLabel: false } };
  o.yAxis = { type: "category", inverse: true, data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: css("--border") } },
    axisLabel: { color: css("--text-2"), fontSize: 12, width: 160, overflow: "truncate" } };
  return o;
}
const endLabel = (formatter) => ({ show: true, position: "right", color: css("--text"), fontSize: 11.5, formatter });

function costDrillOption(kind, c, colors) {
  const share = (v, base) => pct(base ? (v / base) * 100 : 0);
  if (kind === "account") {
    const rows = c.byAccount;
    const totals = {};
    rows.forEach((r) => Object.entries(r.byDept).forEach(([d, v]) => { totals[d] = (totals[d] || 0) + v; }));
    const depts = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const o = hbarBase(rows.map((r) => r.label));
    o.legend = { type: "scroll", top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 }, data: depts.map(dn) };
    o.grid.top = 34;
    o.series = depts.map((d) => ({ name: dn(d), type: "bar", stack: "a", barMaxWidth: 16, itemStyle: { color: colors[d] }, data: rows.map((r) => r.byDept[d] || 0) }));
    // 長度為 0 的最後一段只用來把合計標在整條長條的尾端
    o.series.push({ name: "__total", type: "bar", stack: "a", silent: true, data: rows.map(() => 0),
      label: endLabel((p) => `${fmc(rows[p.dataIndex].total)} · ${share(rows[p.dataIndex].total, c.total)}`) });
    o.tooltip.formatter = (ps) => {
      const r = rows[ps[0].dataIndex];
      return `<b>${r.label}</b>　${fmc(r.total)}<br>` + ps.filter((p) => p.seriesName !== "__total" && p.value > 0)
        .map((p) => `${p.marker}${p.seriesName}　<b>${fmc(p.value)}</b>`).join("<br>");
    };
    return o;
  }
  const item = (v, color, extra = {}) => ({ value: v, itemStyle: { color, borderRadius: [0, 4, 4, 0], ...extra } });
  let rows, data, label, tip;
  if (kind === "project") {
    rows = c.projects;
    data = rows.map((r) => item(r.amount, colors[r.dept]));
    label = (p) => `${fmc(rows[p.dataIndex].amount)} (${share(rows[p.dataIndex].amount, c.total)})`;
    tip = (r) => `<b>${r.label}</b><br>${dn(r.dept)} · ${fmc(r.amount)} · ${t("占總支出", "of total")} ${share(r.amount, c.total)}`;
  } else if (kind === "vendor") {
    rows = c.vendors.slice(0, 12);
    let cum = 0;
    const cums = rows.map((r) => (cum += r.amount) / c.total * 100);
    data = rows.map((r, i) => item(r.amount, css("--accent"), { opacity: i < 5 ? 1 : 0.4 }));
    label = (p) => `${fmc(rows[p.dataIndex].amount)} · ${t("累計", "cum.")} ${pct(cums[p.dataIndex], false, 0)}`;
    tip = (r) => `<b>${r.full}</b><br>${fmc(r.amount)} · ${t("占總支出", "of total")} ${share(r.amount, c.total)}`;
  } else {
    rows = c.costCenters;
    data = rows.map((r) => item(r.amount, colors[r.dept]));
    label = (p) => `${fmc(rows[p.dataIndex].amount)} · ${t("占部門", "of dept")} ${pct(rows[p.dataIndex].share, false, 0)}`;
    tip = (r) => `<b>${r.label}</b><br>${dn(r.dept)} · ${fmc(r.amount)} · ${t("占部門支出", "of department spend")} ${pct(r.share, false, 0)}`;
  }
  const o = hbarBase(rows.map((r) => r.label));
  o.series = [{ type: "bar", barMaxWidth: 16, data, label: endLabel(label) }];
  o.tooltip.formatter = (ps) => tip(rows[ps[0].dataIndex]);
  return o;
}

function costDrillHint(kind, c) {
  const n = c.vendors.length;
  const top = (k) => c.total ? (c.vendors.slice(0, k).reduce((s, v) => s + v.amount, 0) / c.total) * 100 : 0;
  const projShare = c.total ? (c.projects.reduce((s, p) => s + p.amount, 0) / c.total) * 100 : 0;
  if (kind === "account") return t("由上往下是花費最多的科目，顏色代表由哪個部門支出；右側為金額與占總支出比例。跨部門共用的科目（如差旅、訓練）會出現多種顏色。",
    "Top to bottom are the costliest categories; colours show which department spent it, with amount and share of total on the right. Shared categories (travel, training) show several colours.");
  if (kind === "project") return t(`只列專案支出（括號為占總支出比例）；其餘 ${pct(100 - projShare, false, 0)} 是日常營運費用，沒有畫進來。專案通常是超支或延宕的來源，值得逐一追蹤。`,
    `Projects only (share of total in brackets); the other ${pct(100 - projShare, false, 0)} is routine operations and not drawn. Projects are the usual source of overruns or delays.`);
  if (kind === "vendor") {
    const rest = n > 12 ? t(`其餘 ${n - 12} 家未畫出。`, `The other ${n - 12} are not drawn. `) : "";
    return t(`共 ${n} 家供應商：深色前 5 大占 ${pct(top(5), false, 0)}、前 10 大占 ${pct(top(10), false, 0)}（右側為累計比例）。${rest}` +
      (top(5) >= 50 ? "支出集中在少數供應商，議價空間與依賴風險值得檢視。" : "支出分散，沒有單一供應商依賴；可檢視同類服務是否能整併議價。"),
      `${n} vendors: the 5 darker bars make up ${pct(top(5), false, 0)}, the top 10 ${pct(top(10), false, 0)} (cumulative share on the right). ${rest}` +
      (top(5) >= 50 ? "Spend is concentrated: review negotiation leverage and dependency risk." : "Spend is spread out with no single-vendor dependency; look for similar services to consolidate."));
  }
  return t("同色為同一部門，部門依總支出由上往下排；「占部門」表示該單位占所屬部門支出的比例，比例越高越是該部門要先溝通的單位。",
    "Same colour = same department, ordered by department spend; 'of dept' is the unit's share of its department, so the highest share is the first team to talk to.");
}

const yuan = (v) => Math.round(v).toLocaleString("en-US");

function CostsTab({ data, state, theme, go }) {
  const [c, setC] = useState(null);
  const [drill, setDrill] = useState(() => store.get("costDrill") || "account");
  const [fDept, setFDept] = useState("");
  const [fAcct, setFAcct] = useState("");
  const [cfoOnly, setCfoOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(LEDGER_PAGE);
  useEffect(() => {
    let alive = true;
    setC(null);
    fetch("/api/costs?" + scopeParams(state, { year: data.year })).then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => alive && setC(d)).catch(() => alive && setC({ error: true }));
    return () => { alive = false; };
  }, [data.year, state.depts.join(","), state.ds, state.role, state.roleDept]);
  const colors = useMemo(() => Object.fromEntries(data.departments.map((d) => [d.name, d.color])), [data]);
  const drillOpt = useMemo(() => c && !c.error && c.lineCount ? costDrillOption(drill, c, colors) : null, [c, drill, theme]);
  const accounts = useMemo(() => c && !c.error ? [...new Map(c.ledger.map((l) => [l.gl, l.account])).entries()].sort((a, b) => a[0].localeCompare(b[0])) : [], [c]);
  const lines = useMemo(() => {
    if (!c || c.error) return [];
    const q = query.trim().toLowerCase();
    return c.ledger.filter((l) => (!fDept || l.dept === fDept) && (!fAcct || l.gl === fAcct) && (!cfoOnly || l.cfo) &&
      (!q || [l.id, l.po, l.vendor, l.memo, l.project, l.cc, l.account].some((s) => s.toLowerCase().includes(q))));
  }, [c, fDept, fAcct, cfoOnly, query]);
  useEffect(() => setShown(LEDGER_PAGE), [fDept, fAcct, cfoOnly, query]);
  const [xlsx, setXlsx] = useState("idle"); // idle | busy | error
  const exportXlsx = async () => {
    setXlsx("busy");
    try {
      const p = scopeParams(state, { year: data.year, fdept: fDept, gl: fAcct, cfo: cfoOnly ? "true" : "false", q: query.trim().slice(0, 100) });
      await saveResponse(await fetch("/api/ledger.xlsx?" + p), `FY${data.year}_ledger.xlsx`);
      setXlsx("idle");
    } catch (e) {
      setXlsx("error");
      setTimeout(() => setXlsx("idle"), 4000);
    }
  };

  if (!c) return html`<div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:420px"></div>`;
  if (c.error) return html`<div class="card empty"><h2>${t("費用明細載入失敗，請重新整理頁面", "Could not load the expense lines; please refresh the page")}</h2></div>`;
  if (!c.lineCount) return html`<div class="card empty"><h2>${t("所選年度還沒有已結算的費用明細", "There are no closed expense lines for this year yet")}</h2></div>`;

  const flagged = c.drivers.rows.filter((r) => r.flag);
  const projShare = c.total ? (c.projects.reduce((s, p) => s + p.amount, 0) / c.total) * 100 : 0;
  const dupTotal = c.duplicates.reduce((s, l) => s + l.amount, 0);
  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);
  const pick = (k) => { setDrill(k); store.set("costDrill", k); };
  const multi = data.departments.length > 1;
  const rowsFor = { account: c.byAccount.length, project: c.projects.length, vendor: Math.min(12, c.vendors.length), cc: c.costCenters.length };
  const drillHeight = Math.max(220, rowsFor[drill] * 30 + (drill === "account" ? 70 : 40));
  return html`
    <section class="card card-pad cost-lead">
      <p>${c.summary}</p>
      <button type="button" class="ghost-btn" onClick=${() => go("/assistant", t("今年哪些費用科目比往年同期增加最多？可能的原因是什麼？建議怎麼處理？", "Which expense categories grew most against the same period in past years? What are the likely causes and what should we do?"))}><${Icon} name="spark" size=${14} />${t("請 AI 解釋成本變化", "Ask AI about cost changes")}</button>
      <div class="fine">${t("示範用合成明細，供應商與人名皆為虛構", "Synthetic demo lines; all vendor and personal names are fictional")}<${Info} label=${t("關於示範明細", "About the demo lines")}><p>${t("明細由模擬的月支出分攤產生，不是實際發票或採購單；每月合計與月支出完全對帳。異常標記僅供人工覆核，不代表違規判定。",
        "Lines are allocated from the simulated monthly actuals, not real invoices or POs; each month reconciles exactly to the monthly actual. Flags are for human review only, not a finding of wrongdoing.")}</p></${Info}></div>
    </section>
    <section class="card kpis">
      <div class="kpi"><div class="kpi-label">${t("已入帳費用明細", "Expense lines posted")}</div><div class="kpi-value num">${c.lineCount.toLocaleString("en-US")}${t(html`<small> 筆</small>`, "")}</div>
        <div class="kpi-sub">${t("合計", "Total")} <span class="num">${fmc(c.total)}</span> · ${t(`截至 ${c.cutoff} 月`, `through ${mon(c.cutoff)}`)}</div></div>
      <div class="kpi"><div class="kpi-label">${t("明顯高於往年同期的科目", "Categories well above past years")}</div><div class=${"kpi-value num" + (flagged.length ? " c-watch" : "")}>${flagged.length}${t(html`<small> 項</small>`, "")}</div>
        <div class="kpi-sub">${flagged.length ? html`${t("最高", "Largest")} <span class="num">+${Math.round(flagged[0].pct)}%</span> · ${dn(flagged[0].dept)} ${flagged[0].account}` : t("沒有符合篩選規則的科目", "None meets the screening rule")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("專案支出占比", "Project share of spend")}</div><div class="kpi-value num">${pct(projShare, false, 0)}</div>
        <div class="kpi-sub">${c.projects.length ? t(`${new Set(c.projects.map((p) => p.label)).size} 個專案 · 其餘為日常營運`, `${new Set(c.projects.map((p) => p.label)).size} projects · the rest is routine operations`) : t("今年沒有專案支出", "No project spending this year")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("待覆核重複憑證", "Duplicate vouchers to review")}</div><div class=${"kpi-value num" + (c.duplicates.length ? " c-watch" : "")}>${c.duplicates.length}${t(html`<small> 筆</small>`, "")}</div>
        <div class="kpi-sub">${c.duplicates.length ? html`${t("合計", "Total")} <span class="num">${fmc(dupTotal)}</span>` : t("未發現重複", "None found")}</div></div>
    </section>
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("哪些科目比往年同期花得多？", "Which categories are spending more than in past years?")}</h2>
        <${Info}><p>${t(`篩選條件：截至 ${c.cutoff} 月，比往年同期平均高至少 25%，且增加金額超過 ${fmc(c.drivers.floor)}。`, `Shown when, through ${mon(c.cutoff)}, a category is at least 25% and ${fmc(c.drivers.floor)} above its past-year same-period average.`)}</p><p>${t("往年同期＝過去每一年 1 月到同一個月的合計，再取平均。", "Past-year average = each prior year's total for the same months, averaged.")}</p></${Info}></div>
      ${!c.drivers.hasHistory ? html`<div class="callout warn"><${Icon} name="alert" size=${16} />${t("所選年度沒有可比較的往年資料。", "No prior-year data is available for comparison.")}</div>`
        : flagged.length ? html`<div class="driver-grid">${flagged.slice(0, 3).map((r) => {
          return html`<div class="driver">
            <div class="who">${dn(r.dept)} · ${r.account}</div>
            <div class="big num c-watch">+${pct(r.pct, false, 0)}</div>
            <div class="sub">${t("本期", "Current")} <b class="num">${fmc(r.amount)}</b> · ${t("往年同期", "Past years")} <span class="num">${fmc(r.hist)}</span></div>
          </div>`;
        })}</div>
        <p class="hint">${t("以上項目請核對合約、採購單與專案需求。", "Check contracts, POs and project needs for the items above.")}${flagged.length > 3 ? html` ${t(`另有 ${flagged.length - 3} 項符合規則：`, `${flagged.length - 3} more meet the rule: `)}${list(flagged.slice(3).map((r) => `${dn(r.dept)} ${r.account} +${Math.round(r.pct)}%`))}` : null}</p>`
        : html`<div class="callout ok"><${Icon} name="check" size=${16} />${t("目前沒有符合篩選規則的高成本驅動項目。", "No cost driver currently meets the screening rule.")}</div>`}
      ${c.drivers.hasHistory ? html`<details class="more"><summary>${t(`查看全部 ${c.drivers.rows.length} 個科目比較`, `View all ${c.drivers.rows.length} category comparisons`)}</summary>
        <div class="table-wrap"><table class="static">
          <thead><tr><th>${t("部門", "Department")}</th><th>${t("會計科目", "Category")}</th><th class="r">${t("本期", "Current")}</th><th class="r">${t("往年同期平均", "Past-year average")}</th><th class="r">${t("增加", "Increase")}</th><th class="r">${t("增幅", "Change")}</th></tr></thead>
          <tbody>${c.drivers.rows.map((r) => html`<tr>
            <td><div class="dept-cell">${dn(r.dept)}</div></td>
            <td>${r.gl} ${r.account}</td><td class="r num">${wan(r.amount)}</td>
            <td class="r num">${r.hist == null ? "—" : wan(r.hist)}</td><td class="r num">${r.variance == null ? "—" : wan(r.variance, true)}</td>
            <td class=${"r num" + (r.flag ? " c-watch" : "")}>${r.pct == null ? "—" : pct(r.pct, true)}</td>
          </tr>`)}</tbody>
        </table></div>
        <p class="hint">${unit()}</p>
      </details>` : null}
    </section>
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("錢花在哪裡？", "Where is the money going?")}</h2>
        <${Info}><p>${costDrillHint(drill, c)}</p><p>${t("分析對象是部門、成本中心、專案與供應商，不對個人排名。", "Analysis is by department, cost centre, project and vendor, never by individual.")}</p></${Info}>
        <div class="seg right" role="group" aria-label=${t("費用維度", "Dimension")}>${DRILLS().map(([k, label]) => html`<button type="button" aria-pressed=${drill === k} onClick=${() => pick(k)}>${label}</button>`)}</div></div>
      ${drill === "project" && !c.projects.length ? html`<div class="callout ok"><${Icon} name="check" size=${16} />${t("今年目前沒有專案支出；支出 100% 為日常營運。", "No project spending this year; 100% is routine operations.")}</div>`
        : html`<${EChart} key=${drill} option=${drillOpt} height=${drillHeight} label=${t("費用分布", "Spending breakdown")} />`}
    </section>
    <section class="stack">
      <div class="card">
        <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("已標記事件", "Tagged events")}</h2>
          <span class="card-sub">${t("一次性支出只計已發生金額，不延伸到未來月份", "One-off amounts stay in actuals and are not extrapolated")}</span></div></div>
        ${c.events.length ? html`<div class="table-wrap"><table class="static">
          <thead><tr><th>${t("部門", "Department")}</th><th>${t("事件", "Event")}</th><th>${t("類型", "Type")}</th><th>${t("月份", "Months")}</th><th class="r">${t("一次性金額", "One-off")}</th></tr></thead>
          <tbody>${c.events.map((e) => html`<tr>
            <td><div class="dept-cell">${dn(e.dept)}</div></td>
            <td>${e.event}</td><td><span class="tag plain">${e.oneOff ? t("一次性", "One-off") : t("經常性", "Recurring")}</span></td>
            <td class="num">${e.from === e.to ? mon(e.from) : `${mon(e.from)}–${mon(e.to)}`}</td>
            <td class="r num">${e.oneOff ? fmc(e.oneOff) : html`<span class="text-muted">—</span>`}</td>
          </tr>`)}</tbody>
        </table></div>` : html`<p class="hint card-foot">${t("所選年度沒有標記事件。", "No events are tagged for this year.")}</p>`}
      </div>
      <div class="card">
        <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("可能重複的費用明細", "Possible duplicate expense lines")}</h2>
          <${Info}><p>${t("比對同月份、部門、科目、供應商與憑證號碼都相同的明細。結果僅供人工覆核，不取代正式稽核。", "Flags lines that share month, department, category, vendor and voucher number. For human review only; not a substitute for an audit.")}</p></${Info}>
          ${c.duplicates.length ? html`<span class="card-sub c-watch">${t(`${c.duplicates.length} 筆憑證號碼相同，合計 ${fmc(dupTotal)}，請人工覆核`, `${c.duplicates.length} lines share a voucher number (${fmc(dupTotal)}); please review`)}</span>` : null}</div></div>
        ${c.duplicates.length ? html`
          <div class="table-wrap"><table class="static">
            <thead><tr><th>${t("憑證號碼", "Voucher")}</th><th>${t("部門", "Department")}</th><th>${t("供應商", "Vendor")}</th><th>${t("採購單號", "PO")}</th><th class="r">${t("金額（元）", "Amount (NT$)")}</th></tr></thead>
            <tbody>${c.duplicates.map((l) => html`<tr><td class="num">${l.id}</td><td>${dn(l.dept)}</td><td>${l.vendor}</td><td class="num">${l.po}</td><td class="r num">${yuan(l.amount)}</td></tr>`)}</tbody>
          </table></div>`
          : html`<div class="callout ok card-foot"><${Icon} name="check" size=${16} />${t("未找到符合重複條件的明細。", "No lines matched the duplicate screening rule.")}</div>`}
      </div>
    </section>
    <section class="card">
      <div class="card-pad table-head">
        <div class="card-head"><h2 class="card-title">${t("費用明細帳", "Expense ledger")}</h2>
          <${Info}><p>${t("經辦人欄位僅供內控與稽核追蹤，不作為個人績效評比。", "The handler field is for internal-control traceability only, not performance review.")}${state.role === "fpa" ? t("財務分析師身分看到的姓名已遮罩。", " Names are masked for the FP&A role.") : ""}</p></${Info}>
          <span class="card-sub">${t(`逐筆發票層級 · 單筆 ${fmc(c.approvalLimit)} 以上需財務長核准`, `Invoice level · lines of ${fmc(c.approvalLimit)} or more need CFO approval`)}</span></div>
        <div class="ledger-tools">
          ${multi ? html`<${Select} label=${t("部門", "Department")} value=${fDept} onChange=${setFDept}
            options=${[{ value: "", label: t("全部部門", "All departments") }, ...data.departments.map((d) => ({ value: d.name, label: dn(d.name) }))]} />` : null}
          <${Select} label=${t("會計科目", "Category")} value=${fAcct} onChange=${setFAcct}
            options=${[{ value: "", label: t("全部科目", "All categories") }, ...accounts.map(([gl, name]) => ({ value: gl, label: `${gl} ${name}` }))]} />
          <input type="search" placeholder=${t("搜尋憑證、採購單、供應商、摘要或專案", "Search voucher, PO, vendor, description or project")} value=${query} onInput=${(e) => setQuery(e.target.value)} />
          <label><input type="checkbox" checked=${cfoOnly} onChange=${(e) => setCfoOnly(e.target.checked)} />${t("只看需財務長核准", "CFO-approval lines only")}</label>
          <button type="button" class=${"ghost-btn export-btn" + (xlsx === "error" ? " err" : "")} disabled=${xlsx === "busy" || !lines.length} onClick=${exportXlsx}
            title=${t("依目前篩選條件匯出 Excel（含匯出說明頁）", "Export the filtered lines to Excel (with an About sheet)")}>
            <${Icon} name=${xlsx === "error" ? "alert" : "download"} size=${14} />${xlsx === "busy" ? t("匯出中…", "Exporting…") : xlsx === "error" ? t("匯出失敗，請再試一次", "Export failed, try again") : t(`匯出 Excel（${lines.length.toLocaleString("en-US")} 筆）`, `Export Excel (${lines.length.toLocaleString("en-US")})`)}</button>
        </div>
        <p class="hint">${t(`共 ${lines.length.toLocaleString("en-US")} 筆，合計 ${fmc(lineTotal)}`, `${lines.length.toLocaleString("en-US")} lines totalling ${fmc(lineTotal)}`)}${lines.length ? t("，由新到舊排列。", ", newest first.") : t("。", ".")}</p>
      </div>
      ${lines.length ? html`<div class="table-wrap"><table class="static ledger">
        <thead><tr><th>${t("日期", "Date")}</th><th>${t("憑證號碼", "Voucher")}</th>${multi ? html`<th>${t("部門", "Department")}</th>` : null}<th>${t("成本中心", "Cost centre")}</th><th>${t("科目", "GL account")}</th>
          <th>${t("供應商", "Vendor")}</th><th>${t("摘要", "Description")}</th><th>${t("專案", "Project")}</th><th>${t("經辦人", "Handled by")}</th><th>${t("核准層級", "Approval")}</th><th class="r">${t("金額（元）", "Amount (NT$)")}</th></tr></thead>
        <tbody>${lines.slice(0, shown).map((l) => html`<tr>
          <td class="num">${l.date}</td><td class="num">${l.id}</td>${multi ? html`<td>${dn(l.dept)}</td>` : null}<td>${l.cc}</td><td>${l.gl} ${l.account}</td>
          <td>${l.vendor}</td><td class="memo">${l.memo}</td><td>${l.project}</td><td>${l.handler}</td>
          <td>${l.cfo ? html`<span class="tag plain">${t("財務長", "CFO")}</span>` : t("部門主管", "Dept head")}</td><td class="r num">${yuan(l.amount)}</td>
        </tr>`)}</tbody>
      </table></div>
      ${lines.length > shown ? html`<div class="ledger-more"><button type="button" class="ghost-btn" onClick=${() => setShown(shown + LEDGER_PAGE)}>${t(`再顯示 ${Math.min(LEDGER_PAGE, lines.length - shown)} 筆（已顯示 ${shown} / ${lines.length}）`, `Show ${Math.min(LEDGER_PAGE, lines.length - shown)} more (${shown} of ${lines.length})`)}</button></div>` : null}`
        : html`<p class="hint card-foot">${t("沒有符合條件的明細。", "No lines match these filters.")}</p>`}
    </section>`;
}

function Forecast({ data, state, theme, go }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("forecastTab") || "forecast"; } catch (e) { return "forecast"; } });
  const [openId, setOpenId] = useState(null);
  const pick = (k) => { setTab(k); try { sessionStorage.setItem("forecastTab", k); } catch (e) {} };
  const alerts = data.departments.filter((d) => d.statusKey !== "ok").length;
  const dept = openId && data.departments.find((d) => d.id === openId);
  return html`<div class="content">
    <div class="page-intro">
      <div class="tabs" role="tablist" aria-label=${t("預測與預警", "Forecast & alerts")}>${FORECAST_TABS().map(([k, label]) => html`<button type="button" role="tab" aria-selected=${tab === k} onClick=${() => pick(k)}>
        ${label}${k === "alerts" && alerts ? html`<span class="count num">${alerts}</span>` : null}</button>`)}</div>
    </div>
    <div class="stack" key=${tab}>
      ${tab === "forecast" ? html`<${ForecastTab} data=${data} theme=${theme} openDept=${setOpenId} />`
        : tab === "alerts" ? html`<${AlertsTab} data=${data} state=${state} openDept=${setOpenId} go=${go} />`
        : tab === "costs" ? html`<${CostsTab} data=${data} state=${state} theme=${theme} go=${go} />`
        : html`<${ReplayTab} state=${state} theme=${theme} />`}
    </div>
    ${dept ? html`<${Drawer} dept=${dept} data=${data} theme=${theme} close=${() => setOpenId(null)} go=${go} />` : null}
  </div>`;
}

// ===== 情境與資料品質 =====
// 各部門對通膨、匯率的曝險（與 Streamlit 版相同）；業務量曝險：資訊部 70%，其他 85%
const EXPOSURE = {
  資訊部: [0.65, 0.45], 行銷部: [0.80, 0.20], 核保部: [0.45, 0.15], 理賠部: [0.55, 0.10],
  精算部: [0.50, 0.25], 財務部: [0.60, 0.20], 人資行政部: [0.55, 0.15], 法遵風控部: [0.70, 0.20],
};
const SCENARIO_PRESETS = [
  { label: ["通膨升溫", "Inflation up"], v: { infl: 3, vol: 0, fx: 0 } },
  { label: ["業務擴張", "Business growth"], v: { infl: 0, vol: 10, fx: 0 } },
  { label: ["台幣貶值", "Weaker TWD"], v: { infl: 0, vol: 0, fx: 8 } },
  { label: ["壓力測試", "Stress test"], v: { infl: 3, vol: 10, fx: 8 } },
];
const SLIDERS = [
  { k: "infl", label: ["額外通膨變動", "Additional inflation"], min: -5, max: 15, step: 0.5, hint: ["行銷、法遵的外部採購比例高，受影響最大", "Marketing and Compliance buy most externally, so they move most"] },
  { k: "vol", label: ["業務量變動", "Business volume"], min: -20, max: 30, step: 1, hint: ["保單件數、理賠量增加時，變動成本跟著上升", "More policies and claims raise variable costs"] },
  { k: "fx", label: ["匯率變動（台幣貶值為正）", "FX change (weaker TWD = +)"], min: -20, max: 20, step: 1, hint: ["資訊部的雲端與授權費以外幣計價，曝險最高", "IT's cloud and licence fees are in foreign currency, the highest exposure"] },
];

function scenarioRows(data, s, th) {
  return data.departments.map((d) => {
    const [inf, fx] = EXPOSURE[d.name] || [0.6, 0.2];
    const factor = 1 + (s.infl / 100) * inf + (s.vol / 100) * (d.name === "資訊部" ? 0.7 : 0.85) + (s.fx / 100) * fx;
    // 情境只影響尚未發生的剩餘月份，已發生支出不變
    const forecast = d.actualYtd + (d.forecast - d.actualYtd) * factor;
    const use = (forecast / d.budget) * 100;
    const key = use > th.high ? "high" : use > th.watch ? "watch" : use < th.lag ? "lag" : "ok";
    return { ...d, sForecast: forecast, sVariance: forecast - d.budget, sKey: key };
  });
}

function pairTransfers(rows) {
  // 情境下結餘最多的部門，依序配對缺口最大的部門
  const donors = rows.filter((r) => r.sVariance < 0).map((r) => ({ r, left: -r.sVariance })).sort((a, b) => b.left - a.left);
  const needs = rows.filter((r) => r.sVariance > 0).sort((a, b) => b.sVariance - a.sVariance);
  const out = [];
  for (const rec of needs) {
    let need = rec.sVariance;
    for (const d of donors) {
      const amount = Math.min(need, d.left);
      if (amount > 0) { out.push({ from: d.r, to: rec, amount }); d.left -= amount; need -= amount; }
      if (need <= 0) break;
    }
  }
  const uncovered = Math.max(0, needs.reduce((s, r) => s + r.sVariance, 0) - out.reduce((s, x) => s + x.amount, 0));
  return { out, uncovered };
}

function scenarioOption(rows) {
  const sorted = [...rows].sort((a, b) => a.sVariance - b.sVariance);
  const tone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" };
  const o = baseChart();
  o.grid = { left: 8, right: 64, top: 30, bottom: 4, containLabel: true };
  o.legend = { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.tooltip = { ...o.tooltip, trigger: "axis", axisPointer: SHADOW_POINTER() };
  o.tooltip.formatter = (ps) => `<b>${ps[0].axisValue}</b><br>` + ps.map((p) => `${p.marker}${p.seriesName}　<b>${fmc(p.value, true)}</b>`).join("<br>");
  o.xAxis = { type: "value", splitLine: { lineStyle: { color: css("--divider") } }, ...moneyScale(sorted.flatMap((r) => [r.variance, r.sVariance])), axisLabel: { color: css("--muted"), formatter: moneyAxis, hideOverlap: true } };
  o.yAxis = { type: "category", data: sorted.map((r) => dn(r.name)), axisTick: { show: false }, axisLine: { lineStyle: { color: css("--text") } }, axisLabel: { color: css("--text-2") } };
  o.series = [
    { name: t("目前預測", "Current forecast"), type: "bar", barMaxWidth: 12, barGap: "15%", data: sorted.map((r) => r.variance), itemStyle: { color: css("--series-muted"), borderRadius: 4 } },
    { name: t("情境假設下", "Under scenario"), type: "bar", barMaxWidth: 12, data: sorted.map((r) => ({ value: Math.round(r.sVariance), itemStyle: { color: css(tone[r.sKey]), borderRadius: 4 } })),
      label: { show: true, position: "right", formatter: (p) => fmc(p.value, true), color: css("--text-2"), fontSize: 11 } },
  ];
  return o;
}

function TransferDraft({ tr, s, year, depts, ds, close }) {
  const [reason, setReason] = useState(t("依據目前年底預測與情境分析，建議調整部門預算；實際金額及專案承諾須由主管覆核。",
    "Based on the current year-end forecast and scenario analysis. A manager must review the final amount and project commitments."));
  const [pdf, setPdf] = useState("idle"); // idle | busy | error
  const idx = (d) => String(depts.indexOf(d.id) + 1).padStart(2, "0");
  const no = `TR-${year}-${idx(tr.from)}${idx(tr.to)}-${String(Math.floor(tr.amount / 1e4) % 10000).padStart(4, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  const sign = (v) => `${v > 0 ? "+" : ""}${v}%`;
  const row = (d) => `${fmc(d.sForecast)} / ${fmc(d.budget)} (${pct((d.sVariance / d.budget) * 100, true)})`;
  // 申請單出現在圖表下方，打開時捲到畫面中，否則使用者會以為按鈕沒反應
  const doc = useRef(null);
  useEffect(() => { doc.current && doc.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, []);
  const download = async () => {
    setPdf("busy");
    try {
      const body = { year, lang: LANG, ds: ds || "", no, date: today, fromDept: tr.from.name, toDept: tr.to.name, amount: Math.round(tr.amount),
        fromForecast: Math.round(tr.from.sForecast), fromBudget: tr.from.budget, toForecast: Math.round(tr.to.sForecast), toBudget: tr.to.budget,
        infl: s.infl, vol: s.vol, fx: s.fx, reason };
      await saveResponse(await fetch("/api/transfer.pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), `${no}.pdf`);
      setPdf("idle");
    } catch (e) {
      setPdf("error");
      setTimeout(() => setPdf("idle"), 4000);
    }
  };
  return html`<section class="card print-doc" ref=${doc} aria-label=${t("調撥申請單草稿", "Transfer request draft")}>
    <div class="doc-head">
      <div><div class="doc-title">${t("預算調撥申請單", "Budget transfer request")}</div><div class="card-sub">${t("草稿 · 待人工覆核與核准", "Draft · pending review and approval")}</div></div>
      <div class="doc-meta num">${no}<br />FY${year} · ${t("申請日期", "Date")} ${today}</div>
    </div>
    <dl class="doc-fields">
      <dt>${t("調出部門", "From department")}</dt><dd>${dn(tr.from.name)}</dd>
      <dt>${t("調入部門", "To department")}</dt><dd>${dn(tr.to.name)}</dd>
      <dt>${t("建議調撥金額上限", "Suggested amount cap")}</dt><dd class="num"><b>${fmc(tr.amount)}</b></dd>
      <dt>${t("調出部門 年底預測／預算", "From: forecast / budget")}</dt><dd class="num">${row(tr.from)}</dd>
      <dt>${t("調入部門 年底預測／預算", "To: forecast / budget")}</dt><dd class="num">${row(tr.to)}</dd>
      <dt>${t("情境假設", "Scenario")}</dt><dd class="num">${t("通膨", "Inflation")} ${sign(s.infl)} · ${t("業務量", "Volume")} ${sign(s.vol)} · ${t("匯率", "FX")} ${sign(s.fx)}</dd>
    </dl>
    <label class="section-title" for="reason">${t("申請原因", "Rationale")}</label>
    <textarea id="reason" class="doc-reason" rows="3" value=${reason} onInput=${(e) => setReason(e.target.value)}></textarea>
    <div class="doc-print-reason">${reason}</div>
    <div class="signs">${[t("申請人", "Requester"), t("調出部門主管", "From-dept head"), t("調入部門主管", "To-dept head"), t("財務長", "CFO")].map((x) => html`<div><span></span>${x}</div>`)}</div>
    <p class="hint">${t("此文件僅為申請草稿：下載 PDF 不會變更任何預算，也不會送出簽核。", "Draft only: downloading the PDF does not change any budget or submit an approval.")}</p>
    <div class="doc-actions">
      <button type="button" class=${"btn-primary" + (pdf === "error" ? " err" : "")} disabled=${pdf === "busy"} onClick=${download}>
        <${Icon} name=${pdf === "error" ? "alert" : "download"} size=${16} />${pdf === "busy" ? t("產生中…", "Preparing…") : pdf === "error" ? t("下載失敗，請再試一次", "Download failed, try again") : t("下載申請單 PDF", "Download request PDF")}</button>
      <button type="button" class="ghost-btn" onClick=${() => window.print()}>${t("列印", "Print")}</button>
      <button type="button" class="ghost-btn" onClick=${close}>${t("關閉", "Close")}</button>
    </div>
  </section>`;
}

function ScenarioTab({ data, meta, theme, setYear }) {
  const [s, setS] = useState(() => { try { return JSON.parse(sessionStorage.getItem("scenario")) || { infl: 0, vol: 0, fx: 0 }; } catch (e) { return { infl: 0, vol: 0, fx: 0 }; } });
  const [draft, setDraft] = useState(null);
  const update = (v) => { setS(v); setDraft(null); try { sessionStorage.setItem("scenario", JSON.stringify(v)); } catch (e) {} };
  const rows = useMemo(() => scenarioRows(data, s, data.thresholds), [data, s]);
  const opt = useMemo(() => scenarioOption(rows), [rows, theme]);
  const { out, uncovered } = useMemo(() => pairTransfers(rows), [rows]);
  const tt = data.totals;
  const sTotal = rows.reduce((a, r) => a + r.sForecast, 0);
  const sVar = sTotal - tt.budget, baseUse = tt.usePct, sUse = (sTotal / tt.budget) * 100;
  const overN = rows.filter((r) => r.sVariance > 0).length, baseN = tt.overCount;
  const active = s.infl || s.vol || s.fx;
  const fmtS = (k, v) => (v > 0 ? "+" : "") + (k === "infl" ? v.toFixed(1) : v) + "%";
  if (data.cutoff >= 12) {
    // 已結算完整年度沒有「尚未發生的月份」，情境假設不會改變任何數字，與其顯示一頁不會動的滑桿，不如說明並引導到最新年度
    const latest = meta.cutoff.year;
    return html`<div class="card empty">
      <h2>${t(`FY${data.year} 的 12 個月都已結算，沒有可以套用情境的月份`, `All 12 months of FY${data.year} are closed, so there is nothing left for a scenario to change`)}</h2>
      <p>${t("情境假設只影響尚未發生的月份；已發生的支出不會因通膨、業務量或匯率假設而改變。", "Scenarios only affect months that have not happened yet; spending already incurred does not change.")}</p>
      ${latest !== data.year ? html`<button type="button" class="btn-primary" onClick=${() => setYear(latest)}>${t(`改看 FY${latest}（資料截至 ${meta.cutoff.month} 月）`, `Switch to FY${latest} (data through ${mon(meta.cutoff.month)})`)}</button>` : null}
    </div>`;
  }
  return html`
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("情境假設", "Scenario assumptions")}</h2>
        <${Info}><p>${t("情境結果是規劃估算，不是現金流預測；各部門受通膨、業務量與匯率影響的程度不同。", "Scenario results are planning estimates, not cash-flow forecasts; each department is exposed differently to inflation, volume and FX.")}</p></${Info}>
        <span class="card-sub">${t(`只影響尚未發生的 ${data.cutoff + 1}–12 月；已發生支出不變`, `Affects only ${mon(data.cutoff + 1)}–Dec; spending already incurred is unchanged`)}</span>
        <div class="right prompts">${SCENARIO_PRESETS.map((p) => html`<button type="button" class=${"prompt" + (JSON.stringify(p.v) === JSON.stringify(s) ? " on" : "")} onClick=${() => update(p.v)}>${t(...p.label)}</button>`)}
          <button type="button" class="prompt" disabled=${!active} onClick=${() => update({ infl: 0, vol: 0, fx: 0 })}>${t("重設", "Reset")}</button></div></div>
      <div class="sliders">${SLIDERS.map((c) => html`<div class="slider">
        <div class="slider-top"><label for=${"sl-" + c.k}>${t(...c.label)}</label><b class=${"num " + (s[c.k] > 0 ? "c-high" : s[c.k] < 0 ? "c-ok" : "")}>${fmtS(c.k, s[c.k])}</b></div>
        <input id=${"sl-" + c.k} type="range" min=${c.min} max=${c.max} step=${c.step} value=${s[c.k]}
          style=${{ "--p": ((s[c.k] - c.min) / (c.max - c.min)) * 100 + "%" }} onInput=${(e) => update({ ...s, [c.k]: Number(e.target.value) })} />
        <div class="slider-range num"><span>${c.min}%</span><span>${t(...c.hint)}</span><span>+${c.max}%</span></div>
      </div>`)}</div>
    </section>
    <section class="card kpis">
      <div class="kpi"><div class="kpi-label">${t("原本：年底預算使用率", "Before: year-end budget use")}</div><div class="kpi-value num">${pct(baseUse)}</div><div class="kpi-sub">${t("預測", "Forecast")} <span class="num">${fmc(tt.forecast)}</span> · ${t("未套用情境", "no scenario")}</div></div>
      <div class="kpi"><div class="kpi-label">${t("套用情境後：預算使用率", "With scenario: budget use")}</div><div class=${"kpi-value num " + (sUse > 100 ? "c-high" : "")}>${pct(sUse)}</div>
        <div class="kpi-sub">${Math.abs(sUse - baseUse) >= 0.05 ? html`<span class=${sUse > baseUse ? "up-bad" : "up-good"}>${(sUse - baseUse > 0 ? "+" : "") + (sUse - baseUse).toFixed(1)} ${t("個百分點", "pp")}</span> · ` : t("與原本相同 · ", "Same as before · ")}${t("預測", "forecast")} <span class="num">${fmc(sTotal)}</span></div></div>
      <div class="kpi"><div class="kpi-label">${sVar > 0 ? t("套用情境後：年底超支", "With scenario: overspend") : t("套用情境後：年底結餘", "With scenario: headroom")}</div><div class=${"kpi-value num " + (sVar > 0 ? "c-high" : "")}>${pct((Math.abs(sVar) / tt.budget) * 100)}</div><div class="kpi-sub">${t("約", "About")} <span class="num">${fmc(Math.abs(sVar))}</span></div></div>
      <div class="kpi"><div class="kpi-label">${t("套用情境後：超支部門", "With scenario: departments over")}</div><div class="kpi-value num">${overN}<small> / ${rows.length}</small></div>
        <div class="kpi-sub">${t(`原本 ${baseN} 個`, `before: ${baseN}`)}${overN !== baseN ? html` · <span class=${overN > baseN ? "up-bad" : "up-good"}>${overN > baseN ? "+" : ""}${overN - baseN}${t(" 個", "")}</span>` : ""}</div></div>
    </section>
    ${!active ? html`<p class="hint">${t("目前三個假設都是 0%，所以「套用情境後」與原本相同；拖動滑桿或點上方的情境即可看到影響。", "All three assumptions are 0%, so the scenario equals the current forecast; move a slider or pick a scenario above to see the impact.")}</p>` : null}
    <section class="duo">
      <div class="card card-pad">
        <div class="card-head"><h2 class="card-title">${t("情境假設下，各部門年底會超支還是有結餘？", "Under this scenario, which departments end over or under budget?")}</h2>
          <${Info}><p>${t("灰色＝目前預測，彩色＝套用情境後（顏色為情境下的燈號）。從結餘變成超支的部門，就是對這個情境最敏感的部門。", "Grey = current forecast, coloured = with the scenario (colour = scenario status). Departments that flip from headroom to overspend are the most sensitive.")}</p></${Info}></div>
        <${EChart} option=${opt} cls="chart chart-tall" label=${t("情境假設下各部門年底差異", "Year-end gap by department under the scenario")} />
      </div>
      <div class="card card-pad">
        <div class="card-head"><h2 class="card-title">${t("建議的預算調度", "Suggested reallocation")}</h2>
          <${Info}><p>${t("調撥只是建議，不會自動變更任何預算；實際金額須經主管與專案承諾覆核。", "Reallocation is a recommendation and never changes a budget automatically; managers review the final amounts.")}</p></${Info}>
          <span class="card-sub">${t("以結餘最多的部門支應缺口最大的部門", "Largest headroom funds the largest shortfall")}</span></div>
        ${out.length ? html`<div class="transfers">${out.map((x, i) => html`<div class="transfer">
            <div class="tf-route">${dn(x.from.name)}<${Icon} name="arrow" size=${14} />${dn(x.to.name)}</div>
            <div class="tf-amt num">${fmc(x.amount)}<small>${t("建議上限", "suggested cap")}</small></div>
            <button type="button" class=${"ghost-btn" + (draft === i ? " on" : "")} onClick=${() => setDraft(draft === i ? null : i)}>${draft === i ? t("收起", "Hide") : t("建立申請單", "Draft request")}</button>
          </div>`)}</div>
          ${uncovered > 0 ? html`<div class="callout warn"><${Icon} name="alert" size=${16} /><span>${t(html`內部結餘不足以完全支應，仍有 <b class="num">${fmc(uncovered)}</b> 缺口需追加預算或縮減支出。`, html`Internal headroom cannot cover everything; <b class="num">${fmc(uncovered)}</b> still needs extra budget or spending cuts.`)}</span></div>`
            : html`<div class="callout ok"><${Icon} name="check" size=${16} /><span>${t("內部結餘足以支應所有預估缺口。", "Internal headroom covers every projected shortfall.")}</span></div>`}`
        : html`<div class="empty in-card"><p>${t("依目前情境，沒有可配對的預算結餘與預測缺口。", "This scenario has no headroom that can be paired with a shortfall.")}</p></div>`}
      </div>
    </section>
    ${draft != null && out[draft] ? html`<${TransferDraft} key=${draft} tr=${out[draft]} s=${s} year=${data.year} depts=${meta.departments.map((d) => d.id)} ds=${meta.dataset.id} close=${() => setDraft(null)} />` : null}
    <section class="card">
      <div class="card-pad table-head"><div class="card-head"><h2 class="card-title">${t("情境明細", "Scenario detail")}</h2><span class="card-sub">${unit()}</span></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${t("部門", "Department")}</th><th>${t("情境燈號", "Scenario status")}</th><th class="r">${t("年度預算", "Budget")}</th><th class="r">${t("目前預測", "Current")}</th><th class="r">${t("情境預測", "Scenario")}</th><th class="r">${t("情境差異", "Scenario gap")}</th><th class="r">${t("情境影響", "Impact")}</th></tr></thead>
        <tbody>${[...rows].sort((a, b) => b.sVariance - a.sVariance).map((r) => html`<tr style="cursor:default">
          <td><div class="dept-cell">${dn(r.name)}</div></td>
          <td><span class=${"tag " + r.sKey}>${sl(r.sKey)}</span>${r.sKey !== r.statusKey ? html` <span class="card-sub">${t(`原本${r.status}`, `was ${sl(r.statusKey).toLowerCase()}`)}</span>` : null}</td>
          <td class="r num">${wan(r.budget)}</td><td class="r num">${wan(r.forecast)}</td><td class="r num"><b>${wan(r.sForecast)}</b></td>
          <td class=${"r num c-" + r.sKey}>${wan(r.sVariance, true)}</td><td class="r num">${Math.abs(r.sForecast - r.forecast) < 0.5 ? html`<span class="text-muted">—</span>` : wan(r.sForecast - r.forecast, true)}</td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;
}

function backtestOption(b) {
  const rows = [...b.byDept].reverse();
  const o = baseChart();
  o.grid = { left: 8, right: 48, top: 30, bottom: 4, containLabel: true };
  o.legend = { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: css("--text-2"), fontSize: 12 } };
  o.tooltip = { ...o.tooltip, trigger: "axis", axisPointer: SHADOW_POINTER(), formatter: (ps) => `<b>${ps[0].axisValue}</b><br>` + ps.map((p) => `${p.marker}${p.seriesName}　<b>${p.value}%</b>`).join("<br>") };
  o.xAxis = { type: "value", min: 0, splitLine: { lineStyle: { color: css("--divider") } }, axisLabel: { color: css("--muted"), formatter: "{value}%" } };
  o.yAxis = { type: "category", data: rows.map((r) => dn(r.name)), axisTick: { show: false }, axisLine: { lineStyle: { color: css("--border") } }, axisLabel: { color: css("--text-2") } };
  const lbl = (c) => ({ show: true, position: "right", formatter: "{c}%", color: css(c), fontSize: 11 });
  o.series = [
    { name: t("對照：照目前速度推估", "Benchmark: current pace"), type: "bar", barMaxWidth: 12, barGap: "15%", data: rows.map((r) => r.bench), itemStyle: { color: css("--series-muted"), borderRadius: 4 }, label: lbl("--muted") },
    { name: t("本系統預測", "This system"), type: "bar", barMaxWidth: 12, data: rows.map((r) => r.model), itemStyle: { color: css("--accent"), borderRadius: 4 }, label: lbl("--text") },
  ];
  return o;
}

function BacktestTab({ data, state, theme }) {
  const [month, setMonth] = useState(Math.min(8, Math.max(2, data.cutoff < 12 ? data.cutoff : 8)));
  const [bt, setBt] = useState(null);
  const [q, setQ] = useState(null);
  useEffect(() => { fetch("/api/quality?" + new URLSearchParams({ ds: state.ds || "", lang: state.lang || "zh" })).then((r) => r.json()).then(setQ).catch(() => {}); }, [state.ds, state.lang]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      fetch("/api/backtest?" + scopeParams(state, { year: data.year, month })).then((r) => r.json())
        .then((d) => alive && setBt(d)).catch(() => alive && setBt({ error: true }));
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [data.year, state.depts.join(","), month, state.ds, state.role]);
  const opt = useMemo(() => bt && bt.byDept && bt.byDept.length ? backtestOption(bt) : null, [bt, theme]);
  const sm = bt && bt.summary;
  const better = sm && sm.model <= sm.bench;
  return html`
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("年底預測到底準不準？", "How accurate is the year-end forecast?")}</h2>
        <${Info}><ol>
          <li>${t("回到過去某一年的某個月份（下方滑桿），只用「當時已經知道」的支出資料。", "Go back to a month in a past year (slider below), using only the spending known at that time.")}</li>
          <li>${t("用本系統預測那一年年底會花多少，同時用「照目前速度推估」當對照組。", "Forecast that year's total with this system, with a simple current-pace projection as the benchmark.")}</li>
          <li>${t("和那一年真正花掉的金額比對：誤差越小，今年的預測越值得信任。", "Compare with what was actually spent that year: the smaller the error, the more this year's forecast can be trusted.")}</li>
        </ol></${Info}>
        <span class="card-sub">${t("用過去年度回頭驗證", "Checked against past years")}</span></div>
      <div class="slider">
        <div class="slider-top"><label for="bt-month">${t("模擬預測截止月份", "Simulated forecast month")}</label><b class="num">${t(`${month} 月底`, `End of ${mon(month)}`)}</b></div>
        <input id="bt-month" type="range" min="2" max="11" step="1" value=${month} style=${{ "--p": ((month - 2) / 9) * 100 + "%" }} onInput=${(e) => setMonth(Number(e.target.value))} />
        <div class="slider-range num"><span>${mon(2)}</span><span>${t("越晚預測，已知資料越多", "Later = more data known")}</span><span>${mon(11)}</span></div>
      </div>
    </section>
    <div class="stack">${!bt ? html`<div class="skeleton" style="height:110px"></div><div class="skeleton" style="height:360px"></div>`
      : bt.error || !sm.cases ? html`<div class="card empty"><h2>${bt.error ? t("回測資料載入失敗", "Could not load the backtest") : t("所選年度之前沒有足夠的完整年度可以回測", "There are not enough complete earlier years to backtest")}</h2></div>`
      : html`
    <section class="card kpis kpis-3">
      <div class="kpi"><div class="kpi-label">${t("本系統預測誤差", "This system's forecast error")}</div>
        <div class=${"kpi-value num " + (better ? "c-ok-strong" : "c-high")}>${sm.model}%</div>
        <div class="kpi-sub">${t(`平均每 100 元差 ${sm.model} 元`, `≈ ${sm.model} off per 100`)} · <span class=${better ? "up-good" : "up-bad"}>${t(`${better ? "優於" : "劣於"}對照 ${Math.abs(sm.bench - sm.model).toFixed(1)} 個百分點`, `${Math.abs(sm.bench - sm.model).toFixed(1)} pp ${better ? "better" : "worse"} than benchmark`)}</span></div></div>
      <div class="kpi"><div class="kpi-label">${t("對照：照目前速度推估", "Benchmark: current pace")}</div><div class="kpi-value num">${sm.bench}%</div>
        <div class="kpi-sub">${t(`平均每 100 元差 ${sm.bench} 元 · 未考慮季節性`, `≈ ${sm.bench} off per 100 · no seasonality`)}</div></div>
      <div class="kpi"><div class="kpi-label">${t("驗證次數", "Test cases")}</div><div class="kpi-value num">${sm.cases}${t(html`<small> 次</small>`, "")}</div>
        <div class="kpi-sub">${t(`FY${sm.years[0]}–FY${sm.years[sm.years.length - 1]} 共 ${sm.years.length} 個年度 × ${sm.departments} 個部門`, `FY${sm.years[0]}–FY${sm.years[sm.years.length - 1]}: ${sm.years.length} years × ${sm.departments} departments`)}</div></div>
    </section>
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t(`如果在 ${bt.month} 月預測年底，各部門會差多少？`, `Forecasting the year end in ${mon(bt.month)}: how far off would each department be?`)}</h2>
        <${Info}><p>${t("誤差＝預測與實際的差距占實際支出的比例（以金額加權平均），長條越短越準。", "Error = the gap between forecast and actual as a share of actual spending (amount-weighted); shorter is better.")}</p><p>${t(`年底集中請款的部門（例如行銷、人資）若只照目前速度推估，會系統性低估；本系統加入歷史季節性修正這個偏差。${bt.byDept[0].name}預測最穩定。`,
        `Departments that spend late in the year (e.g. Marketing, HR) are systematically under-forecast by a simple pace projection; adding historical seasonality corrects this. ${dn(bt.byDept[0].name)} is the most stable.`)}</p></${Info}>
        <span class="card-sub">${t("長條越短越準", "Shorter is better")}</span></div>
      <${EChart} option=${opt} cls="chart chart-tall" label=${t("各部門回測誤差", "Backtest error by department")} />
      <details class="more">
        <summary>${t(`查看回測明細（${bt.rows.length} 筆）`, `View backtest detail (${bt.rows.length} cases)`)}</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>${t("年度", "Year")}</th><th>${t("部門", "Department")}</th><th class="r">${t("全年實際", "Actual")}</th><th class="r">${t("本系統預測", "This system")}</th><th class="r">${t("依目前速度", "Current pace")}</th><th class="r">${t("本系統誤差", "Error")}</th></tr></thead>
          <tbody>${bt.rows.map((r) => html`<tr style="cursor:default"><td class="num">FY${r.year}</td><td>${dn(r.name)}</td><td class="r num">${wan(r.actual)}</td>
            <td class="r num">${wan(r.forecast)}</td><td class="r num">${wan(r.runRate)}</td><td class="r num">${r.errPct}%</td></tr>`)}</tbody>
        </table></div>
      </details>
    </section>`}</div>
    <section class="card card-pad">
      <div class="card-head"><h2 class="card-title">${t("資料品質檢查", "Data quality checks")}</h2>
        <${Info}><p>${t("匯入 CSV 時會先檢核欄位、月份完整性與數值，可直接使用 ERP／財務系統的匯出檔。", "Imported CSVs are checked for columns, month completeness and values, so ERP or finance-system exports work directly.")}</p></${Info}>${q ? html`<span class="card-sub">${t(`${q.checks.filter((c) => c.ok).length} / ${q.checks.length} 項通過`, `${q.checks.filter((c) => c.ok).length} / ${q.checks.length} passed`)}</span>` : null}</div>
      ${q ? html`<ul class="checks">${q.checks.map((c) => html`<li>
          <span class=${"chk " + (c.ok ? "ok" : "warn")}><${Icon} name=${c.ok ? "check" : "alert"} size=${14} sw=${2.6} /></span>
          <div class="chk-body"><div class="chk-line"><span class="chk-label">${c.label}</span><span class=${"tag " + (c.ok ? "ok" : "watch")}>${c.ok ? t("通過", "Pass") : t("需檢查", "Review")}</span></div><span class="chk-detail">${c.detail}</span></div>
        </li>`)}
        <li><span class="chk muted"><${Icon} name="building" size=${14} /></span><div class="chk-body"><div class="chk-line"><span class="chk-label">${t("資料來源", "Data source")}</span></div><span class="chk-detail">${q.source}</span></div></li></ul>`
      : html`<div class="skeleton" style="height:200px"></div>`}
    </section>`;
}

function Scenarios({ data, meta, state, theme, setYear }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("scenarioTab") || "scenario"; } catch (e) { return "scenario"; } });
  const pick = (k) => { setTab(k); try { sessionStorage.setItem("scenarioTab", k); } catch (e) {} };
  return html`<div class="content">
    <div class="page-intro">
      <div class="tabs" role="tablist" aria-label=${t("情境與資料品質", "Scenarios & data quality")}>${[["scenario", t("情境與調撥", "Scenarios")], ["backtest", t("回測與資料品質", "Backtest & data quality")]].map(([k, label]) => html`
        <button type="button" role="tab" aria-selected=${tab === k} onClick=${() => pick(k)}>${label}</button>`)}</div>
    </div>
    <div class="stack" key=${tab}>
      ${tab === "scenario" ? html`<${ScenarioTab} data=${data} meta=${meta} theme=${theme} setYear=${setYear} />` : html`<${BacktestTab} data=${data} state=${state} theme=${theme} />`}
    </div>
  </div>`;
}

// ===== AI 助理 =====
const MARK_RE = /[]/g; // 伺服器用這兩個字元框出「無法對應到資料」的數字
const ASSISTANT_PROMPTS = (data) => {
  const one = soleDept(data);
  if (one) {
    const q = QUICK_PROMPTS(data);
    return [
      { icon: "alert", tag: t("風險", "Risk"), q: q[0] },
      { icon: "trend", tag: t("比較", "Compare"), q: q[1] },
      { icon: "swap", tag: t("月份", "Months"), q: t(`${one}剩下幾個月每月大約可以花多少？`, `Roughly how much can ${dn(one)} spend per month for the rest of the year?`) },
      { icon: "target", tag: t("目標", "Target"), q: q[2] },
    ];
  }
  return ASSISTANT_PROMPTS_ALL();
};
const ASSISTANT_PROMPTS_ALL = () => [
  { icon: "alert", tag: t("風險", "Risk"), q: t("超支風險最高的部門是哪些？原因是什麼？", "Which departments are most at risk of overspending, and why?") },
  { icon: "trend", tag: t("比較", "Compare"), q: t("資訊部今年的花費和去年比差在哪？", "How does IT's spending this year compare with last year?") },
  { icon: "swap", tag: t("調撥", "Reallocate"), q: t("建議如何把執行落後部門的結餘調撥給超支部門？", "How should we move unused budget from departments behind plan to those overspending?") },
  { icon: "target", tag: t("目標", "Target"), q: t("若年底要省下 5% 總支出，該從哪裡調整？", "If we need to cut total spending by 5% by year end, where should we adjust?") },
];

function md(text) {
  // 只支援回答會用到的語法（標題、清單、粗體），先跳脫 HTML，避免模型輸出被當成標籤執行
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(//g, '<mark title="' + t("這個數字無法對應到系統資料，請再確認", "This number could not be traced to the system data; please double-check") + '">').replace(//g, "</mark>");
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)$/))) { flush(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^[-*•]\s+(.*)$/)) || (m = line.match(/^\d+[.)]\s+(.*)$/))) {
      const tag = /^\d/.test(line) ? "ol" : "ul";
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
      list.items.push(inline(m[1]));
      continue;
    }
    flush();
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}

const STATUS_BY_USE = (use) => (use > TH.high ? "high" : use > TH.watch ? "watch" : use < TH.lag ? "lag" : "ok");
function forecastVarOption(data) {
  const rows = [...data.departments].sort((a, b) => a.variance - b.variance);
  const tone = { high: "--high", watch: "--watch", lag: "--lag", ok: "--ok" };
  const o = baseChart();
  o.grid = { left: 8, right: 56, top: 8, bottom: 4, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: "item", formatter: (p) => `<b>${p.name}</b><br>${t("年底預估差異", "Year-end gap")}　<b>${fmc(p.value, true)}</b>` };
  o.xAxis = { type: "value", splitLine: { lineStyle: { color: css("--divider") } }, ...moneyScale(rows.map((d) => d.variance)), axisLabel: { color: css("--muted"), formatter: moneyAxis, hideOverlap: true } };
  o.yAxis = { type: "category", data: rows.map((d) => dn(d.name)), axisTick: { show: false }, axisLine: { lineStyle: { color: css("--border") } }, axisLabel: { color: css("--text-2") } };
  o.series = [{
    type: "bar", barMaxWidth: 16,
    data: rows.map((d) => ({ value: d.variance, itemStyle: { color: css(tone[d.statusKey]), borderRadius: d.variance > 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: "right", formatter: (p) => fmc(p.value, true), color: css("--text-2"), fontSize: 11 },
  }];
  return o;
}

function ChatChart({ spec, data, theme }) {
  const built = useMemo(() => {
    if (!spec) return null;
    if (spec.type === "forecast") return { title: t("各部門年底預估差異", "Year-end gap by department"), option: forecastVarOption(data) };
    const dept = spec.department && data.departments.find((d) => d.name === spec.department);
    if (spec.type === "monthly" && dept) return { title: t(`${dept.name}每月實際與預估`, `${dn(dept.name)}: monthly actual and estimate`), option: deptMonthlyOption(dept) };
    if (spec.type === "history") {
      const src = dept || {
        history: data.history.map((h) => ({ year: h.year, use: Math.round((h.actual / h.budget) * 1000) / 10 })),
        usePct: data.totals.usePct, statusKey: STATUS_BY_USE(data.totals.usePct),
      };
      return { title: t(`${dept ? dept.name : "選取部門合計"}歷年預算使用率`, `${dept ? dn(dept.name) : "Selected departments"}: budget use by year`), option: deptHistoryOption(src, data.year) };
    }
    return null;
  }, [spec, data, theme]);
  if (!built) return null;
  return html`<figure class="chat-chart">
    <figcaption>${built.title}<span>FY${data.year} · ${t("系統資料繪製", "drawn from system data")}</span></figcaption>
    <${EChart} option=${built.option} cls="chart-sm" label=${built.title} />
  </figure>`;
}

function CheckBadge({ check }) {
  if (!check) return null;
  const ok = check.exact + check.derived;
  if (!ok && !check.unmatched) return null;
  return html`<span class=${"check-badge " + (check.unmatched ? "warn" : "ok")} title=${t("回答中的每個金額與百分比，都會回頭比對系統資料", "Every amount and percentage in the answer is checked against the system data")}>
    <${Icon} name="shield" size=${14} />${t(`數字查核：${ok} 個與資料一致`, `Number check: ${ok} match the data`)}${check.unmatched ? t(`，${check.unmatched} 個無法對應（已標示）`, `, ${check.unmatched} could not be traced (highlighted)`) : ""}
  </span>`;
}

function sourceText(m) {
  if (m.mode === "ai") return t(`由 ${m.source} 回答`, `Answered by ${m.source}`);
  if (m.mode === "fallback") return t("AI 服務暫時忙碌，改由系統直接回答", "AI service busy; answered directly by the system");
  if (m.mode === "limited") return t("使用次數暫時達上限，改由系統直接回答，約一分鐘後可再用 AI", "Usage limit reached; answered by the system. AI is available again in about a minute");
  return t("內建規則回答", "Answered by built-in rules");
}

function Message({ m, data, theme, retry }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") return html`<div class="msg user"><div class="bubble">${m.content}</div></div>`;
  if (m.error) {
    return html`<div class="msg bot"><div class="bot-mark"><${Icon} name="spark" size=${16} /></div><div class="bot-body">
      <p class="err">${m.error}</p><button type="button" class="ghost-btn" onClick=${retry}>${t("重新送出", "Try again")}</button>
    </div></div>`;
  }
  const copy = () => {
    try {
      navigator.clipboard.writeText(m.content.replace(MARK_RE, "").replace(/\*\*/g, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    } catch (e) {}
  };
  return html`<div class="msg bot">
    <div class="bot-mark"><${Icon} name="spark" size=${16} /></div>
    <div class="bot-body">
      <div class="md" dangerouslySetInnerHTML=${{ __html: md(m.content) }}></div>
      ${m.chart && data ? html`<${ChatChart} spec=${m.chart} data=${data} theme=${theme} />` : null}
      <div class="msg-meta">
        <${CheckBadge} check=${m.check} />
        <span class="src">${sourceText(m)}</span>
        <button type="button" class="ghost-btn sm" onClick=${copy}><${Icon} name=${copied ? "check" : "copy"} size=${14} />${copied ? t("已複製", "Copied") : t("複製", "Copy")}</button>
      </div>
    </div>
  </div>`;
}

// 對話依檢視身分與資料集分開存放：部門主管不會看到財務長身分問到的全公司回答
const chatKey = (s) => `chat:${s.role}:${s.role === "head" ? s.roleDept : ""}:${s.ds || ""}`;
function loadChat(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || "[]"); } catch (e) { return []; }
}
function clearChats() {
  try { Object.keys(sessionStorage).filter((k) => k === "chat" || k.startsWith("chat:")).forEach((k) => sessionStorage.removeItem(k)); } catch (e) {}
}

function Assistant({ data, state, theme }) {
  const key = chatKey(state);
  const [messages, setMessages] = useState(() => loadChat(key));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState(null);
  const log = useRef(null);
  const box = useRef(null);
  const card = useRef(null);

  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(messages)); } catch (e) {} }, [messages]);
  useEffect(() => {
    // 圖表在下一個畫面才撐開高度，所以捲到底要等一下
    const toEnd = () => log.current && (log.current.scrollTop = log.current.scrollHeight);
    toEnd();
    const timer = setTimeout(toEnd, 120);
    return () => clearTimeout(timer);
  }, [messages.length, busy]);
  useEffect(() => {
    // 逐字顯示時跟著捲動；使用者往上捲去看前文時就不打擾
    const el = log.current;
    if (el && draft && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [draft]);
  useEffect(() => {
    // 對話框填滿視窗剩餘高度；工具列在窄螢幕會換行，所以用實際位置計算而不是固定值
    const fit = () => {
      if (!card.current) return;
      const top = card.current.getBoundingClientRect().top + window.scrollY;
      card.current.style.height = Math.max(460, window.innerHeight - top - 20) + "px";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  useEffect(() => {
    fetch("/api/ai-status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ online: false, providers: [] }));
    let pending = null;
    try { pending = sessionStorage.getItem("pendingPrompt"); sessionStorage.removeItem("pendingPrompt"); } catch (e) {}
    if (pending) send(pending);
  }, []);

  async function send(text, base) {
    const q = text.trim();
    if (!q || busy) return;
    const history = (base || loadChat(key)).filter((m) => !m.error);
    const next = [...history, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setDraft("");
    const payload = { year: state.year, depts: state.depts.join(","), ds: state.ds || "", viewRole: state.role, viewDept: state.roleDept || "", lang: state.lang || "zh", th: (state.th || DEFAULT_TH).join(","), messages: next.map((m) => ({ role: m.role, content: m.content.replace(MARK_RE, "") })) };
    let a = null, shown = false;
    try {
      a = await streamPost("/api/chat/stream", payload, (text) => { shown = true; setDraft(text); });
    } catch (e) {}
    try {
      // 還沒顯示任何字就斷線時改用一次回傳；已經寫到一半就不重送，避免重複呼叫 AI
      if (!a && !shown) a = await postJson("/api/chat", payload);
      if (!a) throw new Error();
      setMessages([...next, { role: "assistant", content: a.text, mode: a.mode, source: a.source, check: a.check, chart: a.chart }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: "", error: shown ? t("回覆中斷了，請再試一次。", "The reply was cut off; please try again.") : t("連線失敗，這個問題沒有送出。", "Connection failed; the question was not sent.") }]);
    } finally {
      setDraft("");
      setBusy(false);
      box.current && box.current.focus();
    }
  }
  const retry = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) send(lastUser.content, messages.slice(0, messages.lastIndexOf(lastUser)));
  };
  const onKey = (e) => {
    // 中文輸入法選字時按 Enter 不送出
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input, messages); }
  };
  const grow = (e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; };
  const scope = `FY${data.year} · ${!state.depts.length && data.departmentCount > 1 ? t(`全部 ${data.departmentCount} 個部門`, `all ${data.departmentCount} departments`) : data.departmentCount === 1 ? dn(data.departments[0].name) : t(`${data.departmentCount} 個部門`, `${data.departmentCount} departments`)}`;
  const prompts = ASSISTANT_PROMPTS(data);

  return html`<div class="content chat-page">
    <section class="card chat" ref=${card}>
      <div class="chat-head">
        <div>
          <h2 class="card-title">${t("AI 財務助理", "AI finance assistant")}</h2>
          <div class="card-sub">${scope} · ${data.cutoff < 12 ? t(`資料截至 ${data.year}/${String(data.cutoff).padStart(2, "0")}`, `data through ${mon(data.cutoff)} ${data.year}`) : t(`FY${data.year} 全年`, `FY${data.year} full year`)}</div>
        </div>
        ${status ? html`<span class=${"conn " + (status.online ? "on" : "off")}><i></i>${status.online ? t("AI 已連線", "AI online") : t("內建規則模式", "Built-in rules mode")}</span>` : null}
        ${messages.length ? html`<button type="button" class="ghost-btn push-right" onClick=${() => setMessages([])}><${Icon} name="trash" size=${14} />${t("清除對話", "Clear chat")}</button>` : null}
      </div>
      <div class="chat-log" ref=${log} aria-live="polite">
        ${messages.length ? messages.map((m) => html`<${Message} m=${m} data=${data} theme=${theme} retry=${retry} />`) : html`<div class="chat-empty">
          <div class="chat-empty-mark"><${Icon} name="spark" size=${24} /></div>
          <h3>${t("想知道預算的哪一件事？", "What would you like to know about the budget?")}</h3>
          <p>${t(`回答只使用 ${scope} 的系統資料；回答中的數字會自動查核。`, `Answers use only system data for ${scope}; every number in an answer is checked automatically.`)}</p>
          <div class="starter">${prompts.map((p) => html`<button type="button" onClick=${() => send(p.q, messages)}>
            <span class="starter-tag"><${Icon} name=${p.icon} size=${14} />${p.tag}</span>${p.q}
          </button>`)}</div>
        </div>`}
        ${busy && draft ? html`<div class="msg bot"><div class="bot-mark"><${Icon} name="spark" size=${16} /></div>
          <div class="bot-body"><div class="md streaming" dangerouslySetInnerHTML=${{ __html: md(draft) }}></div></div></div>`
        : busy ? html`<div class="msg bot"><div class="bot-mark"><${Icon} name="spark" size=${16} /></div>
          <div class="bot-body typing"><span></span><span></span><span></span>${t(`正在分析 FY${data.year} 資料`, `Analysing FY${data.year} data`)}</div></div>` : null}
      </div>
      ${messages.length ? html`<div class="chips-row">${prompts.map((p) => html`<button type="button" class="prompt" disabled=${busy} onClick=${() => send(p.q, messages)}>${p.q}</button>`)}</div>` : null}
      <form class="composer" onSubmit=${(e) => { e.preventDefault(); send(input, messages); }}>
        <textarea ref=${box} rows="1" value=${input} onInput=${grow} onKeyDown=${onKey} placeholder=${t("輸入預算或部門相關問題，例如：行銷部第四季會超支嗎？", "Ask about the budget or a department, e.g. Will Marketing overspend in Q4?")} aria-label=${t("輸入問題", "Your question")}></textarea>
        <button type="submit" class="send" disabled=${busy || !input.trim()} aria-label=${t("送出", "Send")}><${Icon} name="send" size=${20} sw=${2.2} /></button>
      </form>
      <div class="composer-note">${t("Enter 送出 · Shift + Enter 換行 · 示範資料為合成數據，AI 建議僅供參考，不代表已核准的調整", "Enter to send · Shift + Enter for a new line · Demo data is synthetic; AI suggestions are not approved changes")}</div>
    </section>
    <aside class="chat-side">
      <div class="card card-pad">
        <div class="section-title">${t("回答怎麼產生", "How answers are made")}</div>
        <ol class="steps">
          <li><b>${t("系統計算", "System calculates")}</b>${t("預測、差異與預警由系統計算，和總覽頁相同。", "Forecasts, variances and alerts are calculated by the system, the same as the overview.")}</li>
          <li><b>${t("AI 解讀", "AI explains")}</b>${t("AI 只會讀到你目前權限範圍內的資料，用來說明原因與建議。", "AI only sees data within your current access scope and uses it to explain causes and suggest actions.")}</li>
          <li><b>${t("數字查核", "Numbers checked")}</b>${t(html`回答中的金額與百分比逐一比對資料，對不上的會<mark>標示</mark>出來。`, html`Each amount and percentage in the answer is matched against the data; anything that does not match is <mark>highlighted</mark>.`)}</li>
        </ol>
      </div>
      <div class="card card-pad">
        <div class="section-title">${t("目前範圍的重點", "Key points in scope")}</div>
        <ul class="evidence">${data.summary.map((s) => html`<li>${s}</li>`)}</ul>
      </div>
    </aside>
  </div>`;
}

// ===== 資料匯入 =====
const CSV_COLUMNS = () => [
  ["Year", "年度", true, t("例如 2026", "e.g. 2026")],
  ["Month", "月份", true, t("1–12，每個年度與部門都要有 12 個月", "1–12; every year and department needs all 12 months")],
  ["Department", "部門", true, t("資訊部、行銷部…或英文名稱", "IT, Marketing… or the Chinese names")],
  ["Budget", "預算", true, t("當月預算（元），不可為負", "Monthly budget (NT$), not negative")],
  ["Actual", "實際支出", true, t("當月實際（元）；尚未結算的月份留空", "Monthly actual (NT$); leave blank for months not yet closed")],
  ["OneOffAmount", "一次性支出", false, t("一次性金額只計一次，不外推到未來", "One-off amounts count once and are not extrapolated")],
  ["EventNote", "事件說明", false, t("例如：系統上線、專案延宕", "e.g. system go-live, project delay")],
];

function DataImport({ meta, state, setDs, close }) {
  const [phase, setPhase] = useState("idle"); // idle | uploading | error | done
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const panel = useRef(null);
  const current = meta.dataset;
  useEffect(() => {
    panel.current && panel.current.focus();
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  async function upload(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setPhase("error"); setErrors([t("請選擇 .csv 檔案（Excel 可用「另存新檔 → CSV」）。", "Choose a .csv file (in Excel: Save As → CSV).")]); return; }
    if (file.size > 3 * 1024 * 1024) { setPhase("error"); setErrors([t("檔案超過 3 MB。", "The file is larger than 3 MB.")]); return; }
    setPhase("uploading");
    setErrors([]);
    try {
      const r = await fetch("/api/upload?" + new URLSearchParams({ name: file.name, role: state.role, lang: state.lang || "zh" }), { method: "POST", headers: { "content-type": "text/csv" }, body: file });
      const body = await r.json();
      if (!r.ok) throw body.detail && body.detail.errors ? body.detail.errors : [typeof body.detail === "string" ? body.detail : t("上傳失敗，請再試一次。", "Upload failed; please try again.")];
      setResult(body);
      setPhase("done");
    } catch (err) {
      setErrors(Array.isArray(err) ? err : [t("連線失敗，檔案沒有送出。", "Connection failed; the file was not sent.")]);
      setPhase("error");
    }
  }
  const onDrop = (e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); };
  const ym = (c) => t(`${c.year}/${String(c.month).padStart(2, "0")}`, `${mon(c.month)} ${c.year}`);

  return html`<div class="scrim" onClick=${close}></div>
  <section class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" tabindex="-1" ref=${panel}>
    <div class="drawer-head">
      <div style="flex:1"><h2 id="import-title" class="card-title">${t("匯入預算資料", "Import budget data")}</h2>
        <div class="card-sub">${t("目前使用：", "In use: ")}${current.source === "upload" ? t(`上傳檔案「${current.name}」`, `uploaded file "${current.name}"`) : t("合成示範資料", "synthetic demo data")} · ${current.rows.toLocaleString("en-US")} ${t("列", "rows")} · ${t("資料截至", "through")} ${ym(current.cutoff)}</div></div>
      <button type="button" class="icon-btn" aria-label=${t("關閉", "Close")} onClick=${close}><${Icon} name="close" size=${16} /></button>
    </div>
    <div class="drawer-body">
      ${phase === "done" ? html`<div class="import-ok">
          <div class="chk ok big"><${Icon} name="check" size=${24} sw=${2.6} /></div>
          <h3>${t("檢核通過，可以開始使用", "Checks passed; ready to use")}</h3>
          <dl class="doc-fields">
            <dt>${t("檔案", "File")}</dt><dd>${result.name}</dd>
            <dt>${t("資料列", "Rows")}</dt><dd class="num">${t(`${result.rows.toLocaleString("en-US")} 列 · ${result.years} 個年度`, `${result.rows.toLocaleString("en-US")} rows · ${result.years} years`)}</dd>
            <dt>${t("最後結算月份", "Last closed month")}</dt><dd class="num">${t(`${result.cutoff.year} 年 ${result.cutoff.month} 月`, `${mon(result.cutoff.month)} ${result.cutoff.year}`)}</dd>
          </dl>
          <p class="hint">${t("所有頁面、預測、回放與 AI 助理都會改用這份資料。資料只在本次使用期間有效，不會被保存。", "Every page, forecast, replay and the AI assistant will use this data. It is used for this session only and is not stored.")}</p>
          <div class="doc-actions"><button type="button" class="btn-primary" onClick=${() => { setDs(result.id); close(); }}>${t("改用這份資料", "Use this data")}</button>
            <button type="button" class="ghost-btn" onClick=${() => { setPhase("idle"); setResult(null); }}>${t("重新選擇", "Choose another")}</button></div>
        </div>`
      : html`
        <div class=${"drop" + (drag ? " over" : "") + (phase === "uploading" ? " busy" : "")} role="button" tabindex="0"
          onClick=${() => phase !== "uploading" && input.current.click()} onKeyDown=${(e) => (e.key === "Enter" || e.key === " ") && input.current.click()}
          onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${onDrop}>
          <${Icon} name="upload" size=${24} />
          <b>${phase === "uploading" ? t("檢核中…", "Checking…") : t("把 CSV 拖到這裡，或點一下選擇檔案", "Drop a CSV here, or click to choose a file")}</b>
          <span>${t("UTF-8 或 Big5 編碼皆可 · 上限 3 MB · 欄位名稱中英文都可以", "UTF-8 or Big5 · up to 3 MB · English or Chinese column names")}</span>
          <input ref=${input} type="file" accept=".csv,text/csv" hidden onChange=${(e) => { upload(e.target.files[0]); e.target.value = ""; }} />
        </div>
        ${phase === "error" ? html`<div class="callout warn import-err" role="alert"><${Icon} name="alert" size=${16} />
          <div><b>${t("檢核沒有通過，資料沒有套用：", "Checks failed; nothing was applied:")}</b><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div></div>` : null}
        <div>
          <div class="section-title">${t("欄位格式", "Columns")}</div>
          <div class="table-wrap"><table class="compact cols">
            <thead><tr><th>${t("欄位", "Column")}</th><th>${t("中文欄名", "Chinese name")}</th><th></th><th>${t("說明", "Notes")}</th></tr></thead>
            <tbody>${CSV_COLUMNS().map(([en, zh, need, note]) => html`<tr style="cursor:default"><td><code>${en}</code></td><td>${zh}</td>
              <td><span class=${"tag " + (need ? "req" : "opt")}>${need ? t("必填", "Required") : t("選填", "Optional")}</span></td><td class="why">${note}</td></tr>`)}</tbody>
          </table></div>
        </div>
        <div class="import-foot">
          <a class="ghost-btn" href=${"/api/template.csv?" + new URLSearchParams({ ds: state.ds || "" })}><${Icon} name="download" size=${14} />${t("下載範本（目前資料）", "Download template (current data)")}</a>
          ${current.source === "upload" ? html`<button type="button" class="ghost-btn" onClick=${() => { setDs(""); close(); }}>${t("改回合成示範資料", "Back to demo data")}</button>` : null}
        </div>
        <p class="hint">${t("範本就是目前資料的完整匯出，可直接在 Excel 修改後再上傳；也可以對接 ERP／財務系統的月度匯出檔。上傳的資料只在目前工作階段使用。", "The template is a full export of the current data: edit it in Excel and upload it again, or use a monthly export from your ERP. Uploaded data is used in this session only.")}</p>`}
    </div>
  </section>`;
}

// ===== 系統設定：預警門檻與示範資料量級（財務長、財務分析師可用；部門主管鎖定）=====
function readTh() {
  const v = (store.get("thresholds", localStorage) || "").split(",").map(Number);
  return v.length === 3 && v.every(Number.isFinite) && v[0] > v[1] ? v : [...DEFAULT_TH];
}
const keyByTh = (use, [high, watch, lag]) => (use > high ? "high" : use > watch ? "watch" : use < lag ? "lag" : "ok");

function Settings({ meta, data, state, setTh, setDs, close }) {
  const lim = meta.thresholdLimits;
  const [th, setDraft] = useState(state.th);
  const [scale, setScale] = useState(meta.dataset.scale || 30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const panel = useRef(null);
  useEffect(() => {
    panel.current && panel.current.focus();
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const synthetic = meta.dataset.source === "synthetic";
  const scaleNum = Number(scale);
  const scaleOk = Number.isFinite(scaleNum) && scaleNum >= 5 && scaleNum <= 500;
  const valid = th[0] > th[1] && (!synthetic || scaleOk);
  const changed = th.join() !== state.th.join() || (synthetic && scaleOk && scaleNum !== meta.dataset.scale);
  // 即時預覽：用目前畫面上的年底使用率，依新門檻重新分類，套用前就看得到影響
  const counts = (t3) => Object.fromEntries(["high", "watch", "lag", "ok"].map((k) => [k, data ? data.departments.filter((d) => keyByTh(d.usePct, t3) === k).length : 0]));
  const before = counts(state.th), after = counts(th);
  const flipped = data ? data.departments.filter((d) => keyByTh(d.usePct, th) !== keyByTh(d.usePct, state.th)) : [];
  const fields = [
    [0, "high", t("高風險超支", "High overspend risk"), t("年底使用率超過", "Year-end use above")],
    [1, "watch", t("需注意", "Monitor closely"), t("年底使用率超過", "Year-end use above")],
    [2, "lag", t("執行落後", "Behind plan"), t("年底使用率低於", "Year-end use below")],
  ];
  const setOne = (i, v) => setDraft((prev) => prev.map((x, j) => (j === i ? Number(v) : x)));

  async function apply() {
    if (!valid) return;
    if (synthetic && scaleNum !== meta.dataset.scale) {
      setBusy(true);
      try {
        const r = await fetch("/api/scale?" + new URLSearchParams({ scale: scaleNum, role: state.role, lang: state.lang || "zh" }), { method: "POST" });
        if (!r.ok) throw new Error();
        const info = await r.json();
        if (info.id !== (state.ds || "")) setDs(info.id);
      } catch (e) {
        setErr(t("示範資料量級沒有套用，請再試一次。", "The demo data scale was not applied; please try again."));
        setBusy(false);
        return;
      }
    }
    if (th.join() !== state.th.join()) setTh(th);
    close();
  }

  return html`<div class="scrim" onClick=${close}></div>
  <section class="modal settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" ref=${panel}>
    <div class="drawer-head">
      <div style="flex:1"><h2 id="settings-title" class="card-title">${t("系統設定", "Settings")}</h2>
        <div class="card-sub">${t("設定只套用在這個瀏覽器；正式導入時由財務長統一設定全公司適用的門檻。", "Settings apply to this browser only; in production the CFO sets company-wide thresholds.")}</div></div>
      <button type="button" class="icon-btn" aria-label=${t("關閉", "Close")} onClick=${close}><${Icon} name="close" size=${16} /></button>
    </div>
    <div class="drawer-body">
      <div>
        <div class="section-title">${t("預警門檻", "Alert thresholds")}<${Info}><p>${t("燈號依「年底預估 ÷ 年度預算」判斷。調整後所有頁面、提前預警回放、AI 回答與 PDF 報告都會一起套用。", "Lights are based on year-end forecast ÷ annual budget. Changes apply to every page, the early-warning replay, AI answers and the PDF report.")}</p></${Info}></div>
        <div class="sliders th-sliders">${fields.map(([i, k, label, lead]) => {
          const [lo, hi] = lim[k];
          return html`<div class="slider">
            <div class="slider-top"><label for=${"th-" + k}><span class=${"dot bg-" + k}></span> ${label}</label><b class="num">${lead} ${th[i]}%</b></div>
            <input id=${"th-" + k} type="range" min=${lo} max=${hi} step="1" value=${th[i]} style=${{ "--p": ((th[i] - lo) / (hi - lo)) * 100 + "%" }} onInput=${(e) => setOne(i, e.target.value)} />
            <div class="slider-range num"><span>${lo}%</span><span>${t("預設", "Default")} ${DEFAULT_TH[i]}%</span><span>${hi}%</span></div>
          </div>`;
        })}</div>
        ${th[0] <= th[1] ? html`<div class="callout warn" role="alert"><${Icon} name="alert" size=${16} />${t("「高風險超支」的門檻必須高於「需注意」。", "The high-risk threshold must be above the monitor threshold.")}</div>` : null}
        ${data ? html`<div class="th-preview">
          <div class="card-sub">${t(`套用後（FY${data.year}，目前範圍 ${data.departments.length} 個部門）`, `After applying (FY${data.year}, ${data.departments.length} departments in scope)`)}</div>
          <div class="tags">${["high", "watch", "lag", "ok"].map((k) => html`<span class="tally"><i class=${"bg-" + k}></i>${sl(k)} <b class="num">${after[k]}</b>${after[k] !== before[k] ? html`<small class="num">（${t("原本", "was")} ${before[k]}）</small>` : null}</span>`)}</div>
          ${flipped.length ? html`<p class="hint">${t("燈號會改變：", "Lights that change: ")}${flipped.map((d) => `${dn(d.name)} ${sl(keyByTh(d.usePct, state.th))} → ${sl(keyByTh(d.usePct, th))}`).join(t("、", ", "))}</p>` : null}
        </div>` : null}
      </div>
      <div>
        <div class="section-title">${t("示範資料量級", "Demo data scale")}<${Info}><p>${t("合成示範資料會依這個年度營業費用總額等比例產生，可改成貴公司的實際量級來展示；上傳的 ERP 資料以實際金額計算，不受影響。", "The synthetic demo data is generated in proportion to this annual operating-expense total, so you can match your company's size; uploaded ERP data uses its own amounts.")}</p></${Info}></div>
        ${synthetic ? html`<label class="scale-field">
            <input type="number" min="5" max="500" step="1" value=${scale} onInput=${(e) => setScale(e.target.value)} aria-label=${t("年度營業費用總額（億元）", "Annual operating expenses (NT$100M)")} />
            <span>${t("億元（年度營業費用總額，5–500）", "× NT$100M (annual operating expenses, 5–500)")}</span></label>
            ${!scaleOk ? html`<div class="callout warn"><${Icon} name="alert" size=${16} />${t("請輸入 5 到 500 之間的數字。", "Enter a number between 5 and 500.")}</div>` : null}`
          : html`<p class="hint">${t(`目前使用上傳檔案「${meta.dataset.name}」，金額以檔案為準。`, `Using the uploaded file "${meta.dataset.name}"; amounts come from the file.`)}</p>`}
      </div>
      ${err ? html`<div class="callout warn" role="alert"><${Icon} name="alert" size=${16} />${err}</div>` : null}
      <div class="doc-actions">
        <button type="button" class="btn-primary" disabled=${!valid || !changed || busy} onClick=${apply}>${busy ? t("套用中…", "Applying…") : t("套用設定", "Apply")}</button>
        <button type="button" class="ghost-btn" disabled=${th.join() === DEFAULT_TH.join() && (!synthetic || scaleNum === 30)} onClick=${() => { setDraft([...DEFAULT_TH]); setScale(30); }}>${t("恢復預設值", "Restore defaults")}</button>
        <button type="button" class="ghost-btn" onClick=${close}>${t("取消", "Cancel")}</button>
      </div>
    </div>
  </section>`;
}

// ===== App =====
function App() {
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(() => ({
    ...readUrl(),
    ds: store.get("ds") || "",
    role: ROLES[store.get("role", localStorage)] ? store.get("role", localStorage) : "cfo",
    roleDept: store.get("roleDept", localStorage) || "",
    th: readTh(),
  }));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setThemeState] = useState(document.documentElement.dataset.theme);
  LANG = state.lang; // 子元件在這次繪製時讀取
  TH = { high: state.th[0], watch: state.th[1], lag: state.th[2] };

  useEffect(() => {
    document.documentElement.lang = state.lang === "en" ? "en" : "zh-Hant";
    document.title = t("預算決策中心", "Budget Command Center");
  }, [state.lang]);

  const setTheme = (next) => {
    document.documentElement.dataset.theme = next;
    store.set("theme", next, localStorage);
    setThemeState(next);
  };
  const setLang = (lang) => {
    store.set("lang", lang, localStorage);
    set({ lang });
  };
  const set = (patch, push = false) => setState((s) => { const n = { ...s, ...patch }; writeUrl(n, push); return n; });
  const go = (path, prompt) => {
    if (prompt) store.set("pendingPrompt", prompt);
    set({ path }, true);
    window.scrollTo(0, 0);
  };
  const setRole = (role, roleDept) => {
    // 換身分就清掉對話，避免部門主管看到先前以財務長身分問到的全公司回答
    if (role !== state.role || roleDept !== state.roleDept) clearChats();
    store.set("role", role, localStorage);
    store.set("roleDept", roleDept, localStorage);
    set({ role, roleDept });
  };
  const setDs = (ds) => {
    store.set("ds", ds || null);
    clearChats();
    setData(null);
    set({ ds });
  };
  const setTh = (th) => {
    // 門檻改了，先前的 AI 回答用的是舊燈號，一併清掉
    store.set("thresholds", th.join() === DEFAULT_TH.join() ? null : th.join(","), localStorage);
    clearChats();
    set({ th });
  };

  useEffect(() => {
    const pop = () => setState((s) => ({ ...s, ...readUrl() }));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/meta?" + new URLSearchParams({ ds: state.ds })).then((r) => r.json()).then((m) => {
      if (!alive) return;
      if (state.ds && !m.dataset.id) {
        // 伺服器重啟後上傳資料會消失，改回示範資料並告知
        store.set("ds", null);
        setNotice(["先前使用的資料已過期，已改回預設示範資料。", "The data you were using has expired, so the default demo data is back."]);
        set({ ds: "" });
      }
      setMeta(m);
      setState((s) => {
        const names = m.departments.map((d) => d.name);
        const n = {
          ...s,
          year: m.years.includes(s.year) ? s.year : m.cutoff.year,
          depts: s.depts.filter((d) => names.includes(d)),
          roleDept: names.includes(s.roleDept) ? s.roleDept : names[0],
        };
        writeUrl(n, false);
        return n;
      });
    }).catch(() => alive && setError(["暫時無法載入資料，請稍後重新整理", "Data could not be loaded; please refresh in a moment"]));
    return () => { alive = false; };
  }, [state.ds]);

  const view = viewOf(state);
  useEffect(() => {
    if (!state.year || !meta) return;
    let alive = true;
    fetch("/api/overview?" + scopeParams(view, { year: state.year })).then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch(() => alive && setError(["資料載入失敗，請重新整理頁面", "Could not load the data; please refresh the page"]));
    return () => { alive = false; };
  }, [meta, state.year, view.depts.join(","), state.ds, state.role, state.lang, state.th.join()]);

  const route = ROUTES.find((r) => r.path === state.path);
  let body;
  if (error) body = html`<div class="content"><div class="card empty"><h2>${t(...error)}</h2></div></div>`;
  else if (!data) body = html`<${Skeleton} />`;
  else if (route.path === "/") body = html`<${Overview} data=${data} compare=${state.compare} theme=${theme} go=${go} />`;
  else if (route.path === "/analysis") body = html`<${Analysis} data=${data} theme=${theme} go=${go} />`;
  else if (route.path === "/forecast") body = html`<${Forecast} data=${data} state=${view} theme=${theme} go=${go} />`;
  else if (route.path === "/scenarios") body = html`<${Scenarios} data=${data} meta=${meta} state=${view} theme=${theme} setYear=${(year) => set({ year })} />`;
  else if (route.path === "/assistant") body = html`<${Assistant} key=${`${state.role}|${state.roleDept}|${state.ds}`} data=${data} state=${view} theme=${theme} />`;
  else body = html`<${ComingSoon} route=${route} go=${go} />`;

  return html`<div class="shell">
    <${Sidebar} path=${state.path} go=${go} data=${data} meta=${meta} role=${state.role} openImport=${() => setImporting(true)} openSettings=${() => setSettings(true)} />
    <div class="main">
      ${meta ? html`<${Topbar} meta=${meta} state=${state} set=${set} setRole=${setRole} setLang=${setLang} theme=${theme} setTheme=${setTheme} go=${go} openImport=${() => setImporting(true)} openSettings=${() => setSettings(true)} />` : null}
      ${notice ? html`<div class="notice" role="status"><${Icon} name="alert" size=${16} /><span>${t(...notice)}</span><button type="button" class="icon-btn sm" aria-label=${t("關閉提示", "Dismiss")} onClick=${() => setNotice(null)}><${Icon} name="close" size=${14} /></button></div>` : null}
      <main key=${state.lang}>${body}</main>
    </div>
    ${importing && meta ? html`<${DataImport} meta=${meta} state=${state} setDs=${setDs} close=${() => setImporting(false)} />` : null}
    ${settings && meta ? html`<${Settings} meta=${meta} data=${data} state=${state} setTh=${setTh} setDs=${setDs} close=${() => setSettings(false)} />` : null}
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));

// 表格出現橫向捲軸時，捲軸取代底部 8px 留白，表格到卡片下緣的距離維持 20
const markScroll = () => document.querySelectorAll(".table-wrap").forEach((w) => w.classList.toggle("scrolls", w.scrollWidth > w.clientWidth + 1));
new MutationObserver(markScroll).observe(document.getElementById("app"), { childList: true, subtree: true });
addEventListener("resize", markScroll);
