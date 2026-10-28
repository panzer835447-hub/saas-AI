"""AI 助理：模型服務串接、提供給模型的資料、數字查核與內建規則備援。

自 app.py 移植（Gemini / Groq / OpenRouter；新版不接 Ollama）。金鑰只在伺服器端讀取，不會傳到瀏覽器。
"""
import json
import os
import re
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

import budget_core as core

HERE = Path(__file__).parent


# ==========================================
# 1. 設定：環境變數優先，其次 budget_saas/secrets.toml，再其次舊版的 .streamlit/secrets.toml
# ==========================================
def _load_secrets():
    for path in (HERE / "secrets.toml", HERE.parent / ".streamlit" / "secrets.toml"):
        if path.exists():
            try:
                return tomllib.loads(path.read_text(encoding="utf-8"))
            except (OSError, tomllib.TOMLDecodeError):
                return {}
    return {}


_SECRETS = _load_secrets()


def config_value(name, default=""):
    return str(os.environ.get(name) or _SECRETS.get(name) or default).strip()


# ==========================================
# 2. 模型服務
# ==========================================
def gemini_chat(api_key, messages, system, model):
    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages],
        "generationConfig": {"maxOutputTokens": 1200, "temperature": 0.2},
    }
    request = urllib.request.Request(
        f"{os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com')}/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"x-goog-api-key": api_key, "content-type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        body = json.loads(response.read().decode("utf-8"))
    parts = body.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if p.get("text")).strip()


def strip_think(text):
    """推理型模型可能回傳 <think>…</think>，只保留最終回答。"""
    while "<think>" in text:
        start = text.find("<think>")
        end = text.find("</think>", start)
        text = text[:start] + (text[end + len("</think>"):] if end >= 0 else "")
    return text.strip()


