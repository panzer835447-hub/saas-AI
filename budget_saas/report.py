"""高階主管預算摘要報告（PDF）。

版面移植自 Streamlit 版 app.py 的 BudgetPDF：固定淺色、A4，適合列印、轉寄與簽核。
內容全部取自總覽 API 的同一份計算結果（core.overview），PDF 與畫面上的數字一定相同。
"""
import io
import re
from datetime import datetime
from pathlib import Path

import xlsxwriter
from fpdf import FPDF
from fpdf.enums import MethodReturnValue, WrapMode

import budget_core as core
from ai import MARK_CLOSE, MARK_OPEN

# Noto Sans TC（SIL OFL）一般／粗體靜態檔，由可變字型預先轉出：
# 在伺服器上即時轉換每次約 20 秒且很吃記憶體，免費主機撐不住，所以直接附上轉好的檔案
FONTS = {"": Path(__file__).parent / "fonts" / "NotoSansTC-Regular.ttf", "B": Path(__file__).parent / "fonts" / "NotoSansTC-Bold.ttf"}
INK, MUTED, LINE, SOFT = (17, 24, 39), (90, 98, 114), (226, 229, 235), (246, 247, 250)
BRAND = (79, 70, 229)
STATUS_RGB = {"high": (214, 51, 74), "watch": (183, 106, 0), "lag": (4, 121, 168), "ok": (17, 138, 88)}
ACTIONS = {
    "high": ("檢視剩餘月份的採購、合約與支出計畫，必要時暫緩非必要支出。", "Review remaining-month purchases and contracts; defer discretionary spend if needed."),
    "watch": ("每月追蹤主要費用科目，確認超支是一次性還是持續性。", "Track major categories monthly and confirm whether the overrun is one-off or recurring."),
    "lag": ("確認專案時程與剩餘預算需求；若確定有餘額，可列為調撥來源。", "Confirm project timing and remaining needs; confirmed headroom can fund reallocation."),
}
# 已結算年度沒有剩餘月份可調整，建議改成回顧與下年度編列
CLOSED_ACTIONS = {
    "high": ("檢討超支原因，區分一次性與經常性支出，並反映在下年度預算編列。", "Review why it overspent, separate one-off from recurring costs, and reflect it in next year's budget."),
    "watch": ("確認超支是否會延續到下年度，必要時調整科目預算。", "Check whether the overrun will continue next year and adjust category budgets if needed."),
    "lag": ("確認結餘原因（專案延後或需求下降），作為下年度編列的參考。", "Confirm why budget went unused (delayed projects or lower demand) and use it to set next year's budget."),
}


