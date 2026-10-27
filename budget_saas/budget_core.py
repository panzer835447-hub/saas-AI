"""預算預測核心邏輯（不依賴 Streamlit）。

資料生成、預測與預警規則自 app.py 移植；兩邊的數字必須一致，修改時請同步。
目前只輸出中文文字。
"""
import uuid
from collections import OrderedDict
from functools import lru_cache

import numpy as np
import pandas as pd

# ==========================================
# 1. 部門與狀態
# ==========================================
DEPT_EN = {
    "資訊部": "IT", "行銷部": "Marketing", "核保部": "Underwriting",
    "理賠部": "Claims", "精算部": "Actuarial", "財務部": "Finance",
    "人資行政部": "HR and Administration", "法遵風控部": "Risk and Compliance",
}
DEPT_COLORS = {
    "資訊部": "#4C86C6", "行銷部": "#D08C34", "核保部": "#3E9A78", "理賠部": "#CF625D",
    "精算部": "#9C73A8", "財務部": "#4FA7B9", "人資行政部": "#A88A4E", "法遵風控部": "#7279B0",
}
STATUS_ORDER = ["高風險超支", "需注意", "執行落後", "預算正常"]
STATUS_SEVERITY = {status: i for i, status in enumerate(STATUS_ORDER)}
STATUS_KEY = {"高風險超支": "high", "需注意": "watch", "執行落後": "lag", "預算正常": "ok"}
# 預警門檻（%）：高風險超支、需注意、執行落後。預設與 app.py 相同，財務長可在系統設定調整；
# 門檻會一路傳進有快取的函式當參數，不同門檻的結果不會互相污染
DEFAULT_TH = (105, 102, 90)
TH_LIMITS = {"high": (101, 130), "watch": (100, 120), "lag": (50, 99)}


def parse_th(text):
    """前端傳來的「105,102,90」→ (105, 102, 90)；格式不對或順序不合理就用預設值。"""
    try:
        high, watch, lag = (int(round(float(v))) for v in str(text).split(","))
    except (TypeError, ValueError):
        return DEFAULT_TH
    ok = (TH_LIMITS["high"][0] <= high <= TH_LIMITS["high"][1] and TH_LIMITS["watch"][0] <= watch <= TH_LIMITS["watch"][1]
          and TH_LIMITS["lag"][0] <= lag <= TH_LIMITS["lag"][1] and high > watch)
    return (high, watch, lag) if ok else DEFAULT_TH


def th_dict(th=DEFAULT_TH):
    return dict(zip(("high", "watch", "lag"), th))

# ==========================================
# 2. 合成管理會計資料
# ==========================================
CPI_YOY = {2021: 0.0197, 2022: 0.0295, 2023: 0.0249, 2024: 0.0218, 2025: 0.0160, 2026: 0.0200}
EXPANSION = 0.02
DEPTS = [
    '資訊部 (IT)', '行銷部 (Marketing)', '核保部 (Underwriting)', '理賠部 (Claims)',
    '精算部 (Actuarial)', '財務部 (Finance)', '人資行政部 (HR and Administration)',
    '法遵風控部 (Risk and Compliance)',
]
DEFAULT_OPEX_ANCHOR = 30.0 * 1e8  # 8 個部門年度預算合計（新台幣元）
DEPT_SHARE = {
    DEPTS[0]: .22, DEPTS[1]: .18, DEPTS[2]: .09, DEPTS[3]: .12,
    DEPTS[4]: .07, DEPTS[5]: .09, DEPTS[6]: .13, DEPTS[7]: .10,
}
BUDGET_PHASING = {
    "資訊部": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1.15, 1.2, 1.25],
    "行銷部": [.85, .75, .95, 1, 1, .95, .9, .95, 1, 1.1, 1.3, 1.35],
    "核保部": [1] * 12,
    "理賠部": [1, .95, 1, 1, 1, 1, 1.05, 1.1, 1.1, 1.05, 1, 1],
    "精算部": [1.2, 1.15, 1.05, .95, .95, .95, .95, .95, 1, .95, .95, 1.05],
    "財務部": [1.25, 1.2, 1.15, 1.05, .9, .9, .9, .9, .95, .95, .9, .95],
    "人資行政部": [.95, .85, 1, 1, 1, 1.15, 1, .95, 1, 1, .95, 1.15],
    "法遵風控部": [.95, .9, 1.1, .95, .95, 1, .95, .95, 1.1, .95, .95, 1.15],
}
YEAR_END_FLUSH = {"行銷部": .22, "人資行政部": .25, "核保部": .18, "財務部": .15}
ONE_OFF_EVENTS = {
    ("資訊部", 2022, 11): (.05, "資料中心 UPS 汰換（CAPEX）"),
    ("資訊部", 2024, 9): (.07, "一次性伺服器汰換（CAPEX）"),
    ("精算部", 2025, 3): (.08, "IFRS 17 精算引擎授權（一次性）"),
    ("理賠部", 2025, 6): (.05, "理賠影像系統升級（CAPEX）"),
    ("財務部", 2026, 2): (.06, "IFRS 17 財報系統上線驗證（一次性）"),
    ("法遵風控部", 2026, 4): (.07, "TW-ICS 接軌系統建置（CAPEX）"),
}
YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
MONTHS = list(range(1, 13))
CURRENT_DATE = (2026, 8)  # 假設目前結算至 2026 年 8 月


def dept_key(department):
    return department.split(" (")[0]


@lru_cache(maxsize=4)
def generate_monthly_db(anchor_total=DEFAULT_OPEX_ANCHOR):
    rng = np.random.default_rng(42)
    index = {YEARS[0]: 1.0}
    for y in YEARS[1:]:
        index[y] = index[y - 1] * (1 + CPI_YOY[y] + EXPANSION)
    rows = []
    for y in YEARS:
        for d in DEPTS:
            key = dept_key(d)
            annual_budget = anchor_total * DEPT_SHARE[d] * index[y] / index[YEARS[-1]]
            phasing = np.array(BUDGET_PHASING[key], dtype=float)
            phasing /= phasing.sum()
            flush = YEAR_END_FLUSH.get(key, 0.0)
            for m in MONTHS:
                budget = annual_budget * phasing[m - 1]
                one_off, note = 0.0, ""
                if (y, m) > CURRENT_DATE:
                    rows.append({"Year": y, "Month": m, "Department": d, "Budget": round(budget),
                                 "Actual": np.nan, "OneOffAmount": 0.0, "EventNote": ""})
                    continue
                r = rng.uniform(.96, 1.04)
                if flush:
                    r *= (1 - .4 * flush) if m <= 9 else (1.0 if m == 10 else 1 + 1.8 * flush)
                if key == "資訊部" and y == 2026:
                    r = rng.uniform(.98, 1.02) * (1.06 + .02 * m)
                    note = "雲端遷移專案超支"
                elif key == "法遵風控部" and y == 2026:
                    r = rng.uniform(1.08, 1.15)
                    note = "TW-ICS 外部顧問費增加"
                elif key == "核保部" and y == 2025 and m >= 9:
                    r = rng.uniform(.75, .85)
                    note = "核保系統專案延宕"
                elif key == "精算部" and y == 2026:
                    r = rng.uniform(.84, .90)
                    note = "精算部職缺招募延後"
                elif key == "人資行政部" and y == 2026 and m >= 7:
                    r = rng.uniform(.55, .65)
                    note = "教育訓練專案遞延"
                elif key == "理賠部" and y == 2024 and m in (9, 10):
                    r *= 1.25
                    note = "颱風季理賠查勘量增加"
                actual = budget * r
                event = ONE_OFF_EVENTS.get((key, y, m))
                if event:
                    one_off = annual_budget * event[0]
                    note = event[1]
                    actual += one_off
                rows.append({"Year": y, "Month": m, "Department": d, "Budget": round(budget),
                             "Actual": round(actual), "OneOffAmount": round(one_off), "EventNote": note})
    return pd.DataFrame(rows)


# 使用者上傳的資料集（只存在記憶體，伺服器重啟即消失）；ds 為空字串時使用合成示範資料
_UPLOADS = OrderedDict()
MAX_UPLOADS = 20


def register_dataset(data, name, source="upload", scale=None):
    ds = uuid.uuid4().hex[:12]
    _UPLOADS[ds] = (data, name, source, scale)
    while len(_UPLOADS) > MAX_UPLOADS:
        _UPLOADS.popitem(last=False)
    return ds


SCALE_LIMITS = (5, 500)  # 公司年度營業費用量級（億元）


def scaled_demo(scale_100m):
    """依公司規模（億元）產生合成示範資料，沿用上傳資料的資料集機制；預設 30 億就直接用內建資料。"""
    scale = round(min(max(float(scale_100m), SCALE_LIMITS[0]), SCALE_LIMITS[1]), 1)
    if scale * 1e8 == DEFAULT_OPEX_ANCHOR:
        return ""
    for ds, (_, _, source, s) in _UPLOADS.items():  # 同一量級不重複產生
        if source == "synthetic" and s == scale:
            return ds
    return register_dataset(generate_monthly_db(scale * 1e8), "合成示範資料", "synthetic", scale)


def dataset(ds=""):
    hit = _UPLOADS.get(ds)
    return hit[0] if hit else generate_monthly_db()


def dataset_info(ds=""):
    hit = _UPLOADS.get(ds)
    data = dataset(ds)
    year, month = data_cutoff(data)
    source = hit[2] if hit else "synthetic"
    scale = (hit[3] if hit else DEFAULT_OPEX_ANCHOR / 1e8) if source == "synthetic" else None
    return {"id": ds if hit else "", "source": source, "name": hit[1] if hit else "合成示範資料", "scale": scale,
            "rows": int(len(data)), "years": int(data.Year.nunique()), "cutoff": {"year": year, "month": month}}