def openai_compat_chat(base_url, api_key, model, messages, system):
    payload = {
        "model": model, "temperature": 0.2, "max_tokens": 800,  # Groq 免費版每分鐘總量約 8,000 token，要留給輸入資料
        "messages": [{"role": "system", "content": system}] + [{"role": m["role"], "content": m["content"]} for m in messages],
    }
    request = urllib.request.Request(
        f"{base_url}/chat/completions", data=json.dumps(payload).encode("utf-8"), method="POST",
        # Groq 前面的 Cloudflare 會擋 Python 預設的 User-Agent（回 403 / 1010），所以要自己帶
        headers={"content-type": "application/json", "authorization": f"Bearer {api_key}", "x-title": "Budget Command Center",
                 "user-agent": "BudgetCommandCenter/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("error"):
        raise RuntimeError(body["error"])
    return strip_think(body.get("choices", [{}])[0].get("message", {}).get("content", "") or "")


COMPAT_PROVIDERS = {
    # 2026-10 起 Groq 已下架 llama-3.3-70b-versatile、OpenRouter 的 llama-3.3 免費版也停止提供
    "groq": ("Groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", "GROQ_MODEL", "openai/gpt-oss-120b"),
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "google/gemma-4-31b-it:free"),
}


def ai_chain():
    """已設定金鑰的服務，依偏好順序排列：AI_PROVIDER 指定的優先，其餘依序備援。"""
    preferred = config_value("AI_PROVIDER", "gemini")
    if preferred == "rules":
        return []
    chain = []
    for pid in [preferred] + [p for p in ("gemini", "groq", "openrouter") if p != preferred]:
        if pid == "gemini" and config_value("GEMINI_API_KEY"):
            model = config_value("GEMINI_MODEL", "gemini-flash-lite-latest")
            chain.append({"id": "gemini", "name": "Gemini", "model": model, "endpoint": "", "key": config_value("GEMINI_API_KEY")})
        elif pid in COMPAT_PROVIDERS and config_value(COMPAT_PROVIDERS[pid][2]):
            name, base, key_var, model_var, default_model = COMPAT_PROVIDERS[pid]
            chain.append({"id": pid, "name": name, "model": config_value(model_var, default_model),
                          "endpoint": os.environ.get(f"{pid.upper()}_BASE_URL", base), "key": config_value(key_var)})
    return chain


def status():
    chain = ai_chain()
    return {"online": bool(chain), "providers": [p["name"] for p in chain]}


def describe_error(err):
    if isinstance(err, urllib.error.HTTPError):
        if err.code == 429:
            return "額度或速率已達上限"
        if err.code in (401, 403):
            return "金鑰無效或沒有權限"
        return f"HTTP {err.code}"
    if isinstance(err, (urllib.error.URLError, TimeoutError, ConnectionError)):
        return "連線失敗或逾時"
    return "回應格式異常"


_CACHE = {}  # 相同問題、相同資料只消耗一次免費額度
_COOLDOWNS = {}  # 剛遇到 429 的服務暫停 90 秒


def llm_answer(messages, systems, fresh=False, cache_only=False):
    """依序嘗試每個服務；回傳 (文字, 使用的服務名稱, 略過紀錄)。全部失敗時丟出 RuntimeError。

    systems = {"full": ..., "compact": ...}：Gemini 用完整資料，Groq / OpenRouter 免費額度每分鐘 token 較少，用精簡版。
    fresh=True（使用者按「重新產生」）時略過快取，重新請模型撰寫。
    cache_only=True（超過使用次數上限）時只回傳快取中的答案，不呼叫任何服務。"""
    notes = []
    payload = json.dumps(messages, ensure_ascii=False)
    for prov in ai_chain():
        system = systems["full" if prov["id"] == "gemini" else "compact"]
        if time.time() < _COOLDOWNS.get(prov["id"], 0):
            notes.append(f"{prov['name']}：額度暫時用完")
            continue
        key = (prov["id"], prov["model"], system, payload)
        hit = _CACHE.get(key)
        if hit and not fresh and time.time() - hit[1] < 12 * 3600:
            return hit[0], prov["name"], notes
        if cache_only:
            continue
        try:
            if prov["id"] == "gemini":
                text = strip_think(gemini_chat(prov["key"], messages, system, prov["model"]))
            else:
                text = openai_compat_chat(prov["endpoint"], prov["key"], prov["model"], messages, system)
            if text.strip():
                if len(_CACHE) > 300:
                    _CACHE.clear()
                _CACHE[key] = (text, time.time())
                return text, prov["name"], notes
            notes.append(f"{prov['name']}：沒有回傳內容")
        except Exception as err:
            if isinstance(err, urllib.error.HTTPError) and err.code == 429:
                _COOLDOWNS[prov["id"]] = time.time() + 90
            notes.append(f"{prov['name']}：{describe_error(err)}")
    raise RuntimeError("；".join(notes) or "沒有可用的模型服務")


# ==========================================
# 3. 提供給模型的資料（標題數字預先格式化，小模型不必自己換算單位）
# ==========================================
def _ordered(analysis):
    return analysis.assign(_s=analysis.Status.map(core.STATUS_SEVERITY)).sort_values(["_s", "Forecast_Var"], ascending=[True, False])


def data_tables(data, year, analysis, monthly_years=None, lang="zh", th=core.DEFAULT_TH):
    """整個資料庫的精簡文字表（新台幣萬元整數，兩種語言都一樣，數字查核靠這個單位），讓助理能回答任何年度、月份的問題。

    monthly_years 只保留這些年度的逐月明細（給每分鐘 token 上限較低的備援服務），年度彙總仍包含所有年度。"""
    T = lambda zh, en: core.tx(lang, zh, en)
    wan = lambda v: "" if pd.isna(v) else f"{v / 1e4:.0f}"
    status_by_dept = dict(zip(analysis.Department, analysis.Status))
    monthly_lines = [T("年度|部門|項目|1月 2月 3月 4月 5月 6月 7月 8月 9月 10月 11月 12月|全年合計（實際為已結算月份合計）",
                       "Year|Department|Item|Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec|Total (actual = closed months only)")]
    annual_lines = [T("年度|部門|年度預算|實際支出|已結算月數|執行率(實際÷同期預算)|狀態",
                      "Year|Department|Annual budget|Actual|Closed months|Execution (actual ÷ budget to date)|Status")]
    for (y, dept), g in data.sort_values(["Year", "Department", "Month"]).groupby(["Year", "Department"], sort=True):
        g = g.set_index("Month").reindex(core.MONTHS)
        name = core.dept_label(dept, lang)
        closed = int(g.Actual.notna().sum())
        if monthly_years is None or y in monthly_years:
            monthly_lines.append(f"{y}|{name}|{T('預算', 'Budget')}|{' '.join(wan(v) for v in g.Budget)}|{wan(g.Budget.sum())}")
            monthly_lines.append(f"{y}|{name}|{T('實際', 'Actual')}|{' '.join(wan(v) or '-' for v in g.Actual)}|{wan(g.Actual.sum(min_count=1))}")
        budget_to_date = g.Budget[g.Actual.notna()].sum()
        rate = g.Actual.sum() / budget_to_date * 100 if budget_to_date else float("nan")
        if closed == 12:
            state = core.status_label(core.classify_status(g.Actual.sum() / g.Budget.sum(), th), lang) if g.Budget.sum() else ""
        elif y == year and dept in status_by_dept:
            state = T(f"{status_by_dept[dept]}（依年底預測）", f"{core.status_label(status_by_dept[dept], lang)} (by year-end forecast)")
        else:
            state = T("進行中", "In progress")
        annual_lines.append(f"{y}|{name}|{wan(g.Budget.sum())}|{wan(g.Actual.sum(min_count=1))}|{closed}|"
                            f"{'' if pd.isna(rate) else f'{rate:.1f}%'}|{state}")
    events = data[data.EventNote.astype(str).str.strip().ne("")]
    event_lines = [T("年度|部門|月份|事件|一次性金額（萬元，空白=經常性事件）", "Year|Department|Months|Event|One-off amount (萬; blank = recurring event)")]
    for (y, dept, note), g in events.groupby(["Year", "Department", "EventNote"], sort=True):
        months = f"{int(g.Month.min())}-{int(g.Month.max())}" if g.Month.nunique() > 1 else f"{int(g.Month.min())}"
        one_off = g.OneOffAmount.sum()
        event_lines.append(f"{y}|{core.dept_label(dept, lang)}|{months}|{core.event_label(note, lang)}|{wan(one_off) if one_off > 0 else ''}")
    return {
        "unit_note": T("表格金額單位皆為新台幣「萬元」整數；引用時寫成「○○ 萬」，超過 10,000 萬換算為億（10,000 萬 = 1 億）。'-' 表示該月尚未結算。",
                       "Table amounts are integers in 萬 (NT$10,000). When quoting in English convert them: 100 = NT$1.0M, 10,000 = NT$100M, 100,000 = NT$1B. '-' means the month is not closed yet."),
        "annual_by_department": "\n".join(annual_lines),
        "monthly_budget_and_actual": "\n".join(monthly_lines),
        "tagged_events_all_years": "\n".join(event_lines),
    }


def build_facts(year, depts, question, compact=False, ds="", lang="zh", th=core.DEFAULT_TH):
    data = core.dataset(ds)
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    st = lambda s: core.status_label(s, lang)
    ev = lambda y, r: core.risk_evidence(data, y, r, lang)
    q = question.casefold()
    asked = {int(y) for y in re.findall(r"20\d{2}", q)}
    if "去年" in q or "last year" in q:
        asked.add(year - 1)
    if "前年" in q:
        asked.add(year - 2)
    asked = sorted((asked & set(core.data_years(data))) - {year})
    analysis = core.analyze_budget(year, depts, ds, th)
    m = int(analysis.Actual_Cutoff_Month.max())
    tb, ta, tf = analysis.Budget_Full.sum(), analysis.Actual_YTD.sum(), analysis.Forecast_EOY.sum()
    estimate = sum(core.allocate_remaining_by_month(analysis, data, year).values(), pd.Series(0.0, index=core.MONTHS))
    ordered = _ordered(analysis)
    name = lambda d: core.dept_label(d, lang)
    facts = {
        "fiscal_year": year, "answer_language": T("Traditional Chinese (Taiwan)", "English"),
        "data_source": core.dataset_info(ds)["name"], "actuals_closed_through_month": m,
        # 門檻可由財務長調整，一併告訴模型，燈號說明才會和畫面一致
        "alert_rules": T(f"年底預算使用率超過 {th[0]}% 為高風險超支、超過 {th[1]}% 為需注意、低於 {th[2]}% 為執行落後，其餘為預算正常",
                         f"Year-end budget use above {th[0]}% = high overspend risk, above {th[1]}% = monitor closely, below {th[2]}% = behind plan, otherwise on track"),
        "company_total": {
            "annual_budget": f(tb), f"actual_spent_through_month_{m}": f(ta),
            "year_end_forecast": f(tf),
            "year_end_forecast_minus_budget": f"{f(tf - tb, True)} ({core.fpct((tf - tb) / tb * 100 if tb else 0, signed=True)})",
        },
        "departments_expected_to_overspend_largest_first": [
            f"{name(r.Department)} {f(r.Forecast_Var, True)} ({core.fpct(r.Forecast_Pct, signed=True)})"
            for r in analysis[analysis.Forecast_Var > 0].sort_values("Forecast_Var", ascending=False).itertuples()
        ],
        "departments_with_expected_unused_budget_largest_first": [
            f"{name(r.Department)} {T('預估結餘', 'unused')} {f(-r.Forecast_Var)} ({core.fpct(r.Forecast_Pct, signed=True)})"
            for r in analysis[analysis.Forecast_Var < 0].sort_values("Forecast_Var").itertuples()
        ],
        "alerts_to_report_in_this_order": [
            f"{name(r.Department)} | {st(r.Status)} | {T('年底預測差異', 'year-end forecast variance')} {f(r.Forecast_Var, True)} ({core.fpct(r.Forecast_Pct, signed=True)}) | "
            f"{ev(year, r)[0]}"
            for r in ordered.itertuples() if r.Status != "預算正常"
        ],
        "departments": [
            {"department": name(r.Department), "status": st(r.Status), "annual_budget": f(r.Budget_Full),
             f"budget_through_month_{m}": f(r.Budget_YTD), f"actual_spent_through_month_{m}": f(r.Actual_YTD),
             f"variance_through_month_{m}": f"{f(r.Actual_YTD - r.Budget_YTD, True)} ({core.fpct(r.Exec_Rate - 100, signed=True)})",
             "year_end_forecast": f(r.Forecast_EOY),
             "year_end_forecast_likely_range": f"{f(r.Forecast_Low)} – {f(r.Forecast_High)}",
             "year_end_forecast_minus_budget": f"{f(r.Forecast_Var, True)} ({core.fpct(r.Forecast_Pct, signed=True)})",
             "evidence": ev(year, r)}
            for r in ordered.itertuples()
        ],
        "selected_year_monthly_forecast_for_open_months_wan": " ".join(
            f"{T(f'{mo}月', f'M{mo}')}:{estimate.loc[mo] / 1e4:.0f}" for mo in core.MONTHS if estimate.loc[mo] > 0),
        "full_database_tables": data_tables(data[data.Department.isin(depts)], year, analysis,
                                           monthly_years={year} if compact else None, lang=lang, th=th),
    }
    if not compact:
        # 成本歸因（發票層級合成明細）：高於往年同期的科目與重複憑證，Groq / OpenRouter 的精簡版不附
        cost = core.costs(year, tuple(depts), ds, lang)
        facts["cost_driver_screen"] = {
            "rule": T(f"本期（截至 {cost['cutoff']} 月）比往年同期平均高至少 25% 且增加超過 {f(cost['drivers']['floor'])}",
                      f"Current period (through month {cost['cutoff']}) at least 25% and {f(cost['drivers']['floor'])} above the historical same-period average"),
            "flagged_categories": [f"{core.dept_label(r['dept'], lang)} {r['account']}: {f(r['amount'])} vs {f(r['hist'])} (+{r['pct']:.0f}%)"
                                   for r in cost["drivers"]["rows"] if r["flag"]],
            "duplicate_voucher_lines": [f"{core.dept_label(r['dept'], lang)} {r['id']} {r['vendor']} {f(r['amount'])}" for r in cost["duplicates"]],
        }
    if compact:
        facts["full_database_tables"]["unit_note"] +=T(f" 逐月明細只附 {year} 年；其他年度請用年度彙總表與 other_fiscal_years_requested。",
                                                         f" Monthly rows are included for {year} only; use the annual table and other_fiscal_years_requested for other years.")
    # 問到其他年度（「2025年」「去年」）時，另外附上該年度完整的部門分析
    if asked:
        facts["other_fiscal_years_requested"] = {}
        for y in asked[:2]:
            other = _ordered(core.analyze_budget(y, depts, ds, th))
            facts["other_fiscal_years_requested"][str(y)] = {
                "actuals_closed_through_month": int(other.Actual_Cutoff_Month.max()),
                "company_total": {"annual_budget": f(other.Budget_Full.sum()), "actual_spent": f(other.Actual_YTD.sum()),
                                  "year_end_result_or_forecast": f(other.Forecast_EOY.sum()),
                                  "minus_budget": f(other.Forecast_EOY.sum() - other.Budget_Full.sum(), True)},
                "departments": [
                    {"department": name(r.Department), "status": st(r.Status), "annual_budget": f(r.Budget_Full),
                     "actual_spent": f(r.Actual_YTD), "year_end_result_or_forecast": f(r.Forecast_EOY),
                     "minus_budget": f"{f(r.Forecast_Var, True)} ({core.fpct(r.Forecast_Pct, signed=True)})",
                     "evidence": ev(y, r)}
                    for r in other.itertuples()
                ],
            }
    return facts


AI_RULES = (
    "You are a budget analysis assistant for an insurance company's finance team. "
    "Answer in answer_language (Traditional Chinese means Taiwan usage); if the user clearly writes in another language, follow the user. "
    "Headline amounts are already formatted for the answer language (e.g. '30.71 億', '+7,051 萬' or 'NT$3.07B', '+NT$70.5M'): copy them exactly. "
    "Table amounts are integers in 萬 (NT$10,000): in Chinese quote them with 萬, converting to 億 above 10,000 萬 (10,000 萬 = 1 億); "
    "in English convert them to NT$ millions or billions (100 萬 = NT$1.0M). Lead with percentages when comparing. "
    "Distinguish carefully between amounts 'through month N' (actuals so far) and 'year_end_forecast' figures; never mix them. "
    "For rankings (largest overspend, most unused budget / reallocation sources) use the pre-sorted lists as given; a positive variance is overspend, never headroom. "
    "The headline facts (company_total, departments, alerts) describe the selected fiscal year and selected departments. "
    "full_database_tables contains the WHOLE loaded database for every year of the selected departments: monthly budget and actual, annual summary with status "
    "and tagged events. Use these tables to answer any question about other years, months, quarters, departments, trends, growth rates, rankings or comparisons; "
    "you may add, subtract and compute percentages from table values, and show the figures you used. "
    "A year with 12 closed months is a final result, not a forecast. "
    "For general finance, budgeting, insurance or regulation concepts (e.g. IFRS 17, TW-ICS, run rate, variance analysis) you may answer from your own knowledge, "
    "but every number about this company must come from the supplied facts; if the data truly does not contain something, say so and suggest what data would be needed. "
    "When explaining risk, cite the department, amount, comparison basis and the supplied evidence; do not invent causes. "
    "Never blame or rank individual employees; talk about departments, projects and events. "
    "Possible duplicate vouchers are items to verify, not violations or fraud; word them neutrally. "
    "Forecasts blend 55% seasonality from prior complete years and 45% run rate; one-off amounts are not extrapolated. "
    "Built-in data is synthetic demo data, not real company figures. "
    "Reallocation ideas are recommendations, never approved transactions. Keep answers concise: a one-sentence conclusion first, then short bullet lists. "
    "Use **bold** for key figures and '## ' headings only when the answer has several parts. Do not use tables. "
    "Never show raw data field names (e.g. cost_driver_screen, year_end_forecast_minus_budget) to the reader; describe them in plain words.\n"
)


def chart_rules(depts, lang="zh"):
    names = ", ".join(core.dept_label(d, lang) for d in depts)
    return (
        "\nCHART: after your answer, add ONE last line choosing the chart that best supports it, exactly in this form: "
        "<chart>{\"type\": ...}</chart>. Choose one of: "
        "{\"type\":\"forecast\"} = year-end variance of every department; "
        "{\"type\":\"monthly\",\"department\":D} = one department's monthly budget vs actual this year; "
        "{\"type\":\"history\",\"department\":D or null} = annual budget use across past years (null = whole company); "
        "{\"type\":\"none\"} when no chart helps (greetings, definitions, general concepts). "
        f"D must be one of: {names}. Never mention the tag in your text.\n"
        "ALWAYS answer the user's LATEST message only. Never repeat an earlier answer.\n"
    )


_CHART_TAG_RE = re.compile(r"<chart>\s*(\{.*?\})\s*</chart>", re.S)


def parse_chart_tag(reply, depts):
    """把模型挑的圖表從回答中拆出來。回傳 (乾淨文字, 圖表設定或 None, 是否成功解析)。"""
    match = _CHART_TAG_RE.search(reply)
    clean = re.sub(r"</?chart>", "", _CHART_TAG_RE.sub("", reply)).strip()
    if not match:
        return clean, None, False
    try:
        spec = json.loads(match.group(1))
    except json.JSONDecodeError:
        return clean, None, False
    names = {}
    for d in depts:
        for alias in (d, core.dept_key(d), core.DEPT_EN[core.dept_key(d)]):
            names[alias.casefold()] = core.dept_key(d)
    dept = names.get(str(spec.get("department") or "").strip().casefold())
    kind = spec.get("type")
    if kind == "none":
        return clean, None, True
    if kind == "forecast":
        return clean, {"type": "forecast"}, True
    if kind == "monthly" and dept:
        return clean, {"type": "monthly", "department": dept}, True
    if kind == "history":
        return clean, {"type": "history", "department": dept}, True
    return clean, None, False


def keyword_chart(question, depts):
    """模型沒挑圖（或用內建規則）時，依關鍵字挑圖。"""
    q = question.casefold()
    dept = next((core.dept_key(d) for d in depts if core.dept_key(d) in q or core.DEPT_EN[core.dept_key(d)].casefold() in q), None)
    if any(t in q for t in ("去年", "往年", "歷年", "前年", "趨勢", "history", "trend", "last year")):
        return {"type": "history", "department": dept}
    if dept:
        return {"type": "monthly", "department": dept}
    if any(t in q for t in ("超支", "風險", "預測", "落後", "結餘", "調撥", "圖", "overspend", "risk", "forecast", "chart")):
        return {"type": "forecast"}
    return None


# ==========================================
# 4. 數字查核：回答裡每個金額與百分比，都回頭比對交給模型的資料
# ==========================================
_AMOUNT_RE = re.compile(r"(?:NT\$\s?)?(?<![\d.])(\d[\d,]*(?:\.\d+)?)\s*(億|萬|billion|million|[BMK](?![A-Za-z]))")
_PCT_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(%|％|個百分點|pp(?![A-Za-z]))")
_AMOUNT_UNITS = {"億": 1e8, "萬": 1e4, "B": 1e9, "billion": 1e9, "M": 1e6, "million": 1e6, "K": 1e3}
_TABLE_INT_RE = re.compile(r"(?<![\d.])(\d+)(?![\d.%月])")


def _number_tokens(text):
    found = []
    for m in _AMOUNT_RE.finditer(text):
        digits, unit = m.group(1).replace(",", ""), _AMOUNT_UNITS[m.group(2)]
        decimals = len(digits.split(".")[1]) if "." in digits else 0
        found.append((m.start(), m.end(), "amount", float(digits) * unit, .5 * unit / 10 ** decimals))
    for m in _PCT_RE.finditer(text):
        decimals = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
        found.append((m.start(), m.end(), "pct", float(m.group(1)), .5 / 10 ** decimals))
    return sorted(found)


_PAIR_GAP_RE = re.compile(r"\s*[（(]\s*[+\-−]?\s*")  # 「7,051 萬（+2.4%）」金額與括號內百分比之間的文字


def _amount_pct_pairs(text):
    """找出「金額（百分比）」的組合，回傳 [(金額, 百分比, 百分比容許誤差, 金額起點, 金額容許誤差)]。"""
    toks = _number_tokens(text)
    return [(a[3], b[3], b[4], a[0], a[4]) for a, b in zip(toks, toks[1:])
            if a[2] == "amount" and b[2] == "pct" and _PAIR_GAP_RE.fullmatch(text[a[1]:b[0]])]


def _reference_numbers(facts):
    facts = dict(facts)
    tables = facts.pop("full_database_tables", {})
    amounts, pcts, pool, pairs = [], [], [], []

    def walk(node):
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, str):
            pairs.extend(p[:3] for p in _amount_pct_pairs(node))
            for _, _, kind, value, tol in _number_tokens(node):
                (amounts if kind == "amount" else pcts).append((value, tol))
                if kind == "amount":
                    pool.append(value)
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            pcts.append((float(node), .05))
    walk(facts)
    for key, node in facts.items():  # 「9月:6453」這類以萬元為單位、不帶單位字的欄位
        if key.endswith("_wan") and isinstance(node, str):
            amounts.extend((float(v) * 1e4, .5e4) for v in re.findall(r":(-?\d+)", node))
    derived = []
    for name, table in tables.items():
        if not isinstance(table, str) or name == "unit_note":
            continue
        for line in table.splitlines()[1:]:
            for cell in line.split("|")[2:]:
                for _, _, kind, value, tol in _number_tokens(cell):
                    if kind == "pct":
                        pcts.append((value, tol))
                ints = [float(v) * 1e4 for v in _TABLE_INT_RE.findall(cell)]
                amounts.extend((v, .5e4) for v in ints)
                if name == "annual_by_department":
                    pool.extend(ints[:2])
                if name == "monthly_budget_and_actual" and len(ints) >= 12:
                    run = np.cumsum([0.0] + ints[:12])
                    derived += [run[j] - run[i] for i in range(12) for j in range(i + 2, 13)]  # 任意連續月份合計
    pool = np.unique(np.array(pool, dtype=float))
    pool = pool[pool > 0]
    ratios = np.empty(0)
    if len(pool):
        r = pool[:, None] / pool[None, :] * 100
        ratios = np.unique(np.concatenate([r.ravel(), (r - 100).ravel()]))
    for constant in (55, 45, 80, 100, 15):  # 預警門檻已寫在 facts["alert_rules"]，上面的 walk 會收進來
        pcts.append((float(constant), .05))
    return {
        "amounts": np.array(sorted(v for v, _ in amounts)), "amount_tol": .5e4, "pool": pool, "pairs": pairs,
        "derived": np.unique(np.array(derived, dtype=float)), "pcts": np.array(sorted(v for v, _ in pcts)), "ratios": ratios,
    }


