"""
sigure.tw 日文單字頁面爬蟲

通用抓取邏輯：讀取類似
  https://www.sigure.tw/learn-japanese/vocabulary/n4/01
這種頁面裡的 <table class="vocab-table"> 單字表，不限定 N 幾級、不限定單元編號。

每張表格欄位固定為：日文 / 假名 / 重音 / 中文 / 發音（按鈕帶有 onclick="play('romaji')"）。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

PLAY_RE = re.compile(r"play\('([^']+)'\)")


@dataclass
class VocabEntry:
    word: str  # 日文（漢字或假名寫法）
    kana: str  # 假名讀音
    accent: str  # 重音，例如 [3][0]
    meaning: str  # 中文意思
    romaji: str  # 羅馬拼音（僅供發音備用，非必要比對用）
    category: str  # 表格 caption，例如「名詞（數字與時間）」
    unit_title: str  # 頁面標題，例如「N4日文單字01（名詞）數字與時間」
    unit_url: str
    level: str  # n1~n5


@dataclass
class ScrapeResult:
    entries: list[VocabEntry] = field(default_factory=list)
    unit_title: str = ""
    url: str = ""
    level: str = ""


def _guess_level(url: str) -> str:
    m = re.search(r"/vocabulary/(n[1-5])/", url)
    return m.group(1) if m else ""


def fetch_html(url: str, timeout: int = 15) -> str:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    resp.raise_for_status()
    # sigure.tw 的 Content-Type 已標明 UTF-8；requests 對這類頁面的字元集猜測
    # （apparent_encoding）常常誤判成其他編碼導致亂碼，這裡直接信任伺服器宣告。
    if not resp.encoding or resp.encoding.lower() != "utf-8":
        resp.encoding = "utf-8"
    return resp.text


def _is_vocab_table(table) -> bool:
    """判斷表格是否為單字表。

    sigure.tw 的單字表不一定帶有 class="vocab-table"（例如 n4/05 就沒有），
    所以改用表頭文字（日文／中文）來辨識，才不會因為 class 缺漏而漏抓整頁。
    """
    header_row = table.find("tr")
    header_cells = header_row.find_all(["th", "td"]) if header_row else []
    header_text = "".join(cell.get_text(strip=True) for cell in header_cells)
    return "日文" in header_text and "中文" in header_text


def parse_vocab_page(html: str, url: str) -> ScrapeResult:
    soup = BeautifulSoup(html, "html.parser")
    level = _guess_level(url)

    title_el = soup.select_one("h1.article__title")
    unit_title = title_el.get_text(strip=True) if title_el else url

    result = ScrapeResult(unit_title=unit_title, url=url, level=level)

    for table in soup.select("section.article__content table"):
        if not _is_vocab_table(table):
            continue

        caption_el = table.find("caption")
        category = caption_el.get_text(strip=True) if caption_el else ""

        body = table.find("tbody") or table
        for tr in body.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue

            word_span = tds[0].select_one("span[lang=ja]") or tds[0]
            kana_span = tds[1].select_one("span[lang=ja]") or tds[1]
            word = word_span.get_text(strip=True)
            kana = kana_span.get_text(strip=True)

            accent_el = tds[2].select_one(".accent")
            accent = accent_el.get_text(strip=True) if accent_el else tds[2].get_text(strip=True)

            meaning = tds[3].get_text(strip=True)

            romaji = ""
            if len(tds) >= 5:
                btn = tds[4].find("button")
                if btn and btn.get("onclick"):
                    m = PLAY_RE.search(btn["onclick"])
                    if m:
                        romaji = m.group(1)

            if not word or not kana:
                continue

            result.entries.append(
                VocabEntry(
                    word=word,
                    kana=kana,
                    accent=accent,
                    meaning=meaning,
                    romaji=romaji,
                    category=category,
                    unit_title=unit_title,
                    unit_url=url,
                    level=level,
                )
            )

    return result


def scrape_url(url: str) -> ScrapeResult:
    parsed = urlparse(url)
    if "sigure.tw" not in parsed.netloc:
        raise ValueError(f"目前只支援 sigure.tw 的單字頁面：{url}")
    html = fetch_html(url)
    return parse_vocab_page(html, url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scraper.py <sigure.tw 單字頁面 URL> [URL2 ...]")
        raise SystemExit(1)

    for target_url in sys.argv[1:]:
        r = scrape_url(target_url)
        print(f"\n=== {r.unit_title} ({r.url}) ===")
        for e in r.entries:
            print(f"{e.word}\t{e.kana}\t{e.accent}\t{e.meaning}\t{e.romaji}\t[{e.category}]")
        print(f"共 {len(r.entries)} 筆")
