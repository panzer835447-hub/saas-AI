# 預算決策中心（B方案）

FastAPI 後端 ＋ Preact／ECharts 前端（不需要 Node，也不需要編譯）。Streamlit 版（根目錄 `app.py`）是另一套，兩者互不影響。

## 本機執行

```bash
cd budget_saas
pip install -r requirements.txt
python -m uvicorn server:app --port 8600 --reload
```

打開 http://localhost:8600 。AI 金鑰放在 `budget_saas/secrets.toml`（格式見 `secrets.toml.example`），**這個檔案不可上傳到 GitHub**。

## 部署到 Render（免費方案）

Streamlit Community Cloud 只能跑 Streamlit，B方案是一般網站伺服器，所以改用 Render。設定已寫在 repo 根目錄的 `render.yaml`。

### 1. 上傳到 GitHub（網頁操作）

從 `_上傳到GitHub` 資料夾把以下項目拖進 repo 的 **Add file → Upload files**，再按 **Commit changes**：

- `budget_saas` 整個資料夾（內含 `fonts`、`static`；已排除 `secrets.toml`）
- `render.yaml`
- `.gitignore`
- `app.py`（Streamlit 版的最新檔案，順便更新）

### 2. 在 Render 建立服務

1. 到 https://render.com 用 GitHub 帳號登入。
2. 右上角 **New → Blueprint**，選這個 repo，Render 會讀到 `render.yaml`。
3. 畫面會要求填三個金鑰：`GEMINI_API_KEY`、`GROQ_API_KEY`、`OPENROUTER_API_KEY`，填入與 Streamlit Cloud secrets 相同的值（沒有的可以留空，AI 會自動改用其他服務或內建規則）。
4. 按 **Apply**，第一次建置約 3–5 分鐘。完成後網址類似 `https://budget-command-center.onrender.com`。

### 3. 上線後確認

- 打開網址應看到總覽頁；右上角「摘要報告」可下載 PDF；AI 助理頁應顯示線上。
- 之後每次在 GitHub 更新 `budget_saas` 裡的檔案，Render 會自動重新部署。

### 注意事項

- **免費方案閒置 15 分鐘會休眠**，下一次開啟要等約 1 分鐘喚醒。簡報或評審前請先打開網址暖機。
- 上傳的 CSV 只存在記憶體，服務休眠或重新部署後會自動改回示範資料（畫面會提示）。
- 若建置失敗並出現 Python 版本相關錯誤，到 Render 服務的 **Environment** 把 `PYTHON_VERSION` 改成 Render 預設的 `3.14.8`（必須寫完整的三段版本號）後重新部署。
- 沒有填任何 AI 金鑰，或三家額度都用完時，網站仍可正常使用：AI 助理與預警簡報改用內建規則產生（畫面會標示「內建規則」）。