def data_cutoff(data):
    """資料中最後一個已結算月份（年、月）。"""
    closed = data[data.Actual.notna()]
    if closed.empty:
        return int(data.Year.min()), 0
    last = closed.sort_values(["Year", "Month"]).iloc[-1]
    return int(last.Year), int(last.Month)


def data_years(data):
    return sorted(int(y) for y in data.Year.unique())


# ==========================================
# 3. 核心分析引擎
# ==========================================
def classify_status(ratio, th=DEFAULT_TH):
    high, watch, lag = th
    if ratio > high / 100:
        return '高風險超支'
    if ratio > watch / 100:
        return '需注意'
    if ratio < lag / 100:
        return '執行落後'
    return '預算正常'


def _recurring(history):
    return history.assign(RecurringActual=history.Actual - history.OneOffAmount.fillna(0))


def complete_history(data, department, before_year):
    history = data[(data.Department == department) & (data.Year < before_year) & data.Actual.notna()]
    complete_years = [int(year) for year, annual in history.groupby("Year")
                      if annual.Month.nunique() == 12 and annual.Actual.notna().all()]
    return history[history.Year.isin(complete_years)]


def forecast_for_year(data, target_year, department, cutoff_month):
    year_data = data[(data.Year == target_year) & (data.Department == department)]
    observed = year_data[year_data.Actual.notna() & (year_data.Month <= cutoff_month)]
    if observed.empty:
        annual_budget = float(year_data.Budget.sum())
        history = complete_history(data, department, target_year)
        return annual_budget, annual_budget, np.nan, int(history.Year.nunique())

    actual_ytd = float(observed.Actual.sum())
    one_off_ytd = float(observed.OneOffAmount.fillna(0).sum())
    recurring_ytd = max(0.0, actual_ytd - one_off_ytd)
    budget_ytd = float(observed.Budget.sum())
    annual_budget = float(year_data.Budget.sum())
    run_rate = one_off_ytd + recurring_ytd + max(0.0, annual_budget - budget_ytd) * (recurring_ytd / budget_ytd if budget_ytd else 1.0)

    history = complete_history(data, department, target_year)
    seasonality_years = history.groupby("Year").Actual.sum()
    seasonal_fc = np.nan
    if not history.empty:
        monthly = _recurring(history).groupby(["Year", "Month"]).RecurringActual.sum().unstack("Month").reindex(columns=MONTHS)
        shares = monthly.div(monthly.sum(axis=1).replace(0, np.nan), axis=0)
        cumulative_share = shares.loc[:, :cutoff_month].sum(axis=1).mean()
        if pd.notna(cumulative_share) and cumulative_share > 0:
            seasonal_fc = one_off_ytd + recurring_ytd / float(cumulative_share)

    forecast = .55 * seasonal_fc + .45 * run_rate if pd.notna(seasonal_fc) else run_rate
    return float(forecast), float(run_rate), float(seasonal_fc) if pd.notna(seasonal_fc) else np.nan, int(len(seasonality_years))


def backtest_forecasts(data, target_year, department, cutoff_month):
    rows = []
    years = sorted(int(y) for y in data.loc[(data.Department == department) & (data.Year < target_year), "Year"].unique())
    for year in years:
        complete = data[(data.Year == year) & (data.Department == department)]
        if complete.Month.nunique() != 12 or complete.Actual.isna().any():
            continue
        forecast, _, _, history_count = forecast_for_year(data, year, department, min(cutoff_month, 11))
        if pd.isna(forecast) or history_count < 1:
            continue
        rows.append(abs(forecast - float(complete.Actual.sum())))
    return rows


@lru_cache(maxsize=64)
def analyze_budget(target_year, target_depts, ds="", th=DEFAULT_TH):
    data = dataset(ds)
    out = []
    for d in target_depts:
        df_dept_year = data[(data.Year == target_year) & (data.Department == d)]
        done_df = df_dept_year[df_dept_year.Actual.notna()]
        b_ytd, a_ytd, b_full = done_df.Budget.sum(), done_df.Actual.sum(), df_dept_year.Budget.sum()
        cutoff_month = int(done_df.Month.max()) if not done_df.empty else 12
        eoy_forecast, run_rate_forecast, seasonal_forecast, history_count = forecast_for_year(data, target_year, d, cutoff_month)
        if pd.isna(eoy_forecast):
            eoy_forecast, run_rate_forecast, seasonal_forecast = a_ytd, a_ytd, np.nan
        if done_df.Month.nunique() == 12:
            # 12 個月都已結算：年底數字就是實際數，沒有預測誤差（舊版會對已結束年度仍給 ±15% 區間）
            error_margin = 0.0
        else:
            errors = backtest_forecasts(data, target_year, d, cutoff_month)
            error_margin = float(np.quantile(errors, .8)) if errors else max(b_full * .15, 1.0)
        forecast_var = eoy_forecast - b_full
        out.append({
            'Department': d,
            'Budget_YTD': b_ytd, 'Actual_YTD': a_ytd,
            'Actual_Cutoff_Month': cutoff_month if not done_df.empty else 0,
            'Budget_Full': b_full,
            'Exec_Rate': (a_ytd / b_ytd * 100) if b_ytd > 0 else 100.0,
            'Forecast_EOY': eoy_forecast,
            'Forecast_Low': max(0.0, eoy_forecast - error_margin),
            'Forecast_High': eoy_forecast + error_margin,
            'Forecast_Run_Rate': run_rate_forecast,
            'Forecast_Seasonal': seasonal_forecast,
            'History_Years': history_count,
            'Forecast_Var': forecast_var,
            'Forecast_Pct': (forecast_var / b_full) * 100 if b_full > 0 else 0,
            'Status': classify_status(eoy_forecast / b_full, th) if b_full > 0 else '預算正常',
        })
    return pd.DataFrame(out)


def allocate_remaining_by_month(analysis, data, year):
    """把各部門剩餘的年底預測分配到未結算月份（55% 歷史季節性、45% 平均）。"""
    per_dept = {}
    for row in analysis.itertuples(index=False):
        dept = row.Department
        estimate = pd.Series(0.0, index=MONTHS)
        future_months = [m for m in MONTHS if m > int(row.Actual_Cutoff_Month)]
        remaining = max(0.0, float(row.Forecast_EOY - row.Actual_YTD))
        if future_months and remaining > 0:
            history = complete_history(data, dept, year)
            seasonal_total = 0.0
            if not history.empty:
                annual_monthly = _recurring(history).groupby(["Year", "Month"]).RecurringActual.sum().unstack("Month").reindex(columns=MONTHS)
                seasonal_shares = annual_monthly.div(annual_monthly.sum(axis=1).replace(0, np.nan), axis=0).mean(axis=0).reindex(future_months).fillna(0.0)
                seasonal_total = float(seasonal_shares.sum())
            if seasonal_total > 0:
                weights = .55 * (seasonal_shares / seasonal_total) + .45 / len(future_months)
            else:
                budget = data[(data.Year == year) & (data.Department == dept)].set_index("Month").Budget.reindex(future_months).fillna(0.0)
                weights = budget / budget.sum() if float(budget.sum()) > 0 else pd.Series(1 / len(future_months), index=future_months)
            for month, weight in weights.items():
                estimate.loc[int(month)] += remaining * float(weight)
        per_dept[dept] = estimate
    return per_dept


@lru_cache(maxsize=64)
def _replay_numbers(target_year, target_depts, ds=""):
    """回放的數字部分（每個月底重算年底預測，約 2 秒）；和門檻無關，所以單獨快取，調整門檻只需重新分類。"""
    data = dataset(ds)
    rows = []
    for department in target_depts:
        year_data = data[(data.Year == target_year) & (data.Department == department)].sort_values("Month")
        if year_data.Month.nunique() != 12 or year_data.Actual.isna().any():
            continue
        budget, actual = float(year_data.Budget.sum()), float(year_data.Actual.sum())
        if not budget:
            continue
        cum_actual, cum_budget = year_data.Actual.cumsum().to_numpy(), year_data.Budget.cumsum().to_numpy()
        for month in range(1, 12):
            forecast = forecast_for_year(data, target_year, department, month)[0]
            ytd_rate = cum_actual[month - 1] / cum_budget[month - 1] if cum_budget[month - 1] else 1.0
            rows.append({"Department": department, "Month": month, "Forecast": forecast / budget, "Ytd": ytd_rate, "Final": actual / budget})
    return rows


def early_warning_replay(target_year, target_depts, ds="", th=DEFAULT_TH):
    """回放已結算年度：每個月底本系統會亮的燈，對照傳統月報（累計實際 ÷ 累計預算）。"""
    return pd.DataFrame([{
        "Department": r["Department"], "Month": r["Month"],
        "Forecast_Use": r["Forecast"] * 100, "Status": classify_status(r["Forecast"], th),
        "Ytd_Rate": r["Ytd"] * 100, "Ytd_Status": classify_status(r["Ytd"], th),
        "Final_Use": r["Final"] * 100, "Final_Status": classify_status(r["Final"], th),
    } for r in _replay_numbers(target_year, target_depts, ds)])


def alert_direction(status):
    return "over" if status in ("高風險超支", "需注意") else "under" if status == "執行落後" else None


def first_steady_alert(statuses, final_status):
    """從哪個月起燈號方向和年底結果一致，而且一路維持到 11 月。"""
    target, first = alert_direction(final_status), None
    if target is None:
        return None
    for month, status in statuses:
        if alert_direction(status) == target:
            first = first or month
        else:
            first = None
    return first


