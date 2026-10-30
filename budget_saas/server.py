"""預算決策中心 API 與前端靜態檔服務。

本機執行：python -m uvicorn server:app --port 8600 --reload

每個資料 API 都接受 ds（上傳資料集代號，空白＝合成示範資料）與 role / dept（檢視身分）。
身分是展示用，正式導入時改由公司 SSO 帶入；部門主管的範圍在伺服器端強制套用。
"""
import io
import json
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import ai
import budget_core as core
import report

STATIC = Path(__file__).parent / "static"
MAX_UPLOAD_BYTES = 3 * 1024 * 1024
app = FastAPI(title="預算決策中心", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=2048)  # 費用明細帳約 300 KB，壓縮後約十分之一

Role = Literal["cfo", "fpa", "head"]
Lang = Literal["zh", "en"]


def pick_depts(depts, ds=""):
    # 部門清單依資料集而定：匯入的檔案可以有內建 8 個以外的部門
    names = {core.dept_key(d): d for d in core.dept_order(core.dataset(ds))}
    return [names[n] for n in depts.split(",") if n in names]


def scoped(depts, role, dept, ds=""):
    """部門主管只能看自己的部門，不管前端送什麼。"""
    if role == "head":
        own = pick_depts(dept, ds)
        if not own:
            raise HTTPException(400, "部門主管身分需要指定所屬部門")
        return own
    return pick_depts(depts, ds)


def check_year(year, ds):
    if year not in core.data_years(core.dataset(ds)):
        raise HTTPException(404, "沒有這個年度的資料")


@app.on_event("startup")
def warm_cache():
    # 回放要重算約 440 次預測（約 2 秒），開機時先在背景算好全部門的版本
    threading.Thread(target=core.replay, args=((),), daemon=True).start()


@app.get("/api/meta")
def get_meta(ds: str = ""):
    return core.meta(ds)


@app.get("/api/overview")
def get_overview(year: int, depts: str = Query("", description="以逗號分隔的部門名稱，空白代表全部"),
                 ds: str = "", role: Role = "cfo", dept: str = "", lang: Lang = "zh", th: str = ""):
    check_year(year, ds)
    return core.overview(year, scoped(depts, role, dept, ds), ds, lang, core.parse_th(th))


@app.get("/api/report.pdf")
def get_report(year: int, depts: str = "", ds: str = "", role: Role = "cfo", dept: str = "", lang: Lang = "zh", th: str = ""):
    check_year(year, ds)
    pdf, name = report.executive_report(year, scoped(depts, role, dept, ds), ds, lang, role, core.parse_th(th))
    # 中文檔名用 RFC 5987 編碼，另附 ASCII 檔名給舊瀏覽器
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=\"FY{year}_budget_summary.pdf\"; filename*=UTF-8''{quote(name)}"})


@app.get("/api/replay")
def get_replay(depts: str = "", ds: str = "", role: Role = "cfo", dept: str = "", th: str = ""):
    return core.replay(tuple(scoped(depts, role, dept, ds)), ds, core.parse_th(th))


@app.get("/api/backtest")
def get_backtest(year: int, depts: str = "", month: int = 8, ds: str = "", role: Role = "cfo", dept: str = ""):
    check_year(year, ds)
    return core.backtest(year, tuple(scoped(depts, role, dept, ds)), month, ds)


@app.get("/api/costs")
def get_costs(year: int, depts: str = "", ds: str = "", role: Role = "cfo", dept: str = "", lang: Lang = "zh"):
    check_year(year, ds)
    return core.costs(year, tuple(scoped(depts, role, dept, ds)), ds, lang, role)


@app.get("/api/ledger.xlsx")
def get_ledger_xlsx(year: int, depts: str = "", ds: str = "", role: Role = "cfo", dept: str = "", lang: Lang = "zh",
                    fdept: str = "", gl: str = "", cfo: bool = False, q: str = Query("", max_length=100)):
    """費用明細帳匯出：範圍與遮罩和畫面相同（部門主管只匯得出自己部門）；fdept / gl / cfo / q 為明細帳的篩選條件。"""
    check_year(year, ds)
    data, name = report.ledger_xlsx(year, scoped(depts, role, dept, ds), ds, lang, role, fdept, gl, cfo, q)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename=\"FY{year}_expense_ledger.xlsx\"; filename*=UTF-8''{quote(name)}"})


@app.get("/api/quality")
def get_quality(ds: str = "", lang: Lang = "zh"):
    return core.quality(ds, lang)