def _near(sorted_values, value, tol):
    if not len(sorted_values):
        return False
    i = np.searchsorted(sorted_values, value)
    return any(abs(sorted_values[j] - value) <= tol for j in (i - 1, i) if 0 <= j < len(sorted_values))


def _pair_hit(sorted_values, value, tol):
    if len(sorted_values) < 2:
        return False
    for targets in (value - sorted_values, sorted_values - value):
        idx = np.clip(np.searchsorted(sorted_values, targets), 1, len(sorted_values) - 1)
        gap = np.minimum(np.abs(sorted_values[idx] - targets), np.abs(sorted_values[idx - 1] - targets))
        if (gap <= tol).any():
            return True
    return False


def verify_numbers(text, facts):
    """exact = 直接引用資料；derived = 一步可得（加總、差額、比例、連續月份合計）；unmatched = 追溯不到，標示給讀者再確認。"""
    ref = _reference_numbers(facts)
    result = {"exact": 0, "derived": 0, "unmatched": [], "spans": []}
    # 金額與括號百分比一起出現時，要和資料裡同一組對得上：百分比對到某個項目、金額卻不同，就是寫錯
    # （單看金額時，月度明細與任意月份加總很多，錯的數字也容易碰巧「湊得到」）
    contradicted = set()
    for value, p, ptol, start, atol in _amount_pct_pairs(text):
        same_pct = [a for a, fp, ftol in ref["pairs"] if abs(fp - p) <= ptol + ftol]
        if same_pct and not any(abs(a - value) <= atol + ref["amount_tol"] for a in same_pct):
            contradicted.add(start)
    for start, end, kind, value, tol in _number_tokens(text):
        if start in contradicted:
            result["unmatched"].append(text[start:end].strip())
            result["spans"].append((start, end))
            continue
        if kind == "amount":
            slack = tol + ref["amount_tol"]
            if _near(ref["amounts"], value, slack):
                result["exact"] += 1
                continue
            if _near(ref["derived"], value, slack) or _pair_hit(ref["pool"], value, slack):
                result["derived"] += 1
                continue
        else:
            if _near(ref["pcts"], value, tol + .05):
                result["exact"] += 1
                continue
            if _near(ref["ratios"], value, tol + .05) or _near(ref["ratios"], -value, tol + .05):
                result["derived"] += 1
                continue
        result["unmatched"].append(text[start:end].strip())
        result["spans"].append((start, end))
    return result