class BudgetPDF(FPDF):
    def __init__(self, doc_title, footer_note, lang):
        super().__init__(format="A4", unit="mm")
        self.doc_title, self.footer_note, self.lang = doc_title, footer_note, lang
        self.wrap = WrapMode.WORD if lang == "en" else WrapMode.CHAR  # 中文逐字換行；英文依單字換行
        self.set_margins(16, 18, 16)
        self.set_auto_page_break(True, 18)
        for style, path in FONTS.items():
            self.add_font("tc", style, str(path))
        self.set_title(doc_title)
        self.set_author("BNP Paribas Cardif TW · Budget Command Center")

    @property
    def body_w(self):
        return self.w - self.l_margin - self.r_margin

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("tc", "", 8)
        self.set_text_color(*MUTED)
        self.set_xy(self.l_margin, 8)
        self.cell(0, 5, self.doc_title)
        self.set_draw_color(*LINE)
        self.line(self.l_margin, 14, self.w - self.r_margin, 14)
        self.set_y(18)

    def footer(self):
        self.set_y(-12)
        self.set_font("tc", "", 7.5)
        self.set_text_color(*MUTED)
        self.cell(self.body_w - 20, 5, self.footer_note)
        self.cell(20, 5, f"{self.page_no()} / {{nb}}", align="R")

    def cover(self, title, subtitle, meta):
        self.add_page()
        self.set_fill_color(*INK)
        self.rect(0, 0, self.w, 60, "F")
        self.set_fill_color(*BRAND)
        self.rect(0, 60, self.w, 1.6, "F")
        self.set_xy(self.l_margin, 14)
        self.set_font("tc", "", 9)
        self.set_text_color(186, 190, 255)
        self.cell(0, 5, "BNP PARIBAS CARDIF TW · " + core.tx(self.lang, "管理會計", "MANAGEMENT ACCOUNTING"))
        self.set_xy(self.l_margin, 22)
        self.set_font("tc", "B", 22)
        self.set_text_color(255, 255, 255)
        self.cell(0, 11, title)
        self.set_xy(self.l_margin, 35)
        self.set_font("tc", "", 10.5)
        self.set_text_color(205, 210, 222)
        self.cell(0, 6, subtitle)
        x = self.l_margin
        self.set_font("tc", "", 8.5)
        for item in meta:
            w = self.get_string_width(item) + 8
            if x + w > self.w - self.r_margin:  # 標籤太多時不超出頁面
                break
            self.set_fill_color(42, 48, 64)
            self.set_text_color(232, 235, 242)
            self.set_xy(x, 46)
            self.cell(w, 6.5, item, fill=True, align="C")
            x += w + 3
        self.set_y(70)

    def ensure_space(self, height):
        if self.get_y() + height > self.h - self.b_margin:
            self.add_page()

    def heading(self, text):
        self.ensure_space(22)
        y = self.get_y()
        self.set_fill_color(*BRAND)
        self.rect(self.l_margin, y + 1, 1.4, 5.2, "F")
        self.set_xy(self.l_margin + 3.5, y)
        self.set_font("tc", "B", 12)
        self.set_text_color(*INK)
        self.cell(0, 7, text)
        self.ln(10)

    def paragraph(self, text, size=10, color=INK):
        self.set_font("tc", "", size)
        self.set_text_color(*color)
        self.set_x(self.l_margin)
        self.multi_cell(0, size * .56, text, markdown=True, align="L", wrapmode=self.wrap)
        self.ln(2.5)

    def bullet(self, text, rgb=BRAND):
        self.ensure_space(10)
        y = self.get_y()
        self.set_fill_color(*rgb)
        self.ellipse(self.l_margin + 1.5, y + 1.9, 1.7, 1.7, "F")
        self.set_xy(self.l_margin + 6, y)
        self.set_font("tc", "", 9.5)
        self.set_text_color(*INK)
        self.multi_cell(self.body_w - 6, 5.3, text, markdown=True, align="L", wrapmode=self.wrap)
        self.ln(1.2)

    def markdown_block(self, md):
        """AI 回答的 Markdown（標題、清單、粗體）轉成 PDF 版面。"""
        for raw in md.splitlines():
            line = raw.strip()
            if not line:
                self.ln(1.5)
            elif line.startswith("#"):
                self.heading(line.lstrip("#").strip().replace("**", ""))
            elif line[:2] in ("- ", "* ", "• "):
                self.bullet(line[2:].strip())
            elif re.match(r"^\d+[.、)]\s*", line):
                self.bullet(line)
            else:
                self.paragraph(line)

    def kpis(self, items):
        gap, h = 4, 27
        w = (self.body_w - gap * (len(items) - 1)) / len(items)
        self.ensure_space(h + 8)
        y = self.get_y()
        for i, (label, value, sub, rgb) in enumerate(items):
            x = self.l_margin + i * (w + gap)
            self.set_fill_color(*SOFT)
            self.set_draw_color(*LINE)
            self.rect(x, y, w, h, "DF", round_corners=True, corner_radius=2.5)
            self.set_fill_color(*rgb)
            self.rect(x, y + 4, 1.2, h - 8, "F")
            for dy, size, style, color, text in ((3.5, 8, "", MUTED, label), (9.5, 15, "B", rgb, value), (19.5, 7.5, "", MUTED, sub)):
                self.set_xy(x + 5, y + dy)
                self.set_font("tc", style, size)
                while size > 6.5 and self.get_string_width(text) > w - 8:  # 長數字自動縮小，不超出卡片
                    size -= .5
                    self.set_font("tc", style, size)
                self.set_text_color(*color)
                self.cell(w - 8, size * .5, text)
        self.set_y(y + h + 8)

    def table(self, headers, rows, widths, aligns, row_colors=None):
        widths = [w * self.body_w / sum(widths) for w in widths]

        def head():
            self.set_font("tc", "B", 8.5)
            self.set_fill_color(*INK)
            self.set_text_color(255, 255, 255)
            for text, w, a in zip(headers, widths, aligns):
                self.cell(w, 7.5, text, fill=True, align=a)
            self.ln()
            self.set_font("tc", "", 8.5)

        table_h = 7.5 + 7 * len(rows)
        self.ensure_space(table_h if table_h < self.h - self.t_margin - self.b_margin - 10 else 20)  # 短表格不拆頁
        head()
        self.set_fill_color(*SOFT)
        for i, row in enumerate(rows):
            if self.get_y() + 7 > self.h - self.b_margin:
                self.add_page()
                head()
                self.set_fill_color(*SOFT)
            for j, (value, w, a) in enumerate(zip(row, widths, aligns)):
                self.set_text_color(*((row_colors[i][j] if row_colors and row_colors[i][j] else INK)))
                self.cell(w, 7, str(value), fill=i % 2 == 1, align=a)
            self.ln()
        self.set_draw_color(*LINE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(5)

    def bars(self, items, caption):
        top = max([120.0] + [p + 5 for _, p, _, _ in items])
        self.set_font("tc", "", 9)
        label_w, value_w = max([30.0] + [self.get_string_width(n) + 4 for n, _, _, _ in items]), 24  # 英文部門名稱較長，標籤欄依內容加寬
        bar_w = self.body_w - label_w - value_w
        x0 = self.l_margin + label_w
        self.ensure_space(len(items) * 7.5 + 10)
        for name, pct, rgb, label in items:
            y = self.get_y()
            self.set_xy(self.l_margin, y)
            self.set_font("tc", "", 9)
            self.set_text_color(*INK)
            self.cell(label_w, 6, name)
            self.set_fill_color(236, 238, 243)
            self.rect(x0, y + 1.5, bar_w, 3.4, "F", round_corners=True, corner_radius=1.7)
            self.set_fill_color(*rgb)
            self.rect(x0, y + 1.5, max(1.0, bar_w * min(pct, top) / top), 3.4, "F", round_corners=True, corner_radius=1.7)
            limit_x = x0 + bar_w * 100 / top
            self.set_draw_color(*INK)
            self.set_dash_pattern(dash=.8, gap=.6)
            self.line(limit_x, y + .2, limit_x, y + 6.2)
            self.set_dash_pattern()
            self.set_xy(x0 + bar_w, y)
            self.set_font("tc", "B", 9)
            self.set_text_color(*rgb)
            self.cell(value_w, 6, label, align="R")
            self.ln(7.5)
        self.paragraph(caption, size=8, color=MUTED)

    def fields(self, pairs):
        for key, value in pairs:
            self.ensure_space(9)
            self.set_x(self.l_margin)
            self.set_draw_color(*LINE)
            self.set_fill_color(*SOFT)
            self.set_font("tc", "", 9)
            self.set_text_color(*MUTED)
            self.cell(52, 8.5, "  " + key, border="B", fill=True)
            self.set_font("tc", "B", 9.5)
            self.set_text_color(*INK)
            self.cell(0, 8.5, "  " + value, border="B")
            self.ln()
        self.ln(5)

    def signatures(self, roles):
        gap, h = 4, 28
        w = (self.body_w - gap * (len(roles) - 1)) / len(roles)
        self.ensure_space(h + 6)
        y = self.get_y()
        for i, role in enumerate(roles):
            x = self.l_margin + i * (w + gap)
            self.set_draw_color(*LINE)
            self.rect(x, y, w, h, "D", round_corners=True, corner_radius=2)
            self.set_xy(x, y + 2.5)
            self.set_font("tc", "B", 9)
            self.set_text_color(*INK)
            self.cell(w, 5, role, align="C")
            self.set_xy(x, y + h - 7.5)
            self.set_font("tc", "", 7.5)
            self.set_text_color(*MUTED)
            self.cell(w, 5, core.tx(self.lang, "簽章／日期", "Signature / date"), align="C")
        self.set_y(y + h + 6)

    def note_box(self, text):
        self.set_font("tc", "", 9.5)
        height = self.multi_cell(self.body_w - 10, 5.6, text, dry_run=True, output=MethodReturnValue.HEIGHT, align="L", wrapmode=self.wrap) + 9
        self.ensure_space(height + 4)
        y = self.get_y()
        self.set_fill_color(*SOFT)
        self.rect(self.l_margin, y, self.body_w, height, "F", round_corners=True, corner_radius=2)
        self.set_xy(self.l_margin + 5, y + 4.5)
        self.set_text_color(*INK)
        self.multi_cell(self.body_w - 10, 5.6, text, align="L", wrapmode=self.wrap)
        self.set_y(y + height + 6)


def _num(val, lang, signed=False):
    """表頭已標單位的表格數字：中文新台幣萬元整數，英文 NT$ 百萬一位小數。"""
    n = float(val) / (1e6 if lang == "en" else 1e4)
    body = f"{abs(n):,.1f}" if lang == "en" else f"{abs(n):,.0f}"
    if float(body.replace(",", "")) == 0:
        return body
    return "-" + body if n < 0 else ("+" + body if signed else body)


def _start(year, depts, ds, lang, th, title, subtitle):
    """兩種報告共用的封面與四張指標卡；回傳 (pdf, 總覽資料)。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    d = core.overview(year, depts, ds, lang, th)
    tt, closed = d["totals"], d["cutoff"] >= 12
    info = core.dataset_info(ds)
    rows = d["departments"]
    scope = core.dept_label(rows[0]["name"], lang) if len(rows) == 1 else T(f"{len(rows)} 個部門", f"{len(rows)} departments")
    over = tt["variance"] > 0
    meta = [f"FY{year}",
            T("12 個月皆已結算", "All 12 months closed") if closed else T(f"資料截至 {d['cutoff']} 月", f"Data through M{d['cutoff']}"),
            scope,
            T(f"資料來源：{info['name']}", f"Source: {info['name']}") if info["source"] == "upload" else T("示範資料", "Demo data"),
            T("產出 ", "Generated ") + datetime.now().strftime("%Y-%m-%d %H:%M")]
    footer = (T("數字來自使用者匯入的資料，由系統計算。", "Figures come from the imported data and are calculated by the system.") if info["source"] == "upload"
              else T("內建資料為競賽展示用合成資料，不代表任何公司實際數據。", "Built-in data is synthetic for the hackathon demo."))
    pdf = BudgetPDF(title, footer, lang)
    pdf.cover(title, subtitle(closed), meta)

    use_key = core.STATUS_KEY[core.classify_status(tt["usePct"] / 100, th)] if tt["budget"] else "ok"
    pdf.kpis([
        (T("年度總預算", "Annual budget"), f(tt["budget"]), T("全年核定預算", "Approved annual budget"), BRAND),
        (T("全年實際支出", "Full-year spending"), f(tt["actualYtd"]), T("12 個月合計", "12-month total"), BRAND) if closed else
        (T("已執行進度", "Spent so far"), core.fpct(tt["spentPct"]), T(f"{f(tt['actualYtd'])} · 計畫 {core.fpct(tt['planPct'])}", f"{f(tt['actualYtd'])} · plan {core.fpct(tt['planPct'])}"), BRAND),
        (T("全年預算使用率", "Full-year budget use") if closed else T("年底預算使用率", "Year-end budget use"), core.fpct(tt["usePct"]),
         T("全年實際數", "Full-year actual") if closed else T(f"P80 區間 {core.fpct(tt['lowPct'])}–{core.fpct(tt['highPct'])}", f"P80 {core.fpct(tt['lowPct'])}–{core.fpct(tt['highPct'])}"),
         STATUS_RGB[use_key]),
        ((T("全年超支", "Overspend") if closed else T("預估年底超支", "Projected overspend")) if over else (T("全年結餘", "Headroom") if closed else T("預估年底結餘", "Projected headroom")),
         # 顏色跟著燈號：只略超預算（仍在正常範圍）不用紅色，避免誤導
         core.fpct(abs(tt["variancePct"])), f(abs(tt["variance"])), STATUS_RGB[use_key if over else "ok"]),
    ])
    return pdf, d


def rule_brief(year, depts, ds="", lang="zh", th=core.DEFAULT_TH):
    """AI 無法使用時的預警簡報：段落標題與 ai.brief_prompt 相同，內容全部來自系統計算，和摘要報告一致。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    d = core.overview(year, depts, ds, lang, th)
    closed, rows = d["cutoff"] >= 12, d["departments"]
    actions = CLOSED_ACTIONS if closed else ACTIONS
    alerts = [r for r in rows if r["statusKey"] != "ok"]
    gap = T("全年差異", "full-year variance") if closed else T("年底差異", "year-end variance")
    name = lambda r: core.dept_label(r["name"], lang)
    lines = ["## " + T("重點摘要", "Key points"), *[f"- {s}" for s in d["summary"]]]
    if len(rows) == 1:
        r = rows[0]
        lines += ["", "## " + T("原因與建議行動", "Causes and actions"),
                  *[f"- {e}" for e in r["evidence"]],
                  "- " + T(f"建議：{actions[r['statusKey']][0]}", f"Action: {actions[r['statusKey']][1]}") if r["statusKey"] != "ok"
                  else "- " + T("目前在正常範圍內，維持每月追蹤即可。", "Within the normal range; keep tracking monthly.")]
        steps = [T("每月結帳後更新預測，確認燈號是否改變。", "Update the forecast after each month-end close and check whether the status changes."),
                 T("區分一次性與經常性支出，確認超支或結餘是否會延續。", "Separate one-off from recurring costs and check whether the gap will persist."),
                 T("需要調整預算時，與財務部討論調撥或下年度編列。", "If the budget needs to change, discuss a transfer or next year's budget with Finance.")]
    else:
        lines += ["", "## " + T("預警部門與建議行動", "Flagged departments and actions")]
        lines += [T(f"- **{name(r)}｜{core.status_label(r['status'], lang)}**：{gap} {f(r['variance'], True)}（{core.fpct(r['variancePct'], signed=True)}）。{r['evidence'][0]}。建議：{actions[r['statusKey']][0]}",
                    f"- **{name(r)} | {core.status_label(r['status'], lang)}**: {gap} {f(r['variance'], True)} ({core.fpct(r['variancePct'], signed=True)}). {r['evidence'][0]}. Action: {actions[r['statusKey']][1]}")
                  for r in alerts] or ["- " + T("所有部門都在正常範圍內。", "Every department is within the normal range.")]
        high = [name(r) for r in alerts if r["statusKey"] == "high"]
        lag = [r for r in alerts if r["statusKey"] == "lag"]
        sep = T("、", ", ")
        steps = []
        if high:
            steps.append(T(f"檢討{sep.join(high)}的超支原因，區分一次性與經常性支出。", f"Review why {sep.join(high)} overspent, separating one-off from recurring costs.") if closed
                         else T(f"檢討{sep.join(high)}的超支原因與剩餘月份支出計畫。", f"Review the overspend and remaining-month plans of {sep.join(high)}."))
        if lag and not closed:
            unused = -sum(r["variance"] for r in lag)
            steps.append(T(f"確認{sep.join(name(r) for r in lag)}的預估結餘（合計 {f(unused)}）能否列為調撥來源。",
                           f"Confirm whether the expected unused budget of {sep.join(name(r) for r in lag)} ({f(unused)} in total) can fund reallocation."))
        steps.append(T("下次結帳後更新預測，追蹤燈號變化。", "Update the forecast after the next month-end close and track status changes.") if not closed
                     else T("將今年的超支與結餘原因反映在下年度預算編列。", "Reflect this year's overspend and unused-budget causes in next year's budget."))
    lines += ["", "## " + T("下一步", "Next steps"), *[f"- {s}" for s in steps]]
    return "\n".join(lines)


def executive_report(year, depts, ds="", lang="zh", role="cfo", th=core.DEFAULT_TH):
    """回傳 (PDF bytes, 檔名)。depts 已由伺服器依檢視身分限縮範圍。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    pdf, d = _start(year, depts, ds, lang, th, T(f"FY{year} 預算摘要報告", f"FY{year} Budget Summary Report"),
                    lambda closed: T("全年預算執行結果與檢討重點", "Full-year budget results and review points") if closed
                    else T("預算執行、年底預測與預警重點", "Budget execution, year-end forecast and alerts"))
    closed, rows = d["cutoff"] >= 12, d["departments"]

    pdf.heading(T("執行摘要", "Executive summary"))
    for line in d["summary"]:
        pdf.bullet(line)
    pdf.ln(3)

    pdf.heading(T("各部門全年預算使用率", "Full-year budget use by department") if closed else T("各部門年底預算使用率", "Year-end budget use by department"))
    pdf.bars([(core.dept_label(r["name"], lang), r["usePct"], STATUS_RGB[r["statusKey"]], core.fpct(r["usePct"])) for r in rows],
             T("虛線＝年度預算 100%；顏色代表預警燈號。", "Dashed line = 100% of annual budget; colour = alert status."))

    pdf.ensure_space(7.5 + 7 * len(rows) + 10)
    pdf.heading(T("各部門預算與全年實際（單位：新台幣萬元）", "Budget and full-year actual by department (NT$ millions)") if closed
                else T("各部門預算與年底預測（單位：新台幣萬元）", "Budget and year-end forecast by department (NT$ millions)"))
    table, colors = [], []
    for r in rows:
        tone = STATUS_RGB[r["statusKey"]] if r["statusKey"] != "ok" else None
        # 已結算年度的「已支出」就是全年實際，只留一欄
        amounts = [_num(r["budget"], lang)] + ([] if closed else [_num(r["actualYtd"], lang)]) + [_num(r["forecast"], lang)]
        table.append([core.dept_label(r["name"], lang), core.status_label(r["status"], lang), *amounts,
                      _num(r["variance"], lang, True), core.fpct(r["variancePct"], signed=True)])
        colors.append([None, tone] + [None] * len(amounts) + [tone, tone])
    heads = [T("年度預算", "Budget")] + ([] if closed else [T("已支出", "Spent")]) + [T("全年實際", "Actual") if closed else T("年底預測", "Forecast")]
    first = 30 if lang == "en" else 22  # 英文部門與燈號名稱較長
    pdf.table([T("部門", "Department"), T("燈號", "Status"), *heads, T("差異", "Variance"), T("差異率", "Var %")],
              table, [first, first] + [18] * len(heads) + [18, 14], ["L", "L"] + ["R"] * (len(heads) + 2), colors)

    pdf.heading(T("超支與結餘部門檢討", "Departments to review") if closed else T("預警部門與建議行動", "Alerts and recommended actions"))
    alerts = [r for r in rows if r["statusKey"] != "ok"]
    actions = CLOSED_ACTIONS if closed else ACTIONS
    gap = T("全年差異", "full-year variance") if closed else T("年底差異", "year-end variance")
    for r in alerts:
        name, st = core.dept_label(r["name"], lang), core.status_label(r["status"], lang)
        pdf.bullet(T(f"**{name}｜{st}**：{gap} {f(r['variance'], True)}（{core.fpct(r['variancePct'], signed=True)}）。{r['evidence'][0]}。建議：{actions[r['statusKey']][0]}",
                     f"**{name} | {st}**: {gap} {f(r['variance'], True)} ({core.fpct(r['variancePct'], signed=True)}). {r['evidence'][0]}. Action: {actions[r['statusKey']][1]}"),
                   STATUS_RGB[r["statusKey"]])
    if not alerts:
        pdf.paragraph(T("所有部門都在正常範圍內。", "Every department is within the normal range."))

    pdf.ln(2)
    method = "" if closed else T("年底預測＝55% 依歷年季節性推估＋45% 依目前花費速度推估；一次性支出只計已發生的金額。",
                                 "Year-end forecast = 55% seasonal estimate + 45% current-pace estimate; one-off costs count only once. ")
    custom = th != core.DEFAULT_TH
    pdf.note_box(method + T(f"燈號門檻{'（依系統設定）' if custom else ''}：全年使用率超過 {th[0]}% 為高風險超支、超過 {th[1]}% 需注意、低於 {th[2]}% 為執行落後。",
                            f"Alert thresholds{' (custom settings)' if custom else ''}: full-year use above {th[0]}% is high overspend risk, above {th[1]}% needs monitoring, below {th[2]}% is behind plan."))
    name = f"FY{year}_{'budget_summary' if lang == 'en' else '預算摘要報告'}.pdf"
    return bytes(pdf.output()), name


def ledger_xlsx(year, depts, ds="", lang="zh", role="cfo", dept="", gl="", cfo_only=False, query=""):
    """費用明細帳匯出 Excel：套用和畫面相同的篩選條件與個資遮罩；另附一頁「匯出說明」記錄範圍與條件，方便稽核追溯。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    c = core.costs(year, tuple(depts), ds, lang, role)
    q = query.strip().lower()
    lines = [l for l in c["ledger"] if (not dept or l["dept"] == dept) and (not gl or l["gl"] == gl) and (not cfo_only or l["cfo"])
             and (not q or any(q in str(l[k]).lower() for k in ("id", "po", "vendor", "memo", "project", "cc", "account")))]

    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    font = "Microsoft JhengHei" if lang != "en" else "Calibri"
    base = {"font_name": font, "font_size": 10, "valign": "vcenter"}
    head = wb.add_format({**base, "bold": True, "font_color": "#FFFFFF", "bg_color": "#111827", "border": 1, "border_color": "#111827"})
    cell = wb.add_format(base)
    money = wb.add_format({**base, "num_format": "#,##0"})
    total_lbl = wb.add_format({**base, "bold": True, "top": 1})
    total_num = wb.add_format({**base, "bold": True, "top": 1, "num_format": "#,##0"})
    title = wb.add_format({**base, "bold": True, "font_size": 14})
    muted = wb.add_format({**base, "font_color": "#5A6272"})

    ws = wb.add_worksheet(T("費用明細", "Expense lines"))
    cols = [(T("日期", "Date"), 11, "date"), (T("憑證號碼", "Voucher"), 16, "id"), (T("採購單號", "PO"), 15, "po"),
            (T("部門", "Department"), 12, "dept"), (T("成本中心", "Cost centre"), 22, "cc"), (T("科目代碼", "GL code"), 9, "gl"),
            (T("會計科目", "Category"), 16, "account"), (T("供應商", "Vendor"), 28, "vendor"), (T("摘要", "Description"), 26, "memo"),
            (T("專案", "Project"), 24, "project"), (T("經辦人", "Handled by"), 14, "handler"),
            (T("核准層級", "Approval"), 10, "cfo"), (T("金額（元）", "Amount (NT$)"), 14, "amount")]
    for j, (name, width, _) in enumerate(cols):
        ws.write(0, j, name, head)
        ws.set_column(j, j, width)
    for i, l in enumerate(lines, start=1):
        for j, (_, _, k) in enumerate(cols):
            if k == "amount":
                ws.write_number(i, j, l[k], money)
            elif k == "cfo":
                ws.write(i, j, T("財務長", "CFO") if l[k] else T("部門主管", "Dept head"), cell)
            elif k == "dept":
                ws.write(i, j, core.dept_label(l[k], lang), cell)
            else:
                ws.write(i, j, str(l[k]), cell)
    end = len(lines) + 1
    ws.write(end, 0, T("合計", "Total"), total_lbl)
    for j in range(1, len(cols) - 1):
        ws.write_blank(end, j, None, total_lbl)
    ws.write_formula(end, len(cols) - 1, f"=SUBTOTAL(9,M2:M{end})", total_num, sum(l["amount"] for l in lines))  # 篩選後合計會跟著變
    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, max(1, len(lines)), len(cols) - 1)

    info = wb.add_worksheet(T("匯出說明", "About this export"))
    info.set_column(0, 0, 18)
    info.set_column(1, 1, 70)
    info.write(0, 0, T(f"FY{year} 費用明細帳", f"FY{year} expense ledger"), title)
    filters = [x for x in (core.dept_label(dept, lang) if dept else "", gl, T("只看需財務長核准", "CFO-approval lines only") if cfo_only else "",
                           T(f"關鍵字「{query.strip()}」", f'keyword "{query.strip()}"') if q else "") if x]
    rows = [
        (T("年度", "Fiscal year"), f"FY{year}"),
        (T("資料截至", "Data through"), T(f"{c['cutoff']} 月", f"M{c['cutoff']}")),
        (T("部門範圍", "Departments"), (", " if lang == "en" else "、").join(core.dept_label(d, lang) for d in depts)),
        (T("篩選條件", "Filters"), (", " if lang == "en" else "、").join(filters) or T("無（全部明細）", "None (all lines)")),
        (T("筆數／合計", "Lines / total"), T(f"{len(lines):,} 筆，{core.fmc(sum(l['amount'] for l in lines))}", f"{len(lines):,} lines, {core.fmc(sum(l['amount'] for l in lines), lang='en')}")),
        (T("匯出時間", "Exported"), datetime.now().strftime("%Y-%m-%d %H:%M")),
        (T("個資", "Personal data"), T("經辦人欄位僅供內控與稽核追蹤，不作為個人績效評比", "The handler field is for internal-control traceability only, not performance review")
         + (T("；財務分析師身分匯出的姓名已遮罩。", "; names are masked for the FP&A role.") if role == "fpa" else T("。", "."))),
    ]
    if core.dataset_info(ds)["source"] == "synthetic":
        rows.append((T("資料來源", "Source"), T("合成示範明細，供應商與人名皆為虛構；每月合計與月支出完全對帳。", "Synthetic demo lines; vendor and personal names are fictional; each month reconciles to the monthly actual.")))
    for i, (k, v) in enumerate(rows, start=2):
        info.write(i, 0, k, muted)
        info.write(i, 1, v, cell)
    wb.close()
    suffix = T("費用明細帳", "expense_ledger")
    return buf.getvalue(), f"FY{year}_{suffix}.xlsx"