# ==========================================
# 4. 文字格式
# ==========================================
STATUS_EN = {"高風險超支": "High overspend risk", "需注意": "Monitor closely", "執行落後": "Behind plan", "預算正常": "On track"}
EVENT_EN = {
    "資料中心 UPS 汰換（CAPEX）": "Data-centre UPS replacement (CAPEX)",
    "一次性伺服器汰換（CAPEX）": "One-off server replacement (CAPEX)",
    "一次性伺服器汰換": "One-off server replacement",
    "IFRS 17 精算引擎授權（一次性）": "IFRS 17 actuarial engine licence (one-off)",
    "理賠影像系統升級（CAPEX）": "Claims imaging system upgrade (CAPEX)",
    "IFRS 17 財報系統上線驗證（一次性）": "IFRS 17 reporting go-live validation (one-off)",
    "TW-ICS 接軌系統建置（CAPEX）": "TW-ICS implementation build (CAPEX)",
    "颱風季理賠查勘量增加": "Typhoon-season claims inspection surge",
    "雲端遷移專案超支": "Cloud migration project overrun",
    "TW-ICS 外部顧問費增加": "Higher TW-ICS consulting fees",
    "核保系統專案延宕": "Underwriting system project delayed",
    "教育訓練專案遞延": "Training programme deferred",
    "精算部職缺招募延後": "Actuarial vacancies filled later than planned",
}


def tx(lang, zh, en):
    return en if lang == "en" else zh


def dept_label(department, lang="zh"):
    key = dept_key(department)
    return DEPT_EN.get(key, key) if lang == "en" else key


def status_label(status, lang="zh"):
    return STATUS_EN.get(status, status) if lang == "en" else status


def event_label(note, lang="zh"):
    return EVENT_EN.get(note, note) if lang == "en" else note


def fmc(val, signed=False, lang="zh"):
    """中文：1 億以上用「億」（30 億、30.71 億），以下用「萬」（2,950 萬）。英文：NT$ B / M（與 app.py 相同）。"""
    val = float(val)
    v = abs(val)
    trim = lambda x: f"{x:,.2f}".rstrip("0").rstrip(".")
    if lang == "en":
        body = f"NT${trim(v / 1e9)}B" if v >= 1e9 else f"NT${v / 1e6:,.1f}M" if v >= 1e6 else f"NT${v / 1e3:,.0f}K"
    else:
        body = f"{trim(v / 1e8)} 億" if v >= 1e8 else f"{v / 1e4:,.0f} 萬" if v >= 1e4 else f"{v:,.0f} 元"
    is_zero = body.startswith(("0 ", "NT$0K", "NT$0.0M"))
    sign = "-" if val < 0 and not is_zero else ("+" if signed and val > 0 and not is_zero else "")
    return sign + body


def fpct(value, signed=False, decimals=1):
    value = float(value)
    if round(value, decimals) == 0 and value != 0:
        decimals += 2
    return f"{value:+.{decimals}f}%" if signed else f"{value:.{decimals}f}%"


def risk_evidence(data, target_year, row, lang="zh"):
    T = lambda zh, en: tx(lang, zh, en)
    sep = ", " if lang == "en" else "、"
    reasons = []
    cutoff = int(row.Actual_Cutoff_Month)
    year_rows = data[(data.Year == target_year) & (data.Department == row.Department) & (data.Month <= cutoff)]
    one_off_ytd = float(year_rows.OneOffAmount.fillna(0).sum())
    if one_off_ytd > 0:
        notes = [event_label(n, lang) for n in year_rows.loc[year_rows.OneOffAmount > 0, "EventNote"].dropna().unique() if str(n).strip()]
        text = sep.join(notes) or T("已標記的一次性支出", "identified one-off spending")
        reasons.append(T(f"今年已發生一次性支出：{text} {fmc(one_off_ytd)}（只計一次，不會被預測成每月重複發生）",
                         f"One-off spending this year: {text} of {fmc(one_off_ytd, lang=lang)} (counted once, not projected to recur monthly)"))
    if row.Exec_Rate >= 105:
        reasons.append(T(f"同期實際支出已高於預算 {row.Exec_Rate - 100:.1f}%", f"Actual spending is {row.Exec_Rate - 100:.1f}% above budget to date"))
    elif row.Exec_Rate <= 92:
        reasons.append(T(f"同期實際支出僅達預算的 {row.Exec_Rate:.1f}%", f"Actual spending is only {row.Exec_Rate:.1f}% of budget to date"))
    history = complete_history(data, row.Department, target_year)
    if not history.empty:
        annual_months = _recurring(history).groupby(["Year", "Month"]).RecurringActual.sum().unstack("Month").reindex(columns=MONTHS)
        historical_ytd = annual_months.loc[:, :cutoff].sum(axis=1).mean()
        recurring_ytd = max(0.0, row.Actual_YTD - one_off_ytd)
        if historical_ytd > 0 and recurring_ytd / historical_ytd >= 1.05:
            gap = (recurring_ytd / historical_ytd - 1) * 100
            reasons.append(T(f"扣除一次性支出後，經常性支出仍高於往年同期平均 {gap:.1f}%",
                             f"Recurring spending remains {gap:.1f}% above the historical same-period average after excluding one-offs"))
    recurring_notes = [event_label(n, lang) for n in year_rows.loc[year_rows.OneOffAmount <= 0, "EventNote"].dropna().unique() if str(n).strip()]
    if recurring_notes:
        reasons.append(T(f"已標記事件：{sep.join(recurring_notes)}", f"Tagged events: {sep.join(recurring_notes)}"))
    if pd.notna(row.Forecast_Seasonal) and row.Forecast_EOY > 0:
        model_gap = abs(row.Forecast_Seasonal - row.Forecast_Run_Rate) / row.Forecast_EOY
        if model_gap >= .08:
            reasons.append(T(f"季節性推估與依目前速度推估相差 {model_gap * 100:.1f}%，年底前需持續追蹤",
                             f"Seasonal and current-pace estimates differ by {model_gap * 100:.1f}%; keep monitoring until year end"))
    if not reasons:
        reasons.append(T("主要依年底預測與年度預算之差異觸發，建議檢視剩餘月份計畫。",
                         "Triggered mainly by the gap between the year-end forecast and budget; review plans for the remaining months."))
    return reasons


def executive_summary(analysis, lang="zh"):
    """規則產生的一段結論，放在總覽頁最上方。"""
    T = lambda zh, en: tx(lang, zh, en)
    f = lambda v, s=False: fmc(v, s, lang)
    total_var = float(analysis.Forecast_EOY.sum() - analysis.Budget_Full.sum())
    budget = float(analysis.Budget_Full.sum())
    pct = total_var / budget * 100 if budget else 0.0
    closed = int(analysis.Actual_Cutoff_Month.min()) >= 12  # 已結算完整年度：講實際數，不講預估與調撥
    if closed:
        parts = [T(f"全年實際總支出 {f(analysis.Forecast_EOY.sum())}，較年度預算{'多' if total_var > 0 else '少'} {f(abs(total_var))}（{fpct(pct, signed=True)}）。",
                   f"Full-year spending was {f(analysis.Forecast_EOY.sum())}, {f(abs(total_var))} {'above' if total_var > 0 else 'below'} the annual budget ({fpct(pct, signed=True)}).")]
    else:
        parts = [T(f"預估年底總支出 {f(analysis.Forecast_EOY.sum())}，較年度預算{'多' if total_var > 0 else '少'} {f(abs(total_var))}（{fpct(pct, signed=True)}）。",
                   f"Year-end spending is projected at {f(analysis.Forecast_EOY.sum())}, {f(abs(total_var))} {'above' if total_var > 0 else 'below'} the annual budget ({fpct(pct, signed=True)}).")]
    pressure = analysis[analysis.Status.isin(["高風險超支", "需注意"])].sort_values("Forecast_Var", ascending=False)
    if not pressure.empty:
        if lang == "en":
            names = ", ".join(f"{dept_label(r.Department, lang)} ({f(r.Forecast_Var, True)})" for r in pressure.head(2).itertuples())
        else:
            names = "、".join(f"{dept_key(r.Department)}（{f(r.Forecast_Var, True)}）" for r in pressure.head(2).itertuples())
        parts.append(T(f"{'超支主要來自' if closed else '主要超支壓力來自'} {names}。",
                       f"{'Most of the overspend came from' if closed else 'The main overspend pressure comes from'} {names}."))
    headroom = analysis[analysis.Status == "執行落後"]
    if not headroom.empty:
        names = (", " if lang == "en" else "、").join(dept_label(d, lang) for d in headroom.Department)
        if closed:
            parts.append(T(f"{names} 全年結餘合計 {f(-headroom.Forecast_Var.sum())}，可作為下年度編列預算的參考。",
                           f"{names} left {f(-headroom.Forecast_Var.sum())} unused, worth reflecting in next year's budget."))
        else:
            parts.append(T(f"{names} 預估結餘合計 {f(-headroom.Forecast_Var.sum())}，可優先評估內部調撥。",
                           f"{names} may leave {f(-headroom.Forecast_Var.sum())} unused, a first source for reallocation."))
    if pressure.empty and headroom.empty:
        parts.append(T("所有部門皆在預警門檻內。", "All departments are within alert thresholds."))
    return parts


# ==========================================
# 5. 總覽頁資料
# ==========================================
def _cum(series):
    return [None if pd.isna(v) else round(float(v)) for v in series]


def meta(ds=""):
    data = dataset(ds)
    info = dataset_info(ds)
    present = set(data.Department.unique())
    return {
        "years": data_years(data)[::-1],
        "departments": [{"id": d, "name": dept_key(d), "en": DEPT_EN[dept_key(d)], "color": DEPT_COLORS[dept_key(d)]} for d in DEPTS if d in present],
        "cutoff": info["cutoff"],
        "thresholds": th_dict(), "thresholdLimits": TH_LIMITS,
        "dataset": info,
    }