@app.get("/api/template.csv")
def get_template(ds: str = ""):
    name = "budget_monthly_template.csv" if not core.dataset_info(ds)["id"] else "budget_monthly_current.csv"
    return Response(core.template_csv(ds), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/scale")
def post_scale(scale: float, role: Role = "cfo", lang: Lang = "zh"):
    """系統設定：依公司年度營業費用量級（億元）重新產生示範資料，回傳新的資料集代號。"""
    if role == "head":
        raise HTTPException(403, core.tx(lang, "部門主管身分沒有變更系統設定的權限", "Department heads cannot change settings"))
    return core.dataset_info(core.scaled_demo(scale))


@app.post("/api/upload")
async def post_upload(request: Request, name: str = "上傳資料.csv", role: Role = "cfo", lang: Lang = "zh"):
    T = lambda zh, en: core.tx(lang, zh, en)
    if role == "head":
        raise HTTPException(403, T("部門主管身分沒有匯入資料的權限", "Department heads cannot import data"))
    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, T("檔案超過 3 MB", "The file is larger than 3 MB"))
    raw = None
    for enc in ("utf-8-sig", "cp950"):  # Excel 另存的 CSV 常是 Big5（cp950）
        try:
            raw = pd.read_csv(io.BytesIO(body), encoding=enc, dtype=str, keep_default_na=False, na_values=[""])
            break
        except UnicodeDecodeError:
            continue
        except Exception:
            raise HTTPException(422, detail={"errors": [T("無法讀取檔案，請確認是 CSV 格式（逗號分隔）。", "Cannot read the file; make sure it is a comma-separated CSV.")]})
    if raw is None:
        raise HTTPException(422, detail={"errors": [T("無法辨識檔案編碼，請用 UTF-8 或 Big5 另存 CSV。", "Unknown text encoding; save the CSV as UTF-8 or Big5.")]})
    data, errors = core.validate_upload(raw, lang)
    if errors:
        raise HTTPException(422, detail={"errors": errors})
    ds = core.register_dataset(data, Path(name).name[:80])
    return core.dataset_info(ds)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    year: int
    depts: str = ""
    ds: str = ""
    viewRole: Role = "cfo"
    viewDept: str = ""
    lang: Lang = "zh"
    th: str = ""
    messages: list[Message] = Field(min_length=1, max_length=40)


class BriefRequest(BaseModel):
    year: int
    depts: str = ""
    ds: str = ""
    viewRole: Role = "cfo"
    viewDept: str = ""
    lang: Lang = "zh"
    th: str = ""
    fresh: bool = False


class BriefPdfRequest(BriefRequest):
    text: str = Field(min_length=1, max_length=12000)
    source: str = Field("", max_length=80)
    check: dict | None = None


def head_note(role, picked, lang):
    """部門主管只看得到自己的部門：告訴模型範圍，問到其他部門時說明是權限而不是沒有資料。"""
    if role != "head":
        return ""
    own = core.dept_label(picked[0], lang)
    return (f"The user is the head of {own} and is only authorised to see {own} data. If they ask about another department "
            f"or the whole company, explain that it is outside their current access (not missing data), then answer about {own} instead.")


# AI 用量保護：網站是公開網址，免費 AI 額度可能被少數人在短時間內用光，比賽當天就無法使用。
# 每個來源 IP 每分鐘最多 15 次、每小時 150 次；全站每分鐘最多 30 次。超過時仍回覆（快取或內建規則），網站照常可用。
# 單一 IP 的上限不能太低：比賽現場評審多半連同一個 Wi-Fi，對外是同一個 IP
AI_LIMITS = ((60, 15), (3600, 150))
AI_GLOBAL_PER_MIN = 30
_AI_HITS: dict[str, deque] = defaultdict(deque)
_AI_ALL: deque = deque()
_AI_LOCK = threading.Lock()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")  # Render 在代理之後，真正的來源放在這裡
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def ai_allowed(request: Request) -> bool:
    now, ip = time.time(), client_ip(request)
    with _AI_LOCK:
        hits = _AI_HITS[ip]
        while hits and now - hits[0] > AI_LIMITS[-1][0]:
            hits.popleft()
        while _AI_ALL and now - _AI_ALL[0] > 60:
            _AI_ALL.popleft()
        if len(_AI_ALL) >= AI_GLOBAL_PER_MIN or any(sum(1 for t in hits if now - t <= win) >= n for win, n in AI_LIMITS):
            return False
        hits.append(now)
        _AI_ALL.append(now)
        if len(_AI_HITS) > 5000:  # 記憶體上限
            _AI_HITS.clear()
        return True


