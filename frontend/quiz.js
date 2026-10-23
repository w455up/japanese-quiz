(() => {
  "use strict";

  let allQuestions = [];
  let allUnits = [];
  const filterTabOpenUnits = new Set();

  // 「選擇單元」的勾選狀態是唯一真相來源：勾選框、篩選單字分頁、開始測驗
  // 都從這裡讀取，不再各自從 DOM 反查勾選框，避免三處狀態兜不起來。
  const selectedUnitUrls = new Set();
  const knownUnitUrls = new Set();

  let quizPool = [];
  let quizIndex = 0;
  let quizScore = { correct: 0, wrong: 0 };
  let wrongAnswers = [];
  let currentAnswered = false;

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll(".tab-panel").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((el) => el.classList.remove("active"));
    const panel = document.getElementById("tab-" + name);
    if (panel) panel.classList.add("active");
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn) btn.classList.add("active");
    // 開始測驗按鈕平時固定在左下角，測驗中／看結果時才隱藏
    document.getElementById("startFloating").style.display =
      name === "quiz" || name === "result" ? "none" : "flex";
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // ---------- data source ----------
  // 用 RunMe.bat 在電腦上啟動時有後端：可以抓網址，篩選結果寫回題庫檔。
  // 放在 GitHub Pages 這類靜態網站時沒有後端：改讀同目錄的 questions.json，
  // 篩選結果只存在這台裝置的瀏覽器（localStorage）。
  const HIDDEN_KEY = "jpquiz.hiddenOverrides";
  let hasServer = false;

  async function detectServer() {
    try {
      const res = await fetch("/api/health");
      return res.ok && (await res.json()).status === "ok";
    } catch {
      return false;
    }
  }

  function readHiddenOverrides() {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || {};
    } catch {
      return {};
    }
  }

  async function loadQuestions() {
    if (hasServer) {
      return (await fetch("/api/questions").then((r) => r.json())).questions;
    }
    const res = await fetch("questions.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("找不到 questions.json");
    const overrides = readHiddenOverrides();
    return Object.values(await res.json()).map((q) => ({
      ...q,
      hidden: q.id in overrides ? overrides[q.id] : Boolean(q.hidden),
    }));
  }

  async function saveHidden(ids, hidden) {
    if (hasServer) {
      const res = await fetch("/api/questions/hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, hidden }),
      });
      if (!res.ok) throw new Error("伺服器回應失敗");
      return;
    }
    const overrides = readHiddenOverrides();
    ids.forEach((id) => (overrides[id] = hidden));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(overrides));
  }

  function buildUnits(questions) {
    const units = new Map();
    questions.forEach((q) => {
      if (!units.has(q.unit_url)) {
        units.set(q.unit_url, { unit_url: q.unit_url, unit_title: q.unit_title, level: q.level, count: 0 });
      }
      units.get(q.unit_url).count++;
    });
    return [...units.values()].sort(
      (a, b) => a.level.localeCompare(b.level) || a.unit_url.localeCompare(b.unit_url)
    );
  }

  // ---------- data loading ----------
  async function refreshBank() {
    try {
      allQuestions = await loadQuestions();
      allUnits = buildUnits(allQuestions);
      // 新出現的單元（第一次抓到、或第一次載入頁面）預設打勾
      allUnits.forEach((u) => {
        if (!knownUnitUrls.has(u.unit_url)) {
          knownUnitUrls.add(u.unit_url);
          selectedUnitUrls.add(u.unit_url);
        }
      });
      renderUnitList();
      renderUnitCheckboxes();
      renderFilterTab();
    } catch (err) {
      console.error("讀取題庫失敗", err);
      alert("讀取題庫失敗，請重新整理頁面。\n" + err);
    }
  }

  function unitVisibleCount(unitUrl) {
    return allQuestions.filter((q) => q.unit_url === unitUrl && !q.hidden).length;
  }

  function renderUnitList() {
    const el = document.getElementById("unitList");
    if (allUnits.length === 0) {
      el.innerHTML = '<p class="hint">目前題庫是空的，請在上面貼網址抓取單字。</p>';
      return;
    }
    el.innerHTML = allUnits
      .map((u) => {
        const visible = unitVisibleCount(u.unit_url);
        const countText = visible === u.count ? `${u.count} 字` : `${visible}/${u.count} 字（已隱藏 ${u.count - visible}）`;
        return `<div class="unit-row"><span>[${u.level.toUpperCase()}] ${escapeHtml(u.unit_title)}</span><span>${countText}</span></div>`;
      })
      .join("");
  }

  function renderUnitCheckboxes() {
    const el = document.getElementById("unitCheckboxes");
    if (allUnits.length === 0) {
      el.innerHTML = '<p class="hint">請先到「題庫管理」加入單字。</p>';
      return;
    }
    el.innerHTML = allUnits
      .map((u) => {
        const visible = unitVisibleCount(u.unit_url);
        const countText = visible === u.count ? `${u.count} 字` : `${visible}/${u.count} 字`;
        const checked = selectedUnitUrls.has(u.unit_url);
        return `<label>
          <input type="checkbox" class="unit-cb" value="${escapeHtml(u.unit_url)}" ${checked ? "checked" : ""} />
          [${u.level.toUpperCase()}] ${escapeHtml(u.unit_title)}（${countText}）
        </label>`;
      })
      .join("");
  }

  // 勾選框是動態產生的，監聽事件加在常駐的容器上（事件代理），
  // 這樣每次 renderUnitCheckboxes() 重繪內容也不必重新綁定。
  document.getElementById("unitCheckboxes").addEventListener("change", (e) => {
    if (!e.target.classList.contains("unit-cb")) return;
    if (e.target.checked) selectedUnitUrls.add(e.target.value);
    else selectedUnitUrls.delete(e.target.value);
    renderFilterTab();
  });

  // ---------- filter words (scoped to units selected in 開始測驗) ----------
  function renderFilterTab() {
    const el = document.getElementById("filterUnitList");
    if (allUnits.length === 0) {
      el.innerHTML = '<p class="hint">請先到「題庫管理」加入單字。</p>';
      return;
    }
    const units = allUnits.filter((u) => selectedUnitUrls.has(u.unit_url));
    if (units.length === 0) {
      el.innerHTML = '<p class="hint">請先到「開始測驗」的「選擇單元」勾選要測驗的單元。</p>';
      return;
    }
    el.innerHTML = units
      .map((u) => {
        const words = allQuestions.filter((q) => q.unit_url === u.unit_url);
        const visible = words.filter((w) => !w.hidden).length;
        const isOpen = filterTabOpenUnits.has(u.unit_url);
        return `<details class="filter-unit" data-unit="${escapeHtml(u.unit_url)}" ${isOpen ? "open" : ""}>
          <summary>
            <span>[${u.level.toUpperCase()}] ${escapeHtml(u.unit_title)}</span>
            <span class="filter-unit-count">${visible}/${words.length} 出題中</span>
          </summary>
          <div class="filter-unit-actions">
            <button type="button" class="link-btn filter-all-btn">全部取消</button>
            <button type="button" class="link-btn filter-none-btn">全部勾選</button>
          </div>
          <div class="filter-word-list">
            ${words
              .map(
                (w) => `<label class="filter-word-row${w.hidden ? " is-hidden" : ""}">
                  <input type="checkbox" class="filter-word-cb" data-id="${w.id}" ${w.hidden ? "" : "checked"} />
                  <span class="filter-word-text">${escapeHtml(w.word)}（${escapeHtml(w.kana)}）― ${escapeHtml(w.meaning)}</span>
                </label>`
              )
              .join("")}
          </div>
        </details>`;
      })
      .join("");

    el.querySelectorAll(".filter-unit").forEach((det) => {
      det.addEventListener("toggle", () => {
        if (det.open) filterTabOpenUnits.add(det.dataset.unit);
        else filterTabOpenUnits.delete(det.dataset.unit);
      });
    });
    el.querySelectorAll(".filter-word-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        setWordHidden([cb.dataset.id], !cb.checked, cb);
      });
    });
    el.querySelectorAll(".filter-all-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const det = btn.closest(".filter-unit");
        const ids = Array.from(det.querySelectorAll(".filter-word-cb")).map((cb) => cb.dataset.id);
        setWordHidden(ids, true);
      });
    });
    el.querySelectorAll(".filter-none-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const det = btn.closest(".filter-unit");
        const ids = Array.from(det.querySelectorAll(".filter-word-cb")).map((cb) => cb.dataset.id);
        setWordHidden(ids, false);
      });
    });
  }

  async function setWordHidden(ids, hidden, checkboxEl) {
    try {
      await saveHidden(ids, hidden);
      ids.forEach((id) => {
        const q = allQuestions.find((x) => x.id === id);
        if (q) q.hidden = hidden;
      });
      renderUnitList();
      renderUnitCheckboxes();
      renderFilterTab();
    } catch (err) {
      alert("更新篩選狀態失敗：" + err);
      if (checkboxEl) checkboxEl.checked = !hidden;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- scraping ----------
  document.getElementById("scrapeBtn").addEventListener("click", async () => {
    const raw = document.getElementById("urlInput").value;
    const urls = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    const resultBox = document.getElementById("scrapeResult");
    if (urls.length === 0) {
      resultBox.textContent = "請至少貼一個網址。";
      return;
    }
    const btn = document.getElementById("scrapeBtn");
    btn.disabled = true;
    resultBox.textContent = "抓取中，請稍候...";
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      let msg = `新增 ${data.added} 筆，更新 ${data.updated} 筆，題庫共 ${data.total} 筆。`;
      if (data.failed && data.failed.length) {
        msg += "\n以下網址抓取失敗：\n" + data.failed.map((f) => `${f.url}（${f.error}）`).join("\n");
      }
      if (data.kana_warnings && data.kana_warnings.length) {
        msg += "\n\n⚠ 假名欄位提醒：\n" + data.kana_warnings.join("\n");
      }
      resultBox.textContent = msg;
      await refreshBank();
    } catch (err) {
      resultBox.textContent = "抓取失敗：" + err;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("selectAllBtn").addEventListener("click", () => {
    allUnits.forEach((u) => selectedUnitUrls.add(u.unit_url));
    renderUnitCheckboxes();
    renderFilterTab();
  });
  document.getElementById("selectNoneBtn").addEventListener("click", () => {
    selectedUnitUrls.clear();
    renderUnitCheckboxes();
    renderFilterTab();
  });

  // ---------- quiz setup ----------
  document.getElementById("startQuizBtn").addEventListener("click", () => {
    const errorEl = document.getElementById("startFloatingError");
    if (selectedUnitUrls.size === 0) {
      errorEl.textContent = "請至少選擇一個單元。";
      return;
    }
    const pool = allQuestions.filter((q) => selectedUnitUrls.has(q.unit_url) && !q.hidden);
    if (pool.length === 0) {
      errorEl.textContent = "選擇的單元裡沒有可用的單字（可能都被隱藏了）。";
      return;
    }
    errorEl.textContent = "";

    const mode = document.querySelector('input[name="mode"]:checked').value;
    let count = parseInt(document.getElementById("questionCount").value, 10) || pool.length;
    count = Math.min(count, pool.length);

    quizPool = shuffle(pool.slice()).slice(0, count).map((q) => ({
      ...q,
      _mode: mode === "mixed" ? (Math.random() < 0.5 ? "cn2kana" : "jp2kana") : mode,
    }));
    quizIndex = 0;
    quizScore = { correct: 0, wrong: 0 };
    wrongAnswers = [];

    showTab("quiz");
    renderQuestion();
  });

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- quiz play ----------
  function currentQuestion() {
    return quizPool[quizIndex];
  }

  function renderQuestion() {
    currentAnswered = false;
    const q = currentQuestion();
    document.getElementById("quizProgress").textContent = `${quizIndex + 1} / ${quizPool.length}`;
    document.getElementById("quizScore").textContent = `對 ${quizScore.correct} ‧ 錯 ${quizScore.wrong}`;

    const promptLabel = document.getElementById("promptLabel");
    const promptText = document.getElementById("promptText");
    if (q._mode === "cn2kana") {
      promptLabel.textContent = "中文 → 請輸入日文假名";
      promptText.textContent = q.meaning;
    } else {
      promptLabel.textContent = "日文 → 請輸入假名讀音";
      promptText.textContent = q.word;
    }

    const input = document.getElementById("answerInput");
    input.value = "";
    input.disabled = false;
    input.focus();

    document.getElementById("feedback").className = "feedback";
    document.getElementById("feedback").innerHTML = "";
    document.getElementById("submitAnswerBtn").style.display = "";
    document.getElementById("nextQuestionBtn").style.display = "none";
  }

  function normalize(s) {
    return (s || "").trim().replace(/\s+/g, "");
  }

  function submitAnswer() {
    if (currentAnswered) return;
    const q = currentQuestion();
    const input = document.getElementById("answerInput");
    const userAnswer = normalize(input.value);
    const correct = normalize(q.kana);
    const isCorrect = userAnswer.length > 0 && userAnswer === correct;

    currentAnswered = true;
    input.disabled = true;

    if (isCorrect) {
      quizScore.correct++;
    } else {
      quizScore.wrong++;
      wrongAnswers.push(q);
    }
    document.getElementById("quizScore").textContent = `對 ${quizScore.correct} ‧ 錯 ${quizScore.wrong}`;

    const feedback = document.getElementById("feedback");
    feedback.className = "feedback " + (isCorrect ? "correct" : "wrong");
    feedback.innerHTML = `
      <div class="verdict">${isCorrect ? "✅ 答對了！" : "❌ 答錯了"}</div>
      <div class="detail-box">
        <div class="detail-row"><b>日文</b>${escapeHtml(q.word)}</div>
        <div class="detail-row"><b>假名</b>${escapeHtml(q.kana)}</div>
        <div class="detail-row"><b>重音</b>${escapeHtml(q.accent || "-")}</div>
        <div class="detail-row"><b>中文</b>${escapeHtml(q.meaning)}</div>
        <button type="button" class="speak-btn">🔊 播放發音</button>
      </div>
    `;
    feedback.querySelector(".speak-btn").addEventListener("click", () => speak(q.kana));

    document.getElementById("submitAnswerBtn").style.display = "none";
    document.getElementById("nextQuestionBtn").style.display = "";
    document.getElementById("nextQuestionBtn").focus();

    // 答對/答錯都自動唸一次發音
    speak(q.kana);
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    const jaVoice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("ja"));
    if (jaVoice) utter.voice = jaVoice;
    window.speechSynthesis.speak(utter);
  }

  function nextQuestion() {
    if (quizIndex + 1 >= quizPool.length) {
      showResult();
    } else {
      quizIndex++;
      renderQuestion();
    }
  }

  document.getElementById("submitAnswerBtn").addEventListener("click", submitAnswer);
  document.getElementById("nextQuestionBtn").addEventListener("click", nextQuestion);
  document.getElementById("answerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!currentAnswered) submitAnswer();
      else nextQuestion();
    }
  });
  document.getElementById("quitQuizBtn").addEventListener("click", () => {
    window.speechSynthesis && window.speechSynthesis.cancel();
    showTab("setup");
  });

  // ---------- result ----------
  function showResult() {
    showTab("result");
    const total = quizScore.correct + quizScore.wrong;
    const rate = total ? Math.round((quizScore.correct / total) * 100) : 0;
    document.getElementById("resultSummary").textContent =
      `共 ${total} 題，答對 ${quizScore.correct} 題，答錯 ${quizScore.wrong} 題（正確率 ${rate}%）`;

    const wrongList = document.getElementById("wrongList");
    if (wrongAnswers.length === 0) {
      wrongList.innerHTML = '<p class="hint">全部答對，太強了！</p>';
    } else {
      wrongList.innerHTML = wrongAnswers
        .map(
          (q) => `<div class="wrong-row">${escapeHtml(q.word)}（${escapeHtml(q.kana)}）― ${escapeHtml(q.meaning)}</div>`
        )
        .join("");
    }
  }

  document.getElementById("restartBtn").addEventListener("click", () => {
    showTab("setup");
  });

  // ---------- init ----------
  if ("speechSynthesis" in window) {
    // 部分瀏覽器需要觸發一次才會載入 voice 清單
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  (async () => {
    hasServer = await detectServer();
    if (!hasServer) {
      // 靜態網站（手機）只能測驗，抓網址要回電腦用 RunMe.bat
      document.getElementById("scrapeSection").style.display = "none";
      document.getElementById("staticNotice").style.display = "";
      showTab("setup");
    }
    await refreshBank();
  })();
})();