def overview(year, depts, ds="", lang="zh", th=DEFAULT_TH):
    data = dataset(ds)
    present = set(data.Department.unique())
    depts = tuple(d for d in DEPTS if d in depts and d in present) or tuple(d for d in DEPTS if d in present)
    analysis = analyze_budget(year, depts, ds, th)
    year_frame = data[(data.Year == year) & data.Department.isin(depts)]
    cutoff = int(analysis.Actual_Cutoff_Month.max())
    estimates = allocate_remaining_by_month(analysis, data, year)

    tb, ta, tf = float(analysis.Budget_Full.sum()), float(analysis.Actual_YTD.sum()), float(analysis.Forecast_EOY.sum())
    budget_ytd = float(analysis.Budget_YTD.sum())
    low, high = float(analysis.Forecast_Low.sum()), float(analysis.Forecast_High.sum())

    # 去年同期：同部門、同結算月份
    prev = data[(data.Year == year - 1) & data.Department.isin(depts)]
    prev_budget = float(prev.Budget.sum())
    prev_ytd = prev[prev.Month <= cutoff]
    prev_actual_ytd = float(prev_ytd.Actual.sum())
    prev_full_actual = float(prev.Actual.sum()) if prev.Actual.notna().all() else None

    monthly_budget = year_frame.groupby("Month").Budget.sum().reindex(MONTHS, fill_value=0.0)
    monthly_actual = year_frame.groupby("Month").Actual.agg(lambda v: v.sum(min_count=1)).reindex(MONTHS)
    monthly_estimate = sum(estimates.values(), pd.Series(0.0, index=MONTHS))
    path = (monthly_actual.fillna(0) + monthly_estimate).cumsum()
    # 預測區間：從結算月份往年底逐月展開到 P80 上下限
    span = max(1, 12 - cutoff)
    band = [{"m": m, "low": round(float(path[m] - (tf - low) * (m - cutoff) / span)),
             "high": round(float(path[m] + (high - tf) * (m - cutoff) / span))} for m in MONTHS if m >= cutoff]

    history = []
    for y in sorted(data.Year.unique()):
        if y >= year:
            continue
        frame = data[(data.Year == y) & data.Department.isin(depts)]
        if frame.Actual.isna().any():
            continue
        history.append({
            "year": int(y), "budget": round(float(frame.Budget.sum())), "actual": round(float(frame.Actual.sum())),
            "cum": _cum(frame.groupby("Month").Actual.sum().reindex(MONTHS).cumsum()),
            "ytd": round(float(frame[frame.Month <= cutoff].Actual.sum())),
        })

    rows = []
    for r in analysis.itertuples(index=False):
        key = dept_key(r.Department)
        dept_frame = year_frame[year_frame.Department == r.Department].set_index("Month")
        notes = [event_label(n, lang) for n in dept_frame.EventNote.dropna().unique() if str(n).strip()]
        dept_history = []
        for y in data_years(data):
            if y >= year:
                continue
            f = data[(data.Year == y) & (data.Department == r.Department)]
            if f.Actual.notna().all():
                dept_history.append({"year": y, "budget": round(float(f.Budget.sum())), "actual": round(float(f.Actual.sum())),
                                     "use": round(float(f.Actual.sum() / f.Budget.sum() * 100), 1)})
        prev_dept = prev[(prev.Department == r.Department) & (prev.Month <= cutoff)]
        rows.append({
            "id": r.Department, "name": key, "color": DEPT_COLORS[key],
            "status": r.Status, "statusKey": STATUS_KEY[r.Status],
            "budget": round(r.Budget_Full), "actualYtd": round(r.Actual_YTD), "budgetYtd": round(r.Budget_YTD),
            "forecast": round(r.Forecast_EOY), "low": round(r.Forecast_Low), "high": round(r.Forecast_High),
            "variance": round(r.Forecast_Var), "variancePct": round(r.Forecast_Pct, 1),
            "spentPct": round(r.Actual_YTD / r.Budget_Full * 100, 1) if r.Budget_Full else 0,
            "usePct": round(r.Forecast_EOY / r.Budget_Full * 100, 1) if r.Budget_Full else 0,
            "execRate": round(r.Exec_Rate, 1),
            "runRate": round(r.Forecast_Run_Rate),
            "seasonal": None if pd.isna(r.Forecast_Seasonal) else round(r.Forecast_Seasonal),
            "historyYears": int(r.History_Years),
            "prevYtd": round(float(prev_dept.Actual.sum())) if not prev_dept.empty else None,
            "reason": (", " if lang == "en" else "、").join(notes),
            "evidence": risk_evidence(data, year, r, lang),
            "monthly": {
                "budget": _cum(dept_frame.Budget.reindex(MONTHS)),
                "actual": _cum(dept_frame.Actual.reindex(MONTHS)),
                "estimate": [round(float(v)) if m > cutoff else None for m, v in estimates[r.Department].items()],
            },
            "history": dept_history,
        })
    rows.sort(key=lambda x: (STATUS_SEVERITY[x["status"]], -abs(x["variance"])))

    counts = {s: int((analysis.Status == s).sum()) for s in STATUS_ORDER}
    over = [x for x in rows if x["statusKey"] == "high"]
    return {
        "year": year, "cutoff": cutoff, "departmentCount": len(depts), "thresholds": th_dict(th),
        "totals": {
            "budget": round(tb), "actualYtd": round(ta), "budgetYtd": round(budget_ytd), "forecast": round(tf),
            "variance": round(tf - tb), "variancePct": round((tf - tb) / tb * 100, 2) if tb else 0,
            "spentPct": round(ta / tb * 100, 1) if tb else 0, "planPct": round(budget_ytd / tb * 100, 1) if tb else 0,
            "usePct": round(tf / tb * 100, 1) if tb else 0,
            "lowPct": round(low / tb * 100, 1) if tb else 0, "highPct": round(high / tb * 100, 1) if tb else 0,
            "overCount": int((analysis.Forecast_Var > 0).sum()),
        },
        "prior": {
            "year": year - 1, "budget": round(prev_budget) or None, "actualYtd": round(prev_actual_ytd) or None,
            "fullActual": round(prev_full_actual) if prev_full_actual else None,
            "budgetYoy": round((tb / prev_budget - 1) * 100, 1) if prev_budget else None,
            "ytdYoy": round((ta / prev_actual_ytd - 1) * 100, 1) if prev_actual_ytd else None,
        },
        "statusCounts": [{"status": s, "key": STATUS_KEY[s], "count": counts[s]} for s in STATUS_ORDER],
        "alert": {"count": len(over), "total": round(sum(x["variance"] for x in over)),
                  "items": [{"name": x["name"], "id": x["id"], "variance": x["variance"]} for x in over]},
        "summary": executive_summary(analysis, lang),
        "series": {
            "budgetCum": _cum(monthly_budget.cumsum()),
            "actualCum": _cum(monthly_actual.where(monthly_actual.index <= cutoff).cumsum().where(monthly_actual.index <= cutoff)),
            "forecastCum": [round(float(path[m])) if m >= cutoff else None for m in MONTHS],
            "band": band,
            "monthlyBudget": _cum(monthly_budget),
            "monthlyActual": _cum(monthly_actual),
            "monthlyEstimate": [round(float(v)) if v > 0 else None for v in monthly_estimate],
        },
        "history": history,
        "departments": rows,
    }


# ==========================================
# 6. 提前預警回放
# ==========================================
@lru_cache(maxsize=16)
def replay(depts, ds="", th=DEFAULT_TH):
    data = dataset(ds)
    present = set(data.Department.unique())
    depts = tuple(d for d in DEPTS if d in depts and d in present) or tuple(d for d in DEPTS if d in present)
    scoped = data[data.Department.isin(depts)]
    years = sorted((int(y) for y, g in scoped.groupby("Year") if g.Actual.notna().all() and g.Month.nunique() == 12), reverse=True)
    by_year, problems, sys_false, rep_false, sys_caught, rep_caught, leads, dept_years = {}, 0, 0, 0, 0, 0, [], 0
    for year in years:
        frame = early_warning_replay(year, depts, ds, th)
        rows = []
        for dept, g in frame.groupby("Department", sort=False):
            final_status = g.Final_Status.iloc[0]
            target = alert_direction(final_status)
            sys_month = first_steady_alert(zip(g.Month, g.Status), final_status)
            rep_month = first_steady_alert(zip(g.Month, g.Ytd_Status), final_status)
            row = {
                "id": dept, "name": dept_key(dept), "finalStatus": final_status, "finalKey": STATUS_KEY[final_status],
                "finalUse": round(float(g.Final_Use.iloc[0]), 1),
                "systemMonth": sys_month, "reportMonth": rep_month,
                # 亮錯燈：燈號亮了，但方向和年底結果不同（含年底其實正常的部門）
                "systemFalse": int(sum(alert_direction(s) not in (None, target) for s in g.Status)),
                "reportFalse": int(sum(alert_direction(s) not in (None, target) for s in g.Ytd_Status)),
                "months": [{"m": int(r.Month), "use": round(float(r.Forecast_Use), 1), "key": STATUS_KEY[r.Status],
                            "wrong": alert_direction(r.Status) not in (None, target),
                            "ytd": round(float(r.Ytd_Rate), 1), "ytdKey": STATUS_KEY[r.Ytd_Status],
                            "ytdWrong": alert_direction(r.Ytd_Status) not in (None, target)}
                           for r in g.itertuples()],
            }
            rows.append(row)
            dept_years += 1
            sys_false += row["systemFalse"]
            rep_false += row["reportFalse"]
            if final_status != "預算正常":
                problems += 1
                if sys_month:
                    sys_caught += 1
                    leads.append(12 - sys_month)
                if rep_month:
                    rep_caught += 1
        rows.sort(key=lambda r: (STATUS_SEVERITY[r["finalStatus"]], -r["finalUse"]))
        by_year[str(year)] = {"rows": rows, "systemFalse": sum(r["systemFalse"] for r in rows),
                              "reportFalse": sum(r["reportFalse"] for r in rows)}
    default = max(years, key=lambda y: by_year[str(y)]["reportFalse"] - by_year[str(y)]["systemFalse"]) if years else None
    return {
        "years": years, "defaultYear": default, "thresholds": th_dict(th),
        "overall": {"deptYears": dept_years, "problems": problems, "systemFalse": sys_false, "reportFalse": rep_false,
                    "systemCaught": sys_caught, "reportCaught": rep_caught,
                    "lead": round(sum(leads) / len(leads), 1) if leads else 0},
        "byYear": by_year,
    }