MARK_OPEN, MARK_CLOSE = "", ""  # 前端把這兩個字元換成標示，表示「請再確認」


def mark_unmatched(text, check):
    out, last = [], 0
    for start, end in check["spans"]:
        out += [text[last:start], MARK_OPEN, text[start:end], MARK_CLOSE]
        last = end
    return "".join(out + [text[last:]])


# ==========================================
# 5. 內建規則（沒有模型或全部失敗時）
# ==========================================
def _names_dept(question, en_name):
    """英文部門名稱要整個字比對；IT 只認大寫，否則 write 裡的 it 或代名詞 it 都會被當成資訊部。"""
    return re.search(rf"\b{re.escape(en_name)}\b", question, 0 if en_name == "IT" else re.I) is not None


def rule_reply(question, year, depts, ds="", lang="zh", th=core.DEFAULT_TH):
    T = lambda zh, en: core.tx(lang, zh, en)
    f = lambda v, s=False: core.fmc(v, s, lang)
    name = lambda d: core.dept_label(d, lang)
    data = core.dataset(ds)
    analysis = core.analyze_budget(year, depts, ds, th)
    q = question.casefold()
    dept = next((d for d in analysis.Department
                 if core.dept_key(d) in q or _names_dept(question, core.DEPT_EN[core.dept_key(d)])), None)
    if dept:
        r = analysis[analysis.Department == dept].iloc[0]
        return T(f"**{name(dept)}｜{year} 年**\n\n"
                 f"- 年度預算 **{f(r.Budget_Full)}**，已執行 {f(r.Actual_YTD)}（同期執行率 {core.fpct(r.Exec_Rate)}）\n"
                 f"- 年底預測 **{f(r.Forecast_EOY)}**，與預算差異 {f(r.Forecast_Var, True)}（{core.fpct(r.Forecast_Pct, signed=True)}）\n"
                 f"- 狀態：{r.Status}\n"
                 f"- 判斷依據：{core.risk_evidence(data, year, r)[0]}",
                 f"**{name(dept)} | FY{year}**\n\n"
                 f"- Annual budget **{f(r.Budget_Full)}**; spent {f(r.Actual_YTD)} so far ({core.fpct(r.Exec_Rate)} of budget to date)\n"
                 f"- Year-end forecast **{f(r.Forecast_EOY)}**, {f(r.Forecast_Var, True)} vs budget ({core.fpct(r.Forecast_Pct, signed=True)})\n"
                 f"- Status: {core.status_label(r.Status, lang)}\n"
                 f"- Evidence: {core.risk_evidence(data, year, r, lang)[0]}")
    if any(w in q for w in ("落後", "閒置", "結餘", "調撥", "behind", "underspend", "unused", "realloc")):
        rows = analysis[analysis.Forecast_Var < 0].sort_values("Forecast_Var")
        if rows.empty:
            return T("目前選取的部門沒有預估結餘。", "None of the selected departments is expected to leave budget unused.")
        return T("**預估有結餘的部門**（可優先評估內部調撥）\n\n", "**Departments expected to leave budget unused** (first sources for reallocation)\n\n") + "\n".join(
            T(f"- **{name(r.Department)}**：預估結餘 {f(-r.Forecast_Var)}（{core.fpct(r.Forecast_Pct, signed=True)}）",
              f"- **{name(r.Department)}**: {f(-r.Forecast_Var)} unused ({core.fpct(r.Forecast_Pct, signed=True)})") for r in rows.itertuples())
    if any(w in q for w in ("超支", "風險", "overspend", "risk", "原因", "why", "over budget")):
        rows = analysis[analysis.Forecast_Var > 0].sort_values("Forecast_Var", ascending=False)
        if rows.empty:
            return T("目前選取的部門沒有預測超支項目。", "None of the selected departments is forecast to exceed budget.")
        return T("**預測超支部門**\n\n", "**Departments forecast to exceed budget**\n\n") + "\n".join(
            T(f"- **{name(r.Department)}**：{f(r.Forecast_Var, True)}（{core.fpct(r.Forecast_Pct, signed=True)}）。{core.risk_evidence(data, year, r)[0]}",
              f"- **{name(r.Department)}**: {f(r.Forecast_Var, True)} ({core.fpct(r.Forecast_Pct, signed=True)}). {core.risk_evidence(data, year, r, lang)[0]}.")
            for r in rows.itertuples())
    return (" " if lang == "en" else "").join(core.executive_summary(analysis, lang)) + T(
        "\n\n輸入部門名稱可查看個別部門；問「超支」或「結餘」可列出相關部門。",
        "\n\nAsk about a department by name for its details, or ask about overspend or unused budget for a list.")