def transfer_request(req, lang="zh", synthetic=True):
    """預算調撥申請單（草稿）：內容是使用者在情境頁看到並可修改原因的同一份資料，下載不會變更任何預算。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    sign = lambda v: f"{'+' if v > 0 else ''}{v:g}%"
    side = lambda fc, bud: f"{f(fc)} / {f(bud)}（{core.fpct((fc - bud) / bud * 100 if bud else 0, signed=True)}）" if lang != "en" \
        else f"{f(fc)} / {f(bud)} ({core.fpct((fc - bud) / bud * 100 if bud else 0, signed=True)})"
    title = T("預算調撥申請單", "Budget Transfer Request")
    footer = T("草稿：列印或存成 PDF 不會變更任何預算，也不會送出簽核。", "Draft: printing or saving does not change any budget or submit an approval.")
    pdf = BudgetPDF(title, footer, lang)
    pdf.cover(title, T("草稿 · 待人工覆核與核准", "Draft · pending review and approval"),
              [req.no, f"FY{req.year}", T(f"申請日期 {req.date}", f"Date {req.date}")] + ([T("示範資料", "Demo data")] if synthetic else []))
    pdf.heading(T("調撥內容", "Transfer details"))
    pdf.fields([
        (T("調出部門", "From department"), core.dept_label(req.fromDept, lang)),
        (T("調入部門", "To department"), core.dept_label(req.toDept, lang)),
        (T("建議調撥金額上限", "Suggested amount cap"), f(req.amount)),
        (T("調出部門 年底預測／預算", "From: forecast / budget"), side(req.fromForecast, req.fromBudget)),
        (T("調入部門 年底預測／預算", "To: forecast / budget"), side(req.toForecast, req.toBudget)),
        (T("情境假設", "Scenario"), T(f"通膨 {sign(req.infl)} · 業務量 {sign(req.vol)} · 匯率 {sign(req.fx)}",
                                      f"Inflation {sign(req.infl)} · Volume {sign(req.vol)} · FX {sign(req.fx)}")),
    ])
    pdf.heading(T("申請原因", "Rationale"))
    pdf.note_box(req.reason.strip() or T("（未填寫）", "(not provided)"))
    pdf.heading(T("簽核", "Approvals"))
    pdf.signatures([T("申請人", "Requester"), T("調出部門主管", "From-dept head"), T("調入部門主管", "To-dept head"), T("財務長", "CFO")])
    pdf.paragraph(T("調撥金額為依年底預測與情境假設計算的建議上限；實際金額及專案承諾須由主管覆核後，於正式簽核系統送出。",
                    "The amount is a suggested cap based on the year-end forecast and scenario; managers must review the final amount and commitments before submitting it in the formal approval system."),
                  size=8.5, color=MUTED)
    return bytes(pdf.output()), f"{req.no}.pdf"


def brief_report(year, depts, text, source, check, ds="", lang="zh", th=core.DEFAULT_TH):
    """AI 主管簡報 PDF：指標卡由系統計算，正文是畫面上同一份 AI 簡報（不重新產生，避免和使用者看到的不同）。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    one = core.dept_label(depts[0], lang) if len(depts) == 1 else None
    pdf, _ = _start(year, depts, ds, lang, th,
                    T(f"FY{year} {one} AI 預算簡報", f"FY{year} {one} AI Budget Brief") if one else T(f"FY{year} AI 預算預警簡報", f"FY{year} AI Budget Alert Brief"),
                    lambda closed: T("重點摘要、原因與建議行動", "Key points, causes and recommended actions") if one
                    else T("主管摘要、預警部門與建議行動", "Executive summary, flagged departments and recommended actions"))
    pdf.markdown_block(text.replace(MARK_OPEN, "").replace(MARK_CLOSE, ""))
    pdf.ln(2)
    note = T(f"產生來源：{source}。指標卡與燈號由系統計算；AI 只負責撰寫文字。", f"Written by: {source}. Key figures and alert status are calculated by the system; AI only writes the text.")
    if check:
        ok = check.get("exact", 0) + check.get("derived", 0)
        note += T(f"數字查核：{ok} 個數字與系統資料一致", f" Number check: {ok} figures match the system data") + (
            T(f"，{check['unmatched']} 個無法對應，請再確認。", f"; {check['unmatched']} could not be traced, please double-check.") if check.get("unmatched") else T("。", "."))
    pdf.note_box(note)
    name = f"FY{year}_{'AI_alert_brief' if lang == 'en' else 'AI預警簡報'}.pdf"
    return bytes(pdf.output()), name