# ==========================================
# 7. 回測與資料品質
# ==========================================
@lru_cache(maxsize=64)
def backtest(target_year, depts, cutoff_month, ds=""):
    """回到過去年度的某個月份做年底預測，和該年實際全年支出比較；對照組為單純 Run-rate。"""
    data = dataset(ds)
    present = set(data.Department.unique())
    depts = tuple(d for d in DEPTS if d in depts and d in present) or tuple(d for d in DEPTS if d in present)
    month = min(max(int(cutoff_month), 2), 11)
    rows = []
    for department in depts:
        for year in sorted(int(y) for y in data.loc[(data.Department == department) & (data.Year < target_year), "Year"].unique()):
            complete = data[(data.Year == year) & (data.Department == department)]
            if complete.Month.nunique() != 12 or complete.Actual.isna().any():
                continue
            forecast, run_rate, _, history_count = forecast_for_year(data, year, department, month)
            if pd.isna(forecast) or history_count < 1:
                continue
            actual = float(complete.Actual.sum())
            rows.append({"year": year, "id": department, "name": dept_key(department), "actual": round(actual),
                         "forecast": round(forecast), "runRate": round(run_rate),
                         "errPct": round(abs(forecast - actual) / actual * 100, 1),
                         "_abs": abs(forecast - actual), "_rr": abs(run_rate - actual)})
    total = sum(r["actual"] for r in rows)
    by_dept = []
    for department in depts:
        own = [r for r in rows if r["id"] == department]
        if own:
            act = sum(r["actual"] for r in own)
            by_dept.append({"name": dept_key(department), "color": DEPT_COLORS[dept_key(department)],
                            "model": round(sum(r["_abs"] for r in own) / act * 100, 1),
                            "bench": round(sum(r["_rr"] for r in own) / act * 100, 1)})
    by_dept.sort(key=lambda r: r["model"])
    summary = {
        "model": round(sum(r["_abs"] for r in rows) / total * 100, 1) if total else None,
        "bench": round(sum(r["_rr"] for r in rows) / total * 100, 1) if total else None,
        "cases": len(rows), "years": sorted({r["year"] for r in rows}), "departments": len({r["id"] for r in rows}),
    }
    for r in rows:
        del r["_abs"], r["_rr"]
    return {"month": month, "summary": summary, "byDept": by_dept, "rows": rows}


@lru_cache(maxsize=8)
def quality(ds="", lang="zh"):
    T = lambda zh, en: tx(lang, zh, en)
    data = dataset(ds)
    info = dataset_info(ds)
    observed = data[data.Actual.notna()]
    gaps = 0
    for (_, _), g in data.groupby(["Year", "Department"]):
        closed = g.loc[g.Actual.notna(), "Month"]
        if len(closed) and int(closed.max()) != len(closed):
            gaps += 1
    one_off = observed[observed.OneOffAmount > 0]
    checks = [
        (T("年度－月份－部門無重複列", "No duplicate year–month–department rows"), not data.duplicated(["Year", "Month", "Department"]).any(),
         T(f"{len(data):,} 列", f"{len(data):,} rows")),
        (T("每月預算無缺漏", "No missing monthly budgets"), not data.Budget.isna().any(),
         T(f"{data.Year.nunique()} 個年度 × {data.Department.nunique()} 個部門 × 12 個月", f"{data.Year.nunique()} years × {data.Department.nunique()} departments × 12 months")),
        (T("實際支出無負值", "No negative actuals"), bool((observed.Actual >= 0).all()), T(f"已結算 {len(observed):,} 筆", f"{len(observed):,} closed months")),
        (T("已結算月份連續無斷層", "No gaps in closed months"), gaps == 0,
         T("每個部門都從 1 月連續結算", "Every department closes continuously from January") if gaps == 0 else T(f"{gaps} 個部門年度有斷層", f"{gaps} department-years have gaps")),
        (T("一次性支出都有事件說明", "Every one-off has an event note"), bool(one_off.EventNote.astype(str).str.strip().ne("").all()),
         T(f"{len(one_off)} 筆一次性支出", f"{len(one_off)} one-off amounts")),
        (T("一次性支出不超過當月實際", "One-offs never exceed the month's actual"), bool((one_off.OneOffAmount <= one_off.Actual).all()),
         T("一次性金額只計一次，不外推到未來月份", "One-offs count once and are not extrapolated")),
    ]
    return {
        "checks": [{"label": label, "ok": bool(ok), "detail": detail} for label, ok, detail in checks],
        "source": (T(f"上傳檔案「{info['name']}」（只在目前工作階段使用）", f"Uploaded file \"{info['name']}\" (this session only)") if info["source"] == "upload"
                   else T(f"合成示範資料（量級 {fmc(info['scale'] * 1e8)}，可匯入 ERP 匯出的 CSV 取代）", f"Synthetic demo data ({fmc(info['scale'] * 1e8, lang='en')} scale; replace with an ERP CSV export)")),
        "cutoff": info["cutoff"],
    }


# ==========================================
# 8. CSV 匯入與範本（檢核規則與 app.py 的 validate_budget_upload 相同）
# ==========================================
COLUMN_ALIASES = {
    "年度": "Year", "年份": "Year", "月份": "Month", "部門": "Department",
    "部门": "Department", "年度預算": "Budget", "月預算": "Budget",
    "預算": "Budget", "實際支出": "Actual", "實際金額": "Actual",
    "一次性支出": "OneOffAmount", "一次性費用": "OneOffAmount",
    "事件說明": "EventNote", "特殊事件": "EventNote",
}
REQUIRED_COLUMNS = ["Year", "Month", "Department", "Budget", "Actual"]


def validate_upload(raw, lang="zh"):
    T = lambda zh, en: tx(lang, zh, en)
    """回傳 (整理好的 DataFrame, 錯誤清單)。"""
    data = raw.rename(columns={c: COLUMN_ALIASES.get(str(c).strip(), str(c).strip()) for c in raw.columns}).copy()
    missing = [c for c in REQUIRED_COLUMNS if c not in data.columns]
    if missing:
        return None, [T(f"缺少必要欄位：{', '.join(missing)}", f"Missing required columns: {', '.join(missing)}")]
    if data.empty:
        return None, [T("CSV 沒有資料列。", "The CSV contains no data rows.")]
    if "OneOffAmount" not in data.columns:
        data["OneOffAmount"] = 0.0
    if "EventNote" not in data.columns:
        data["EventNote"] = ""

    errors = []
    for col in ["Year", "Month", "Budget"]:
        converted = pd.to_numeric(data[col], errors="coerce")
        if converted.isna().any():
            errors.append(T(f"{col} 欄位含有空白或非數字（共 {int(converted.isna().sum())} 列）。", f"{col} contains blank or non-numeric values ({int(converted.isna().sum())} rows)."))
        data[col] = converted
    for col in ["Actual", "OneOffAmount"]:
        raw_col = data[col]
        num = pd.to_numeric(raw_col, errors="coerce")
        if (raw_col.notna() & raw_col.astype(str).str.strip().ne("") & num.isna()).any():
            errors.append(T(f"{col} 欄位含有無法辨識的數值。", f"{col} contains values that cannot be parsed as numbers."))
        data[col] = num
    data["OneOffAmount"] = data.OneOffAmount.fillna(0)
    data["EventNote"] = data.EventNote.fillna("").astype(str)

    dept_alias = {d: d for d in DEPTS}
    dept_alias.update({dept_key(d): d for d in DEPTS})
    dept_alias.update({v: next(d for d in DEPTS if d.startswith(k)) for k, v in DEPT_EN.items()})
    names = data.Department.astype(str).str.strip()
    data["Department"] = names.map(dept_alias)
    if data.Department.isna().any():
        bad = sorted(set(names[data.Department.isna()]))[:5]
        errors.append(T(f"Department 欄位包含不支援的部門名稱：{'、'.join(bad)}。可用：{'、'.join(dept_key(d) for d in DEPTS)}。", f"Unsupported department names: {', '.join(bad)}. Use: {', '.join(DEPT_EN.values())} (or the Chinese names)."))
    if not errors:
        if ((data.Month < 1) | (data.Month > 12) | (data.Month % 1 != 0)).any():
            errors.append(T("Month 必須是 1 至 12 的整數。", "Month must be an integer from 1 to 12."))
        if ((data.Year % 1 != 0) | (data.Budget < 0) | (data.Actual < 0) | (data.OneOffAmount < 0)).any():
            errors.append(T("Year 必須為整數，Budget、Actual 與一次性支出不可為負數。", "Year must be an integer; Budget, Actual and one-off amounts cannot be negative."))
        if (data.Actual.notna() & (data.OneOffAmount > data.Actual)).any():
            errors.append(T("一次性支出不可大於該月實際支出。", "A one-off amount cannot exceed actual spending for the month."))
        if data.duplicated(["Year", "Month", "Department"]).any():
            errors.append(T("同一年度、月份與部門不可有重複資料列。", "Duplicate year/month/department rows are not allowed."))
        for (year, department), group in data.groupby(["Year", "Department"]):
            if set(group.Month.astype(int)) != set(MONTHS):
                errors.append(T(f"{int(year)} 年 {dept_key(department)} 必須各有 12 個月預算資料。", f"{int(year)} {dept_label(department, lang)} must include budget rows for all 12 months."))
                continue
            if group.Budget.sum() <= 0:
                errors.append(T(f"{int(year)} 年 {dept_key(department)} 的年度預算總額必須大於零。", f"The {int(year)} annual budget for {dept_label(department, lang)} must be greater than zero."))
            closed = group.loc[group.Actual.notna(), "Month"]
            if not closed.empty and group.loc[group.Month <= int(closed.max()), "Actual"].isna().any():
                errors.append(T(f"{int(year)} 年 {dept_key(department)} 的實際支出月份中間有缺漏。", f"Actuals for {int(year)} {dept_label(department, lang)} have a gap before the latest reported month."))
        if not errors and data.Actual.notna().sum() == 0:
            errors.append(T("Actual 欄位全部空白：至少需要一個已結算月份才能預測。", "Actual is empty everywhere: at least one closed month is needed to forecast."))
    if errors:
        return None, errors[:12]
    data["Year"] = data.Year.astype(int)
    data["Month"] = data.Month.astype(int)
    data["Budget"] = data.Budget.astype(float)
    cols = REQUIRED_COLUMNS + ["OneOffAmount", "EventNote"]
    return data[cols].sort_values(["Year", "Department", "Month"]).reset_index(drop=True), []


