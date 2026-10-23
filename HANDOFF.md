# 交班紀錄（最新在上，最多保留 5 筆）

## 2026-10-24 — 支援 GitHub Pages（手機可測驗）
- **做了什麼**：前端改成雙模式。`quiz.js` 啟動時打 `/api/health`：有後端＝電腦模式（照舊）；沒有＝靜態模式，讀同目錄 `questions.json`，篩選（hidden）存 localStorage `jpquiz.hiddenOverrides`，隱藏抓取區、預設開「開始測驗」分頁。單元清單改由前端 `buildUnits()` 計算，刪除後端 `/api/units`。
- **使用者決定**：題庫 `data/questions.json` 跟網頁一起公開（已知 sigure.tw 版權風險，使用者接受）。
- **改了哪些檔**：`frontend/quiz.js`、`frontend/index.html`（`#scrapeSection`、`#staticNotice`，資源版本 v=5）、`app.py`、`.gitignore`（改成只排除備份檔）、新增 `.github/workflows/pages.yml`（push main → 複製 frontend/* + questions.json 發布）。
- **已驗證**：node 語法檢查、本機後端 API、模擬靜態站（/api/health 404、questions.json 200）。尚未在真的手機瀏覽器上測試。
- **已上線**：repo https://github.com/w455up/japanese-quiz （public），網站 https://w455up.github.io/japanese-quiz/ 。git 身分設在 repo 本地（w455up + GitHub noreply email）。gh 已有 workflow 權限。
- **之後更新題庫**：電腦抓完 → commit `data/questions.json` → push，Actions 自動部署。

## 2026-10-24 — GitHub 上傳前安全檢查
- **做了什麼**：掃描所有程式與資料檔（排除 .venv），沒有 API key、token、密碼或個人路徑/email。程式只連 sigure.tw，沒有用到任何需要金鑰的服務。
- **改了哪些檔**：新增 `.gitignore`（排除 .venv、__pycache__、error.txt、data/ 題庫檔）、`CLAUDE.md`（交班規則）、本檔。
- **待確認**：
  - 專案還不是 git repo，使用者尚未 `git init` / 推上 GitHub。
  - `requirements.txt` 版本是 2024 年的，之後有空可以升級。
