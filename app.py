"""
日文單字測驗機 - 本機執行

流程：
1. 貼上 sigure.tw 的單字頁面網址 -> 後端爬蟲抓下單字表 -> 存進 data/questions.json 題庫
2. 前端從題庫挑選單元/模式出題（中文->假名 或 日文->假名）
3. 作答後顯示正確答案 + 發音（瀏覽器內建語音合成，非抓取自來源網站的音檔）
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from scraper import scrape_url

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("japanese-quiz")

app = FastAPI(title="日文單字測驗機")

DATA_PATH = Path(__file__).parent / "data" / "questions.json"

# 假名應該只由平假名、片假名、長音記號（ー）與波浪號組成；
# 來源網站偶爾會把「假名」欄位誤植成英文（如 papa、register），
# 這裡在寫入題庫前自動偵測並嘗試修正。
_KANA_RE = re.compile(r"^[぀-ゟ゠-ヿー～\s]+$")
_ALL_KATAKANA_RE = re.compile(r"^[゠-ヿー]+$")
_ALL_HIRAGANA_RE = re.compile(r"^[぀-ゟー]+$")


def _looks_like_kana(s: str) -> bool:
    return bool(s) and bool(_KANA_RE.match(s))


def _katakana_to_hiragana(s: str) -> str:
    return "".join(
        chr(ord(ch) - 0x60) if "ァ" <= ch <= "ヶ" else ch for ch in s
    )


def _fix_kana(word: str, kana: str) -> tuple[str, str | None]:
    """回傳 (最終使用的 kana, 警告訊息或 None)。

    測驗答案一律用平假名比對，所以這裡順便把片假名假名也轉成平假名，
    不只是修正英文／佔位符這類明顯錯誤。
    """
    converted = _katakana_to_hiragana(kana)
    if _looks_like_kana(converted) and not re.search(r"[A-Za-z]", converted):
        if converted != kana:
            return converted, f"{word}：假名欄位為片假名「{kana}」，已自動轉成平假名「{converted}」"
        return kana, None
    if _ALL_KATAKANA_RE.match(word):
        fixed = _katakana_to_hiragana(word)
        return fixed, f"{word}：假名欄位為「{kana}」，已自動改成「{fixed}」"
    if _ALL_HIRAGANA_RE.match(word):
        # 來源網站對「本身就是假名」的單字常用「-」等符號代替假名欄位
        return word, f"{word}：假名欄位為「{kana}」，已自動改成「{word}」（沿用單字本身）"
    return kana, f"{word}：假名欄位為「{kana}」，看起來不是假名，請手動確認"


def _entry_id(word: str, kana: str) -> str:
    return hashlib.md5(f"{word}|{kana}".encode("utf-8")).hexdigest()[:12]


def load_bank() -> dict:
    if not DATA_PATH.exists():
        return {}
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def save_bank(bank: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding="utf-8")


class ScrapeRequest(BaseModel):
    urls: list[str]


@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    bank = load_bank()
    added, updated, failed = 0, 0, []
    kana_warnings: list[str] = []

    for url in req.urls:
        url = url.strip()
        if not url:
            continue
        try:
            result = scrape_url(url)
        except Exception as exc:  # noqa: BLE001 - 回報給使用者，不中斷其他 URL
            logger.warning("抓取失敗 %s: %s", url, exc)
            failed.append({"url": url, "error": str(exc)})
            continue

        for e in result.entries:
            kana, warning = _fix_kana(e.word, e.kana)
            if warning:
                logger.warning(warning)
                kana_warnings.append(warning)

            eid = _entry_id(e.word, kana)
            existing_hidden = bank.get(eid, {}).get("hidden", False)
            if eid in bank:
                updated += 1
            else:
                added += 1
            bank[eid] = {
                "id": eid,
                "word": e.word,
                "kana": kana,
                "accent": e.accent,
                "meaning": e.meaning,
                "romaji": e.romaji,
                "category": e.category,
                "unit_title": e.unit_title,
                "unit_url": e.unit_url,
                "level": e.level,
                "hidden": existing_hidden,
            }

    save_bank(bank)
    return {
        "added": added,
        "updated": updated,
        "failed": failed,
        "kana_warnings": kana_warnings,
        "total": len(bank),
    }


@app.get("/api/questions")
def api_questions():
    bank = load_bank()
    return {"questions": [{**e, "hidden": bool(e.get("hidden", False))} for e in bank.values()]}


class HiddenUpdateRequest(BaseModel):
    ids: list[str]
    hidden: bool


@app.post("/api/questions/hidden")
def api_set_hidden(req: HiddenUpdateRequest):
    bank = load_bank()
    updated = 0
    for eid in req.ids:
        if eid in bank:
            bank[eid]["hidden"] = req.hidden
            updated += 1
    save_bank(bank)
    return {"updated": updated}


@app.delete("/api/questions/{entry_id}")
def api_delete_question(entry_id: str):
    bank = load_bank()
    if entry_id not in bank:
        raise HTTPException(status_code=404, detail="找不到這筆單字")
    del bank[entry_id]
    save_bank(bank)
    return {"status": "deleted"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.middleware("http")
async def no_cache_frontend(request, call_next):
    """前端檔案（html/js/css）一律不快取，避免改完程式碼後瀏覽器還在跑舊版。"""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8787, reload=True)