def template_csv(ds=""):
    data = dataset(ds).copy()
    data["Department"] = data.Department.map(dept_key)
    return data.to_csv(index=False).encode("utf-8-sig")


# ==========================================
# 9. 成本歸因：發票層級合成明細帳
# 自 app.py 的 generate_expense_detail 移植（亂數種子與順序相同，逐筆一致）；名稱全部虛構。
# ==========================================
COST_PROFILES = {
    "資訊部": [("雲端服務費", .30), ("軟體訂閱費", .25), ("資訊外包費", .25), ("設備維護費", .20)],
    "行銷部": [("數位廣告費", .35), ("活動製作費", .30), ("行銷外包費", .20), ("差旅費", .15)],
    "核保部": [("核保系統服務費", .35), ("專業外包費", .30), ("教育訓練費", .15), ("差旅費", .20)],
    "理賠部": [("理賠查勘費", .35), ("理賠外包服務費", .30), ("系統服務費", .20), ("差旅費", .15)],
    "精算部": [("精算資料服務費", .35), ("軟體訂閱費", .25), ("顧問外包費", .25), ("教育訓練費", .15)],
    "財務部": [("財務系統服務費", .30), ("外部查核費", .30), ("稅務顧問費", .25), ("教育訓練費", .15)],
    "人資行政部": [("員工訓練費", .35), ("招募服務費", .25), ("行政維護費", .25), ("差旅費", .15)],
    "法遵風控部": [("法遵顧問費", .35), ("監理申報系統費", .30), ("風險資料服務費", .20), ("教育訓練費", .15)],
}
ACCOUNT_EN = {
    "雲端服務費": "Cloud services", "軟體訂閱費": "Software subscriptions", "資訊外包費": "IT outsourcing", "設備維護費": "Equipment and maintenance",
    "數位廣告費": "Digital advertising", "活動製作費": "Event production", "行銷外包費": "Marketing services", "差旅費": "Travel",
    "核保系統服務費": "Underwriting systems", "專業外包費": "Professional services", "教育訓練費": "Training",
    "理賠查勘費": "Claims inspection", "理賠外包服務費": "Claims services", "系統服務費": "System services",
    "精算資料服務費": "Actuarial data services", "顧問外包費": "Consulting services",
    "財務系統服務費": "Finance systems", "外部查核費": "External audit",
    "稅務顧問費": "Tax advisory", "員工訓練費": "Employee training",
    "招募服務費": "Recruitment services", "行政維護費": "Administrative services",
    "法遵顧問費": "Compliance advisory", "監理申報系統費": "Regulatory reporting systems",
    "風險資料服務費": "Risk data services", "一次性資本支出": "One-off capital expenditure",
}
# 會計科目代碼：營業費用 61xx；一次性資本支出列在設備類 15xx
GL_CODES = {
    "差旅費": "6121", "教育訓練費": "6131", "員工訓練費": "6132", "招募服務費": "6133",
    "雲端服務費": "6141", "軟體訂閱費": "6142", "資訊外包費": "6143", "設備維護費": "6144", "系統服務費": "6145",
    "核保系統服務費": "6146", "財務系統服務費": "6147", "監理申報系統費": "6148",
    "數位廣告費": "6151", "活動製作費": "6152", "行銷外包費": "6153", "行政維護費": "6161",
    "專業外包費": "6171", "顧問外包費": "6172", "外部查核費": "6173", "稅務顧問費": "6174", "法遵顧問費": "6175",
    "理賠查勘費": "6181", "理賠外包服務費": "6182", "精算資料服務費": "6191", "風險資料服務費": "6192",
    "一次性資本支出": "1561",
}
# 供應商（虛構）：(中文名稱, 英文名稱)
_V = {
    "cloud1": ("雲翔數位科技股份有限公司", "Cloudsoar Digital Technology"), "cloud2": ("澄峰雲端服務股份有限公司", "Clearpeak Cloud Services"),
    "sw1": ("恆碩軟體股份有限公司", "Hengshuo Software"), "sw2": ("聚擎資訊股份有限公司", "Juqing Information"),
    "si1": ("立衡系統整合股份有限公司", "Liheng Systems Integration"), "si2": ("宇晟資訊服務股份有限公司", "Yusheng IT Services"),
    "hw": ("晶宇電腦設備股份有限公司", "Jingyu Computer Equipment"),
    "ad1": ("星耀數位行銷股份有限公司", "Starlit Digital Marketing"), "ad2": ("曜境媒體股份有限公司", "Yaojing Media"),
    "event": ("匯展活動整合股份有限公司", "Huizhan Event Services"), "brand": ("青禾品牌顧問有限公司", "Qinghe Brand Consulting"),
    "travel": ("旅程通旅行社股份有限公司", "Tripway Travel Agency"), "claim": ("員工差旅報支", "Employee expense claims"),
    "uwtech": ("安碩保險科技股份有限公司", "Anshuo InsurTech"), "pro": ("景信專業服務股份有限公司", "Jingxin Professional Services"),
    "train1": ("知行企業管理顧問有限公司", "Zhixing Management Consulting"), "train2": ("博識學苑股份有限公司", "Boshi Academy"),
    "adj1": ("全誠保險公證人有限公司", "Quancheng Loss Adjusters"), "adj2": ("正衡保險公證人有限公司", "Zhengheng Loss Adjusters"),
    "claimsvc": ("迅達理賠服務股份有限公司", "Xunda Claims Services"),
    "actdata": ("衡量精算資料股份有限公司", "Hengliang Actuarial Data"), "actcon": ("鼎睿精算顧問有限公司", "Dingrui Actuarial Consulting"),
    "fintech": ("匯算財務科技股份有限公司", "Huisuan FinTech"), "cpa": ("誠正聯合會計師事務所", "Chengzheng & Partners CPAs"),
    "tax": ("宏律稅務顧問有限公司", "Honglu Tax Advisory"), "hr": ("才聚人力資源顧問股份有限公司", "Caiju HR Consulting"),
    "fm1": ("安居物業管理股份有限公司", "Anju Property Management"), "fm2": ("清樂環境清潔有限公司", "Qingle Cleaning Services"),
    "law": ("理信法律事務所", "Lixin Law Offices"), "reg": ("合規通科技股份有限公司", "RegLink Technology"),
    "risk": ("衡風風險資料股份有限公司", "Hengfeng Risk Data"),
}
ACCOUNT_VENDORS = {
    "雲端服務費": ["cloud1", "cloud2"], "軟體訂閱費": ["sw1", "sw2"], "資訊外包費": ["si1", "si2"], "設備維護費": ["hw", "si2"],
    "數位廣告費": ["ad1", "ad2"], "活動製作費": ["event"], "行銷外包費": ["brand", "ad2"], "差旅費": ["travel", "claim"],
    "核保系統服務費": ["uwtech"], "專業外包費": ["pro"], "教育訓練費": ["train1", "train2"], "員工訓練費": ["train2", "train1"],
    "理賠查勘費": ["adj1", "adj2"], "理賠外包服務費": ["claimsvc"], "系統服務費": ["si1", "sw2"],
    "精算資料服務費": ["actdata"], "顧問外包費": ["actcon", "pro"], "財務系統服務費": ["fintech"], "外部查核費": ["cpa"],
    "稅務顧問費": ["tax"], "招募服務費": ["hr"], "行政維護費": ["fm1", "fm2"],
    "法遵顧問費": ["law", "pro"], "監理申報系統費": ["reg"], "風險資料服務費": ["risk"], "一次性資本支出": ["hw", "si1"],
}
VENDOR_EN = {zh: en for zh, en in _V.values()}
COST_CENTERS = {
    "資訊部": ["IT110 基礎架構", "IT120 應用開發", "IT130 資訊安全"], "行銷部": ["MK210 數位行銷", "MK220 品牌活動"],
    "核保部": ["UW310 個人核保", "UW320 團體核保"], "理賠部": ["CL410 理賠審核", "CL420 理賠查勘"],
    "精算部": ["AC510 商品精算", "AC520 評價精算"], "財務部": ["FN610 會計", "FN620 財務規劃"],
    "人資行政部": ["HR710 人才發展", "HR720 總務行政"], "法遵風控部": ["RC810 法令遵循", "RC820 風險管理"],
}
# 專案：(部門, 年度) → (代碼名稱, 歸屬到此專案的科目)；其餘費用歸「日常營運」
DEPT_PROJECTS = {
    ("資訊部", 2026): ("PRJ-IT26-01 雲端遷移計畫", {"雲端服務費", "資訊外包費"}),
    ("資訊部", 2024): ("PRJ-IT24-03 伺服器汰換", {"一次性資本支出", "設備維護費"}),
    ("資訊部", 2022): ("PRJ-IT22-02 資料中心 UPS 汰換", {"一次性資本支出"}),
    ("法遵風控部", 2026): ("PRJ-RC26-01 TW-ICS 接軌", {"法遵顧問費", "監理申報系統費", "一次性資本支出"}),
    ("財務部", 2026): ("PRJ-FN26-01 IFRS 17 財報上線", {"財務系統服務費", "一次性資本支出"}),
    ("精算部", 2025): ("PRJ-AC25-01 IFRS 17 精算引擎", {"軟體訂閱費", "一次性資本支出"}),
    ("核保部", 2025): ("PRJ-UW25-01 核保系統升級", {"核保系統服務費"}),
    ("理賠部", 2025): ("PRJ-CL25-01 理賠影像系統升級", {"系統服務費", "一次性資本支出"}),
    ("人資行政部", 2026): ("PRJ-HR26-01 數位學習平台", {"員工訓練費"}),
}
OPEX_PROJECT = "OPEX 日常營運"
# 「代碼 名稱」格式的成本中心與專案，英文介面只翻譯名稱部分
CODED_EN = {
    "基礎架構": "Infrastructure", "應用開發": "Application development", "資訊安全": "Information security",
    "數位行銷": "Digital marketing", "品牌活動": "Brand events", "個人核保": "Individual underwriting", "團體核保": "Group underwriting",
    "理賠審核": "Claims review", "理賠查勘": "Claims inspection", "商品精算": "Product actuarial", "評價精算": "Valuation actuarial",
    "會計": "Accounting", "財務規劃": "Financial planning", "人才發展": "Talent development", "總務行政": "General administration",
    "法令遵循": "Regulatory compliance", "風險管理": "Risk management",
    "雲端遷移計畫": "Cloud migration", "伺服器汰換": "Server replacement", "資料中心 UPS 汰換": "Data-centre UPS replacement",
    "TW-ICS 接軌": "TW-ICS adoption", "IFRS 17 財報上線": "IFRS 17 reporting go-live", "IFRS 17 精算引擎": "IFRS 17 actuarial engine",
    "核保系統升級": "Underwriting system upgrade", "理賠影像系統升級": "Claims imaging upgrade", "數位學習平台": "E-learning platform",
    "日常營運": "Routine operations",
}
# 各部門人員（虛構姓名）：第一位為部門主管；顯示時依檢視身分決定是否遮罩
_STAFF_NAMES = ["陳怡君", "林家豪", "黃雅婷", "張志明", "李佳穎", "王俊傑", "吳佩珊", "劉冠宇", "蔡宜庭", "楊承恩",
                "許雅雯", "鄭宇翔", "謝欣怡", "郭柏翰", "洪詩涵", "曾子軒", "周品妤", "邱建宏", "賴思妤", "徐國峰",
                "蘇郁婷", "葉信宏", "莊雅筑", "呂明哲", "江婉婷", "何昱廷", "羅敏慧", "高偉倫", "潘怡如", "簡志豪",
                "朱佩君", "彭家瑋", "游淑芬", "詹宗翰", "胡雅琪", "施俊宏", "沈佳蓉", "余冠廷", "盧欣妤", "梁哲維"]