def chat_depts(req):
    picked = scoped(req.depts, req.viewRole, req.viewDept, req.ds)
    depts = core.pick(core.dataset(req.ds), picked)
    return depts, head_note(req.viewRole, picked, req.lang)


def sse(events):
    """把逐字事件包成 Server-Sent Events；X-Accel-Buffering 讓 Render 前面的代理不要整段緩衝。"""
    def body():
        for event in events:
            yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def brief_events(req, request):
    """AI 主管預警簡報：固定寫作格式，沿用對話的資料、數字查核與備援。"""
    check_year(req.year, req.ds)
    depts, note = chat_depts(req)
    prompt = [{"role": "user", "content": ai.brief_prompt(req.lang, depts[0] if len(depts) == 1 else None, req.viewRole)}]
    th = core.parse_th(req.th)
    events = ai.chat_stream(req.year, depts, prompt, req.ds, note, req.lang, th, req.fresh, brief=True, limited=not ai_allowed(request))

    def run():
        for event in events:
            if event["type"] == "done" and event["mode"] != "ai":  # 對話用的內建規則回答不了簡報格式，改用固定格式的規則簡報
                event["text"] = report.rule_brief(req.year, depts, req.ds, req.lang, th)
            yield event
    return run()


@app.post("/api/brief")
def post_brief(req: BriefRequest, request: Request):
    for event in brief_events(req, request):
        if event["type"] == "done":
            return {k: v for k, v in event.items() if k != "type"}


@app.post("/api/brief/stream")
def post_brief_stream(req: BriefRequest, request: Request):
    return sse(brief_events(req, request))


@app.post("/api/brief.pdf")
def post_brief_pdf(req: BriefPdfRequest):
    check_year(req.year, req.ds)
    depts, _ = chat_depts(req)
    pdf, name = report.brief_report(req.year, depts, req.text, req.source or "AI", req.check, req.ds, req.lang, core.parse_th(req.th))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=\"FY{req.year}_AI_alert_brief.pdf\"; filename*=UTF-8''{quote(name)}"})


class TransferRequest(BaseModel):
    year: int
    lang: Lang = "zh"
    ds: str = ""
    no: str = Field(pattern=r"^TR-\d{4}-\d{4}-\d{4}$")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    fromDept: str
    toDept: str
    amount: float = Field(gt=0, lt=1e12)
    fromForecast: float
    fromBudget: float
    toForecast: float
    toBudget: float
    infl: float = 0
    vol: float = 0
    fx: float = 0
    reason: str = Field("", max_length=1000)


@app.post("/api/transfer.pdf")
def post_transfer_pdf(req: TransferRequest):
    keys = {core.dept_key(d) for d in core.dept_order(core.dataset(req.ds))}
    if req.fromDept not in keys or req.toDept not in keys:
        raise HTTPException(422, core.tx(req.lang, "部門名稱不正確", "Unknown department"))
    pdf, name = report.transfer_request(req, req.lang, core.dataset_info(req.ds)["source"] == "synthetic")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=\"{req.no}.pdf\"; filename*=UTF-8''{quote(name)}"})


@app.get("/healthz")
def healthz():
    """給定時喚醒（.github/workflows/keep-warm.yml）用：不讀資料、不呼叫 AI，只讓 Render 免費方案不進入休眠。"""
    return {"ok": True}


@app.get("/api/ai-status")
def get_ai_status():
    return ai.status()


def chat_args(req, request):
    check_year(req.year, req.ds)
    if req.messages[-1].role != "user" or not req.messages[-1].content.strip():
        raise HTTPException(422, "最後一則訊息必須是問題")
    depts, note = chat_depts(req)
    return dict(year=req.year, depts=depts, messages=[m.model_dump() for m in req.messages], ds=req.ds, scope_note=note,
                lang=req.lang, th=core.parse_th(req.th), limited=not ai_allowed(request))


@app.post("/api/chat")
def post_chat(req: ChatRequest, request: Request):
    return ai.chat(**chat_args(req, request))


@app.post("/api/chat/stream")
def post_chat_stream(req: ChatRequest, request: Request):
    return sse(ai.chat_stream(**chat_args(req, request)))


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/{path:path}")
def spa(path: str):
    # 前端用網址路徑切換頁面，所有非 API 路徑都回傳同一個頁面
    # no-cache：每次都向伺服器確認頁面是否更新，否則瀏覽器沿用舊頁面，CSS/JS 的 ?v= 版本號就失效了
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