# ==========================================
# 6. 對話入口
# ==========================================
def brief_prompt(lang="zh", single_dept=None, role="cfo"):
    """預警簡報固定的寫作要求，讓每次產出的段落結構一致，方便直接轉成 PDF。只看一個部門（例如部門主管）時改寫成部門簡報；
    財務長看的是給自己的簡報，財務分析師則是整理後提報管理層。"""
    if single_dept:
        name = core.dept_label(single_dept, lang)
        return core.tx(lang,
            f"請寫一份{name}的預算簡報，給部門主管與財務長閱讀。只輸出簡報本身，依序使用這三個段落標題，標題文字照抄：\n"
            "## 重點摘要\n## 原因與建議行動\n## 下一步\n\n"
            "寫作要求（不要把這些要求寫進簡報）：\n"
            f"- 重點摘要：三個項目，說明{name}的年底預估與差異（直接引用 company_total 的 year_end_forecast_minus_budget）、燈號、與往年相比的情況。\n"
            "- 原因與建議行動：依 evidence 說明主要原因，每個原因一個項目，並附一項具體建議。\n"
            "- 下一步：三個需要追蹤的事項。\n"
            "- 不要提到其他部門或全公司；不要畫圖、不要開場白或結尾客套話；金額只使用資料中的數字；用語中性，用「暫緩」不用「凍結」。",
            f"Write a budget brief for {name}, for the department head and the CFO. Output only the brief, using exactly these three section headings:\n"
            "## Key points\n## Causes and actions\n## Next steps\n\n"
            "Writing rules (do not include these rules in the brief):\n"
            f"- Key points: three items on {name}'s year-end forecast and gap (quote company_total.year_end_forecast_minus_budget exactly), its status, and how it compares with past years.\n"
            "- Causes and actions: one item per cause from the evidence, each with one concrete action.\n"
            "- Next steps: three items to follow up.\n"
            "- Do not mention other departments or the whole company; no chart, no greeting or sign-off; only use figures from the data; neutral wording (say \"defer\", not \"freeze\").")
    cfo = role == "cfo"
    reader = core.tx(lang, "財務長" if cfo else "管理層", "the CFO" if cfo else "management")
    return core.tx(lang,
        f"請寫一份給{reader}的預算預警簡報。只輸出簡報本身，依序使用這三個段落標題，標題文字照抄、不要加說明：\n"
        "## 重點摘要\n## 預警部門與建議行動\n## 下一步\n\n"
        "寫作要求（不要把這些要求寫進簡報）：\n"
        "- 重點摘要：三個項目，分別說明全公司年底預估與差異、主要超支來源、可用結餘。全公司差異一律直接引用 company_total 的 year_end_forecast_minus_budget。\n"
        "- 預警部門與建議行動：依 alerts_to_report_in_this_order 的順序，每個部門一個項目，格式為「**部門｜燈號**：年底差異（百分比）。原因。建議：一項具體行動。」\n"
        f"- 下一步：三個需要{reader}決定或追蹤的事項。\n"
        "- 不要畫圖、不要開場白或結尾客套話；金額只使用資料中的數字；用語中性，用「暫緩」不用「凍結」。",
        f"Write a budget alert brief for {reader}. Output only the brief, using exactly these three section headings, copied as-is with nothing added:\n"
        "## Key points\n## Flagged departments and actions\n## Next steps\n\n"
        "Writing rules (do not include these rules in the brief):\n"
        "- Key points: three items covering the company year-end forecast and gap, the main overspend sources, and available headroom. Quote the company gap exactly from company_total.year_end_forecast_minus_budget.\n"
        "- Flagged departments and actions: one item per department in the order of alerts_to_report_in_this_order, formatted as \"**Department | status**: year-end gap (percent). Cause. Action: one concrete step.\"\n"
        f"- Next steps: three items {reader} should decide or follow up.\n"
        "- No chart, no greeting or sign-off; only use figures from the data; keep the wording neutral (say \"defer\", not \"freeze\").")