DEPT_STAFF = {dept_key(d): [(f"E{i + 1}{j + 1:03d}", _STAFF_NAMES[i * 5 + j], "部門主管" if j == 0 else ("經理" if j == 1 else "專員"))
                            for j in range(5)] for i, d in enumerate(DEPTS)}
CFO_APPROVAL_LIMIT = 2_000_000  # 單筆 NT$ 200 萬以上需財務長核准
LINE_MEMOS = {
    "雲端服務費": ["雲端運算資源月租", "儲存與流量超額使用"], "軟體訂閱費": ["軟體授權年費分攤", "使用者授權加購"],
    "資訊外包費": ["系統維運外包月費", "專案開發人月費"], "設備維護費": ["伺服器維護合約", "端點設備維修"],
    "數位廣告費": ["搜尋與社群廣告投放", "程序化廣告投放"], "活動製作費": ["客戶說明會場地與製作", "通路激勵活動"],
    "差旅費": ["客戶與通路拜訪差旅", "研討會與訓練差旅"], "教育訓練費": ["專業證照課程", "內部講師訓練"],
    "員工訓練費": ["新進人員訓練", "主管領導力課程"], "理賠查勘費": ["理賠案件公證查勘", "颱風季急件查勘"],
    "外部查核費": ["年度財報查核公費", "內控專案查核"], "法遵顧問費": ["法規遵循諮詢", "監理申報顧問"],
}
MEMO_EN = {
    "雲端運算資源月租": "Cloud compute monthly fee", "儲存與流量超額使用": "Storage and bandwidth overage",
    "軟體授權年費分攤": "Annual licence amortisation", "使用者授權加購": "Additional user licences",
    "系統維運外包月費": "Managed service monthly fee", "專案開發人月費": "Project development man-months",
    "伺服器維護合約": "Server maintenance contract", "端點設備維修": "End-user device repair",
    "搜尋與社群廣告投放": "Search and social ads", "程序化廣告投放": "Programmatic ads",
    "客戶說明會場地與製作": "Client seminar venue and production", "通路激勵活動": "Channel incentive event",
    "客戶與通路拜訪差旅": "Client and channel visits", "研討會與訓練差旅": "Conference and training travel",
    "專業證照課程": "Professional certification course", "內部講師訓練": "Internal trainer programme",
    "新進人員訓練": "New-hire training", "主管領導力課程": "Leadership programme",
    "理賠案件公證查勘": "Claims loss adjusting", "颱風季急件查勘": "Typhoon-season urgent inspections",
    "年度財報查核公費": "Annual audit fee", "內控專案查核": "Internal control review",
    "法規遵循諮詢": "Compliance advisory", "監理申報顧問": "Regulatory reporting advisory", "資本支出": "Capital expenditure",
}


def generate_expense_detail(monthly_data):
    """逐筆發票層級的合成明細：每月每科目數筆，含科目代碼、供應商、成本中心、專案、經辦人與核准層級。
    每月合計與月 Actual 完全一致。"""
    rng = np.random.default_rng(20261021)
    result = []
    seq = 1
    for row in monthly_data.itertuples():
        if pd.isna(row.Actual):
            continue
        month_start = len(result)
        key = dept_key(row.Department)
        profile = COST_PROFILES[key]
        shares = np.array([weight for _, weight in profile], dtype=float)
        # 合成異常情境：2026 資訊部雲端服務費占比提高，用於示範根因分析
        if key == "資訊部" and row.Year == 2026:
            shares[0] += .22
            shares[2] -= .12
            shares[3] -= .10
        shares *= rng.uniform(.94, 1.06, len(shares))
        shares /= shares.sum()
        one_off_amount = float(getattr(row, "OneOffAmount", 0) or 0)
        recurring_actual = max(0.0, float(row.Actual) - one_off_amount)
        project_name, project_accounts = DEPT_PROJECTS.get((key, int(row.Year)), (None, set()))
        staff = DEPT_STAFF[key]
        centers = COST_CENTERS[key]

        def add_line(account, amount, expense_id=None, memo=None, vendor=None):
            nonlocal seq
            vendor_keys = ACCOUNT_VENDORS[account]
            vendor = vendor or _V[vendor_keys[int(rng.integers(len(vendor_keys)))]][0]
            memos = LINE_MEMOS.get(account, [account])
            code, name, _ = staff[1 + int(rng.integers(len(staff) - 1))]
            in_project = project_name and account in project_accounts and (account == "一次性資本支出" or rng.random() < .7)
            day = int(rng.integers(1, 29))
            result.append({
                "Year": row.Year, "Month": row.Month, "Department": row.Department,
                "Invoice_Date": f"{row.Year}-{row.Month:02d}-{day:02d}",
                "Expense_ID": expense_id or f"AP{row.Year}{row.Month:02d}{seq:05d}",
                "Purchase_Order": f"PO{row.Year}{seq:06d}",
                "GL_Code": GL_CODES[account], "Account": account,
                "Vendor": vendor, "Description": memo or memos[int(rng.integers(len(memos)))],
                "Cost_Center": centers[int(rng.integers(len(centers)))],
                "Project": project_name if in_project else OPEX_PROJECT,
                "Employee": code, "Employee_Name": name,
                "Approval": "財務長" if amount >= CFO_APPROVAL_LIMIT else "部門主管",
                "Amount": int(amount),
            })
            seq += 1

        for (account, _), share in zip(profile, shares):
            account_total = round(recurring_actual * share)
            if key == "資訊部" and row.Year == 2026 and row.Month == 6 and account == "雲端服務費":
                # 合成重複請款：同一張發票號碼被登錄兩次，供「可能重複的費用明細」示範
                half = account_total // 2
                dup_id = f"AP{row.Year}{row.Month:02d}{seq:05d}"
                add_line(account, half, dup_id, "雲端運算資源月租", _V["cloud1"][0])
                add_line(account, account_total - half, dup_id, "雲端運算資源月租", _V["cloud1"][0])
                continue
            n_lines = int(rng.integers(2, 6))
            weights = rng.dirichlet(np.full(n_lines, 1.6))
            amounts = [int(round(account_total * w)) for w in weights]
            amounts[-1] = account_total - sum(amounts[:-1])
            for amount in amounts:
                add_line(account, amount)
        if one_off_amount > 0:
            add_line("一次性資本支出", round(one_off_amount), memo=str(row.EventNote).strip() or "資本支出")
        delta = int(round(row.Actual)) - sum(item["Amount"] for item in result[month_start:])
        if delta:
            result[-1]["Amount"] += delta
    return pd.DataFrame(result)


@lru_cache(maxsize=4)
def expense_ledger(ds=""):
    return generate_expense_detail(dataset(ds))


def account_label(account, lang="zh"):
    return ACCOUNT_EN.get(account, account) if lang == "en" else account


def vendor_label(vendor, lang="zh"):
    return VENDOR_EN.get(vendor, vendor) if lang == "en" else vendor


def coded_label(text, lang="zh"):
    """「IT110 基礎架構」「PRJ-IT26-01 雲端遷移計畫」：英文介面保留代碼、翻譯名稱。"""
    if lang != "en":
        return text
    code, _, name = text.partition(" ")
    return f"{code} {CODED_EN.get(name, name)}"


def memo_label(memo, lang="zh"):
    return (MEMO_EN.get(memo) or EVENT_EN.get(memo) or ACCOUNT_EN.get(memo, memo)) if lang == "en" else memo


def handler_label(code, name, role, lang="zh"):
    """經辦人只供內控追蹤：財務長與部門主管（只看得到自己部門）看全名，財務分析師看遮罩；英文介面只顯示員工代碼。"""
    if lang == "en":
        return code
    return f"{code} {name}" if role in ("cfo", "head") else f"{code} {name[0]}○{name[-1]}"


@lru_cache(maxsize=32)
def costs(year, depts, ds="", lang="zh", role="cfo"):
    T = lambda zh, en: tx(lang, zh, en)
    f = lambda v, s=False: fmc(v, s, lang)
    data = dataset(ds)
    present = set(data.Department.unique())
    depts = tuple(d for d in DEPTS if d in depts and d in present) or tuple(d for d in DEPTS if d in present)
    closed = data[(data.Year == year) & data.Actual.notna()].Month
    cutoff = int(closed.max()) if not closed.empty else 0
    ledger = expense_ledger(ds)
    if ledger.empty:
        ledger = pd.DataFrame(columns=["Year", "Month", "Department", "Account", "Amount"])
    scope = ledger.Department.isin(depts) & (ledger.Month <= cutoff)
    cur = ledger[scope & (ledger.Year == year)]
    total = float(cur.Amount.sum())

    # 已標記事件：一次性支出只計已發生金額，經常性事件反映在預測裡
    year_rows = data[(data.Year == year) & data.Department.isin(depts) & data.EventNote.astype(str).str.strip().ne("")]
    events = []
    for (dept, note), g in year_rows.groupby(["Department", "EventNote"], sort=False):
        lo, hi = int(g.Month.min()), int(g.Month.max())
        one_off = float(g.OneOffAmount.sum())
        events.append({"dept": dept_key(dept), "event": event_label(note, lang), "from": lo, "to": hi,
                       "oneOff": round(one_off) if one_off > 0 else None})

    # 高成本驅動：本期 vs 往年同期（同樣截至 cutoff 月）平均
    hist = ledger[scope & (ledger.Year < year)].groupby(["Year", "Department", "Account"], as_index=False).Amount.sum()
    avg = hist.groupby(["Department", "Account"], as_index=False).Amount.mean().rename(columns={"Amount": "Historical_Avg"})
    drivers = cur.groupby(["Department", "Account"], as_index=False).Amount.sum().merge(avg, on=["Department", "Account"], how="left")
    drivers["Variance"] = drivers.Amount - drivers.Historical_Avg
    drivers["Variance_Pct"] = np.where(drivers.Historical_Avg > 0, drivers.Variance / drivers.Historical_Avg * 100, np.nan)
    drivers = drivers.sort_values("Variance", ascending=False, na_position="last")
    actual_ytd = float(analyze_budget(year, depts, ds).Actual_YTD.sum())
    floor = max(50_000.0, actual_ytd * .002)
    flagged = (drivers.Variance > 0) & (drivers.Variance_Pct >= 25) & (drivers.Variance >= floor)
    num = lambda v: None if pd.isna(v) else round(float(v))
    driver_rows = [{"dept": dept_key(r.Department), "account": account_label(r.Account, lang), "gl": GL_CODES.get(r.Account, ""),
                    "amount": round(r.Amount), "hist": num(r.Historical_Avg), "variance": num(r.Variance),
                    "pct": None if pd.isna(r.Variance_Pct) else round(float(r.Variance_Pct), 1), "flag": bool(fl)}
                   for r, fl in zip(drivers.itertuples(), flagged)]

    # 科目：前 12 大，其餘併成「其他」，每列再依部門拆分
    acct = cur.groupby(["Account", "Department"], as_index=False).Amount.sum()
    acct_tot = acct.groupby("Account").Amount.sum().sort_values(ascending=False)
    top = list(acct_tot.index[:12])
    by_account = [{"label": f"{GL_CODES.get(a, '')} {account_label(a, lang)}".strip(), "total": round(acct_tot[a]),
                   "byDept": {dept_key(r.Department): round(r.Amount) for r in acct[acct.Account == a].itertuples()}} for a in top]
    if len(acct_tot) > 12:
        rest = acct[~acct.Account.isin(top)].groupby("Department").Amount.sum()
        by_account.append({"label": T(f"其他 {len(acct_tot) - 12} 個科目", f"{len(acct_tot) - 12} other categories"),
                           "total": round(float(rest.sum())), "byDept": {dept_key(d): round(v) for d, v in rest.items()}, "other": True})

    proj = cur[cur.Project != OPEX_PROJECT].groupby(["Project", "Department"], as_index=False).Amount.sum().sort_values("Amount", ascending=False)
    projects = [{"label": coded_label(r.Project, lang), "dept": dept_key(r.Department), "amount": round(r.Amount)} for r in proj.itertuples()]

    vend = cur.groupby("Vendor").Amount.sum().sort_values(ascending=False)
    short = lambda v: vendor_label(v, lang).removesuffix("股份有限公司").removesuffix("有限公司")
    vendors = [{"label": short(v), "full": vendor_label(v, lang), "amount": round(a)} for v, a in vend.items()]

    cc = cur.groupby(["Department", "Cost_Center"], as_index=False).Amount.sum()
    dept_tot = cc.groupby("Department").Amount.sum().sort_values(ascending=False)
    cc["Rank"] = cc.Department.map({d: i for i, d in enumerate(dept_tot.index)})
    cc = cc.sort_values(["Rank", "Amount"], ascending=[True, False])
    cost_centers = [{"label": coded_label(r.Cost_Center, lang), "dept": dept_key(r.Department), "amount": round(r.Amount),
                     "share": round(r.Amount / dept_tot[r.Department] * 100, 1) if dept_tot[r.Department] else 0} for r in cc.itertuples()]

    def line(r):
        return {"date": r.Invoice_Date, "id": r.Expense_ID, "po": r.Purchase_Order, "dept": dept_key(r.Department),
                "cc": coded_label(r.Cost_Center, lang), "gl": r.GL_Code, "account": account_label(r.Account, lang),
                "vendor": vendor_label(r.Vendor, lang), "memo": memo_label(r.Description, lang), "project": coded_label(r.Project, lang),
                "handler": handler_label(r.Employee, r.Employee_Name, role, lang), "cfo": r.Approval == "財務長",
                "amount": int(r.Amount), "month": int(r.Month)}

    dups = cur[cur.duplicated(["Year", "Month", "Department", "Account", "Vendor", "Expense_ID"], keep=False)]
    ordered = cur.sort_values(["Invoice_Date", "Expense_ID"], ascending=False)
    return {
        "year": year, "cutoff": cutoff, "total": round(total), "lineCount": int(len(cur)),
        "approvalLimit": CFO_APPROVAL_LIMIT,
        "events": events,
        "drivers": {"floor": round(floor), "hasHistory": not hist.empty, "rows": driver_rows},
        "byAccount": by_account,
        "projects": projects,
        "vendors": vendors,
        "costCenters": cost_centers,
        "duplicates": [line(r) for r in dups.itertuples()],
        "ledger": [line(r) for r in ordered.itertuples()],
        "summary": cost_summary(drivers[flagged], projects, vendors, total, dups, lang),
    }


def cost_summary(flagged, projects, vendors, total, dups, lang="zh"):
    """成本歸因頁頂端的一句話結論（規則產生，數字與下方圖表一致）。"""
    T = lambda zh, en: tx(lang, zh, en)
    f = lambda v, s=False: fmc(v, s, lang)
    parts = []
    if not flagged.empty:
        r = flagged.iloc[0]
        parts.append(T(f"增幅最大的是{dept_label(r.Department, lang)}的{account_label(r.Account, lang)}：比往年同期平均多 {f(r.Variance)}（+{r.Variance_Pct:.0f}%）。",
                       f"The biggest increase is {dept_label(r.Department, lang)} {account_label(r.Account, lang)}: {f(r.Variance)} above the historical same-period average (+{r.Variance_Pct:.0f}%)."))
    else:
        parts.append(T("沒有科目明顯高於往年同期。", "No category is clearly above its historical same-period level."))
    if projects and total:
        share = sum(p["amount"] for p in projects) / total * 100
        parts.append(T(f"專案支出占 {share:.0f}%，其餘為日常營運。", f"Projects account for {share:.0f}% of spending; the rest is routine operations."))
    if vendors and total:
        top5 = sum(v["amount"] for v in vendors[:5]) / total * 100
        parts.append(T(f"前 5 大供應商占 {top5:.0f}%。", f"The top 5 vendors take {top5:.0f}%."))
    if not dups.empty:
        parts.append(T(f"另有 {len(dups)} 筆憑證號碼重複的明細（合計 {f(dups.Amount.sum())}）待人工覆核。",
                       f"{len(dups)} lines share a voucher number ({f(dups.Amount.sum())} in total) and need review."))
    return " ".join(parts) if lang == "en" else "".join(parts)