def chat(year, depts, messages, ds="", scope_note="", lang="zh", th=core.DEFAULT_TH, fresh=False, brief=False, limited=False):
    """limited=True：此來源已超過使用次數上限（見 server.ai_allowed），只用快取答案，否則改由內建規則回覆。"""
    question = messages[-1]["content"]
    conversation = [{"role": m["role"], "content": m["content"][:4000]} for m in messages[-12:]]
    while conversation and conversation[0]["role"] == "assistant":
        conversation = conversation[1:]
    rules_label = core.tx(lang, "內建規則", "Built-in rules")
    chain = ai_chain()
    if chain:
        facts = build_facts(year, depts, question, ds=ds, lang=lang, th=th)
        compact = build_facts(year, depts, question, compact=True, ds=ds, lang=lang, th=th)
        if scope_note:
            facts["viewer_scope"] = compact["viewer_scope"] = scope_note
        rules = AI_RULES + chart_rules(depts, lang)
        systems = {"full": rules + json.dumps(facts, ensure_ascii=False),
                   "compact": rules + json.dumps(compact, ensure_ascii=False)}
        try:
            reply, source, notes = llm_answer(conversation, systems, fresh and not limited, cache_only=limited)
            reply, chart, picked = parse_chart_tag(reply, depts)
            first = re.search(r"^## ", reply, re.M)
            if brief and first:  # 一般對話規則要求「先一句結論」，簡報從第一個段落標題開始，避免和重點摘要重複
                reply = reply[first.start():]
            if not picked:
                chart = keyword_chart(question, depts)
            check = verify_numbers(reply, facts)
            return {"text": mark_unmatched(reply, check), "source": source, "mode": "ai", "notes": notes, "chart": chart,
                    "check": {"exact": check["exact"], "derived": check["derived"], "unmatched": len(check["unmatched"])}}
        except RuntimeError as err:
            note = core.tx(lang, "使用次數暫時達到上限，這次改由內建規則回覆；約一分鐘後可再使用 AI。",
                           "AI usage limit reached for now; this answer uses the built-in rules. Try AI again in about a minute.") if limited else str(err)
            return {"text": rule_reply(question, year, depts, ds, lang, th), "source": rules_label, "mode": "limited" if limited else "fallback",
                    "notes": [note], "chart": keyword_chart(question, depts), "check": None}
    return {"text": rule_reply(question, year, depts, ds, lang, th), "source": rules_label, "mode": "rules", "notes": [],
            "chart": keyword_chart(question, depts), "check": None}
