(function () {
  "use strict";

  const ext = globalThis.browser || globalThis.chrome;
  const Storage = globalThis.XFocusStorage;
  const I18n = globalThis.XFocusI18n;

  if (!Storage || !I18n) {
    console.warn("[FocusDeck] Shared modules not loaded on YouTube.");
    return;
  }

  let state = {
    settings: Object.assign({}, Storage.DEFAULT_SETTINGS),
    cards: [],
    stats: Storage.createDefaultStats()
  };

  let lastUrl = location.href;
  let lastShortsUrl = "";
  let shortsViewCount = 0;
  let lastCardId = null;
  let mutationScheduled = false;
  let cachedVoices = [];

  function t(key, vars) {
    return I18n.t(state.settings?.language || "auto", key, vars);
  }

  function detectYtTheme() {
    if (document.documentElement.hasAttribute("dark")) return "dark";
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const match = bg.match(/\d+/g);
    if (match && match.length >= 3) {
      const avg = (Number(match[0]) + Number(match[1]) + Number(match[2])) / 3;
      if (avg < 80) return "dark";
    }
    return "light";
  }

  function refreshVoices() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    }
  }

  function detectSpeakLang(text) {
    const s = String(text || "");
    if (/[\u3040-\u30FF]/.test(s)) return "ja-JP";
    if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(s)) return "ko-KR";
    if (/[\u4E00-\u9FFF]/.test(s)) return "zh-CN";
    if (/[\u0400-\u04FF]/.test(s)) return "ru-RU";
    if (/[\u0600-\u06FF]/.test(s)) return "ar-SA";
    if (/[\u0E00-\u0E7F]/.test(s)) return "th-TH";
    if (/[\u0900-\u097F]/.test(s)) return "hi-IN";
    if (/[a-zA-Z]/.test(s)) return "en-US";
    return (typeof navigator !== "undefined" && navigator.language) || "en-US";
  }

  function showTtsNotice(cardEl, lang) {
    if (!cardEl) return;
    let notice = cardEl.querySelector(".xfocus-tts-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "xfocus-anki-deck xfocus-tts-notice";
      notice.style.marginTop = "6px";
      cardEl.appendChild(notice);
    }
    notice.textContent = t("ttsNoVoice", { lang });
  }

  function speakCardText(rawText, cardEl) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    let text = String(rawText || "").trim();
    if (!text) return;

    const lang = detectSpeakLang(text);
    if (lang === "ja-JP") {
      const vocabMatch = text.match(/^[^（(]+[（(]([ぁ-んァ-ンー・\s]+)[）)]$/);
      if (vocabMatch) text = vocabMatch[1].trim();
    }

    const synth = window.speechSynthesis;
    if (cachedVoices.length === 0) refreshVoices();

    const doSpeak = () => {
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = lang;
        utter.rate = 0.95;
        utter.volume = 1.0;

        if (cachedVoices.length > 0) {
          const lower = lang.toLowerCase();
          const prefix = lower.split("-")[0];
          const matched =
            cachedVoices.find((v) => (v.lang || "").toLowerCase() === lower) ||
            cachedVoices.find((v) => (v.lang || "").toLowerCase().startsWith(prefix));
          if (matched) utter.voice = matched;
          else showTtsNotice(cardEl, lang);
        }

        utter.onerror = () => showTtsNotice(cardEl, lang);
        if (synth.paused) synth.resume();
        synth.speak(utter);
      } catch (_err) {
        showTtsNotice(cardEl, lang);
      }
    };

    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(doSpeak, 60);
    } else {
      doSpeak();
    }
  }

  function hideElement(el, reason) {
    if (!el || el.classList.contains("xfocus-yt-panel") || el.classList.contains("xfocus-yt-floating")) return;
    if (el.getAttribute("data-xfocus-hidden") !== reason) {
      el.setAttribute("data-xfocus-hidden", reason);
    }
  }

  function unhideByReason(reason) {
    document.querySelectorAll(`[data-xfocus-hidden="${reason}"]`).forEach((el) => {
      el.removeAttribute("data-xfocus-hidden");
    });
  }

  function applyYtShortsRemoval() {
    if (!state.settings.ytHideShorts) {
      unhideByReason("yt-shorts");
      return;
    }

    const selectors = [
      "ytd-reel-shelf-renderer",
      "ytd-rich-shelf-renderer[is-shorts]",
      "ytm-reel-shelf-renderer",
      "ytm-shorts-lockup-view-model"
    ];
    document.querySelectorAll(selectors.join(",")).forEach((el) => hideElement(el, "yt-shorts"));

    // Nav links to Shorts
    document.querySelectorAll('a[href^="/shorts"], a[title="Shorts"]').forEach((a) => {
      const navItem =
        a.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer") || a;
      hideElement(navItem, "yt-shorts");
    });

    // Individual Shorts cards in feeds
    document.querySelectorAll('a[href*="/shorts/"]').forEach((a) => {
      const item = a.closest(
        "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer"
      );
      if (item) hideElement(item, "yt-shorts");
    });
  }

  function applyYtRecsRemoval() {
    if (!state.settings.ytHideRecommendations || !location.pathname.startsWith("/watch")) {
      unhideByReason("yt-recs");
      return;
    }

    const recSelectors = [
      "#related ytd-item-section-renderer",
      "#related ytd-compact-video-renderer",
      "#related ytd-compact-playlist-renderer",
      "#related ytd-compact-radio-renderer",
      "#related yt-lockup-view-model",
      "ytd-watch-next-secondary-results-renderer #contents > *:not(.xfocus-yt-panel)",
      "ytm-single-column-watch-next-results-renderer ytm-item-section-renderer:not(.xfocus-yt-panel)",
      "ytm-watch-next-secondary-results-renderer ytm-video-with-context-renderer"
    ];
    document.querySelectorAll(recSelectors.join(",")).forEach((el) => {
      if (el.querySelector(".xfocus-yt-panel")) return;
      hideElement(el, "yt-recs");
    });
  }

  function pickLearningCard() {
    const style = state.settings.learningStyle || "anki";
    const useExposure = style === "exposure" || (style === "mixed" && Math.random() < 0.5);
    const card = useExposure
      ? Storage.selectNextExposureCard(state.cards, state.settings, lastCardId, "youtube")
      : Storage.selectNextCard(state.cards, state.settings, lastCardId, Date.now(), "youtube");
    if (!card) return null;
    lastCardId = card.id;
    return { card, useExposure };
  }

  function buildAnkiCard(card, onNext) {
    const theme = detectYtTheme();
    const wrapper = document.createElement("div");
    wrapper.className = "xfocus-anki-card";
    wrapper.setAttribute("data-xfocus-theme", theme);

    const dir = state.settings.ankiDirection || "front-to-back";
    const isReversed = dir === "back-to-front" || (dir === "both" && Math.random() < 0.5);
    const promptRaw = isReversed ? card.back : card.front;
    const answerRaw = isReversed ? card.front : card.back;

    const header = document.createElement("div");
    header.className = "xfocus-anki-header";

    const badgeGroup = document.createElement("div");
    badgeGroup.className = "xfocus-anki-badge-group";

    const badge = document.createElement("span");
    badge.className = "xfocus-anki-badge";
    badge.textContent = isReversed ? t("ankiBadgeRev") : t("ankiBadge");

    const deck = document.createElement("span");
    deck.className = "xfocus-anki-deck";
    deck.textContent = card.deck || "Default";

    const goal = Math.max(1, Number(state.settings.dailyGoal) || 20);
    const reviews = state.stats?.reviewsToday || 0;
    const streak = state.stats?.streak || 0;
    const streakPill = document.createElement("span");
    streakPill.className = "xfocus-anki-streak";
    streakPill.textContent = `🎯 ${reviews}/${goal} · 🔥 ${streak}`;

    badgeGroup.appendChild(badge);
    badgeGroup.appendChild(deck);
    badgeGroup.appendChild(streakPill);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "xfocus-anki-skip";
    closeBtn.textContent = t("closeBtn");

    header.appendChild(badgeGroup);
    header.appendChild(closeBtn);
    wrapper.appendChild(header);

    const canStripFurigana = !isReversed && Storage.hasFurigana(promptRaw);
    let furiganaHidden = !!(state.settings.hideFurigana && canStripFurigana);

    if (promptRaw) {
      const frontEl = document.createElement("div");
      frontEl.className = "xfocus-anki-front";
      frontEl.textContent = furiganaHidden ? Storage.stripFurigana(promptRaw) : promptRaw;
      wrapper.appendChild(frontEl);

      if (canStripFurigana) {
        const furiBtn = document.createElement("button");
        furiBtn.type = "button";
        furiBtn.className = "xfocus-btn";
        furiBtn.textContent = furiganaHidden ? t("showReadingBtn") : t("hideReadingBtn");
        furiBtn.style.marginBottom = "8px";
        furiBtn.addEventListener("click", () => {
          furiganaHidden = !furiganaHidden;
          frontEl.textContent = furiganaHidden ? Storage.stripFurigana(promptRaw) : promptRaw;
          furiBtn.textContent = furiganaHidden ? t("showReadingBtn") : t("hideReadingBtn");
        });
        wrapper.appendChild(furiBtn);
      }
    }

    if (card.image) {
      const imgEl = document.createElement("img");
      imgEl.className = "xfocus-card-image";
      imgEl.src = card.image;
      imgEl.alt = card.front || "card";
      wrapper.appendChild(imgEl);
    }

    let hintEl = null;
    if (card.hint) {
      hintEl = document.createElement("div");
      hintEl.className = "xfocus-anki-hint";
      hintEl.textContent = t("hintPrefix", { hint: card.hint });
      hintEl.hidden = true;
      wrapper.appendChild(hintEl);
    }

    const backEl = document.createElement("div");
    backEl.className = "xfocus-anki-back";
    backEl.textContent =
      furiganaHidden && !isReversed ? `${promptRaw}\n→ ${answerRaw}` : answerRaw;
    backEl.hidden = true;
    wrapper.appendChild(backEl);

    const actionsEl = document.createElement("div");
    actionsEl.className = "xfocus-anki-actions";

    const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
    if (canSpeak && promptRaw) {
      const ttsBtn = document.createElement("button");
      ttsBtn.type = "button";
      ttsBtn.className = "xfocus-btn";
      ttsBtn.textContent = t("listenBtn");
      ttsBtn.addEventListener("click", () => speakCardText(promptRaw, wrapper));
      actionsEl.appendChild(ttsBtn);
    }

    if (hintEl) {
      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "xfocus-btn";
      hintBtn.textContent = t("showHintBtn");
      hintBtn.addEventListener("click", () => {
        hintEl.hidden = !hintEl.hidden;
        hintBtn.textContent = hintEl.hidden ? t("showHintBtn") : t("hideHintBtn");
      });
      actionsEl.appendChild(hintBtn);
    }

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "xfocus-btn xfocus-btn-primary";
    revealBtn.textContent = t("showAnswerBtn");
    revealBtn.addEventListener("click", () => {
      backEl.hidden = false;
      actionsEl.innerHTML = "";

      if (canSpeak && answerRaw) {
        const ttsBtn2 = document.createElement("button");
        ttsBtn2.type = "button";
        ttsBtn2.className = "xfocus-btn";
        ttsBtn2.textContent = "🔊";
        ttsBtn2.addEventListener("click", () => speakCardText(answerRaw, wrapper));
        actionsEl.appendChild(ttsBtn2);
      }

      const ratings = [
        { key: "again", label: t("rateAgain"), cls: "xfocus-btn-again" },
        { key: "hard", label: t("rateHard"), cls: "xfocus-btn-hard" },
        { key: "good", label: t("rateGood"), cls: "xfocus-btn-good" },
        { key: "easy", label: t("rateEasy"), cls: "xfocus-btn-easy" }
      ];

      ratings.forEach((r) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `xfocus-btn ${r.cls}`;
        btn.textContent = r.label;
        btn.addEventListener("click", async () => {
          const res = await Storage.reviewCard(card.id, r.key);
          if (res && res.cards) state.cards = res.cards;
          if (res && res.stats) state.stats = res.stats;
          const nextLabel = res?.updated
            ? Storage.formatIntervalLabel(res.updated.interval, r.key, state.settings.language)
            : t("savedLabel");
          actionsEl.innerHTML = "";
          const done = document.createElement("div");
          done.className = "xfocus-anki-done";
          done.textContent = t("reviewDone", {
            next: nextLabel,
            reviews: state.stats?.reviewsToday || 0,
            goal
          });
          actionsEl.appendChild(done);
          if (onNext) {
            const nextBtn = document.createElement("button");
            nextBtn.type = "button";
            nextBtn.className = "xfocus-btn";
            nextBtn.textContent = t("ytNextCardBtn");
            nextBtn.addEventListener("click", onNext);
            actionsEl.appendChild(nextBtn);
          }
        });
        actionsEl.appendChild(btn);
      });
    });

    actionsEl.appendChild(revealBtn);
    if (onNext) {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "xfocus-btn";
      nextBtn.textContent = t("ytNextCardBtn");
      nextBtn.addEventListener("click", onNext);
      actionsEl.appendChild(nextBtn);
    }
    wrapper.appendChild(actionsEl);

    return { wrapper, closeBtn };
  }

  function buildExposureCard(card, onNext) {
    const theme = detectYtTheme();
    const wrapper = document.createElement("div");
    wrapper.className = "xfocus-anki-card";
    wrapper.setAttribute("data-xfocus-theme", theme);

    const header = document.createElement("div");
    header.className = "xfocus-anki-header";

    const badgeGroup = document.createElement("div");
    badgeGroup.className = "xfocus-anki-badge-group";

    const badge = document.createElement("span");
    badge.className = "xfocus-anki-badge xfocus-exposure-badge";
    badge.textContent = t("exposureBadge");

    const deck = document.createElement("span");
    deck.className = "xfocus-anki-deck";
    deck.textContent = card.deck || "Default";

    let totalViews = card.views || 0;
    let totalSecs = card.totalSeconds || 0;
    const statsPill = document.createElement("span");
    statsPill.className = "xfocus-anki-streak";
    statsPill.textContent = t("exposureStats", { views: totalViews, secs: totalSecs });

    badgeGroup.appendChild(badge);
    badgeGroup.appendChild(deck);
    badgeGroup.appendChild(statsPill);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "xfocus-anki-skip";
    closeBtn.textContent = t("closeBtn");

    header.appendChild(badgeGroup);
    header.appendChild(closeBtn);
    wrapper.appendChild(header);

    if (card.front) {
      const frontEl = document.createElement("div");
      frontEl.className = "xfocus-anki-front";
      frontEl.textContent = card.front;
      wrapper.appendChild(frontEl);
    }
    if (card.image) {
      const imgEl = document.createElement("img");
      imgEl.className = "xfocus-card-image";
      imgEl.src = card.image;
      imgEl.alt = card.front || "card";
      wrapper.appendChild(imgEl);
    }
    if (card.back) {
      const backEl = document.createElement("div");
      backEl.className = "xfocus-anki-back";
      backEl.textContent = card.back;
      wrapper.appendChild(backEl);
    }
    if (card.hint) {
      const hintEl = document.createElement("div");
      hintEl.className = "xfocus-anki-hint";
      hintEl.textContent = t("hintPrefix", { hint: card.hint });
      wrapper.appendChild(hintEl);
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = "xfocus-anki-actions";
    const speakText = card.front || card.back || "";
    if (typeof window !== "undefined" && "speechSynthesis" in window && speakText) {
      const ttsBtn = document.createElement("button");
      ttsBtn.type = "button";
      ttsBtn.className = "xfocus-btn";
      ttsBtn.textContent = t("listenBtn");
      ttsBtn.addEventListener("click", () => speakCardText(speakText, wrapper));
      actionsEl.appendChild(ttsBtn);
    }
    if (onNext) {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "xfocus-btn";
      nextBtn.textContent = t("ytNextCardBtn");
      nextBtn.addEventListener("click", onNext);
      actionsEl.appendChild(nextBtn);
    }
    if (actionsEl.children.length > 0) wrapper.appendChild(actionsEl);

    let isVisible = false;
    let viewCounted = false;
    let unsavedSecs = 0;
    let tickTimer = null;

    const flush = async () => {
      if (!viewCounted && unsavedSecs === 0) return;
      const secs = unsavedSecs;
      const countViewNow = !viewCounted;
      unsavedSecs = 0;
      if (countViewNow) {
        viewCounted = true;
        totalViews += 1;
      }
      await Storage.recordExposure(card.id, secs, countViewNow);
      card.views = totalViews;
      card.totalSeconds = totalSecs;
      card.lastSeenAt = Date.now();
    };

    const stopTimer = () => {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.4;
        if (isVisible) {
          if (!viewCounted) {
            flush();
            statsPill.textContent = t("exposureStats", { views: totalViews, secs: totalSecs });
          }
          if (!tickTimer) {
            tickTimer = setInterval(() => {
              if (!document.body.contains(wrapper)) {
                stopTimer();
                observer.disconnect();
                return;
              }
              if (document.hidden || !isVisible) return;
              totalSecs += 1;
              unsavedSecs += 1;
              statsPill.textContent = t("exposureStats", { views: totalViews, secs: totalSecs });
              if (unsavedSecs >= 5) flush();
            }, 1000);
          }
        } else {
          stopTimer();
          if (unsavedSecs > 0) flush();
        }
      },
      { threshold: [0, 0.4] }
    );
    observer.observe(wrapper);

    const cleanup = () => {
      stopTimer();
      observer.disconnect();
      if (unsavedSecs > 0) flush();
    };

    return { wrapper, closeBtn, cleanup };
  }

  function renderWatchLearningPanel(forceReplace) {
    if (!location.pathname.startsWith("/watch") || !state.settings.ankiEnabled) return;
    const host =
      document.querySelector("#secondary-inner") ||
      document.querySelector("#related") ||
      document.querySelector("ytm-single-column-watch-next-results-renderer");
    if (!host) return;

    let panel = document.querySelector(".xfocus-yt-panel");
    if (panel && !forceReplace && panel.dataset.xfocusVideoUrl === location.href) return;

    const picked = pickLearningCard();
    if (!picked) return;

    if (panel) panel.remove();
    panel = document.createElement("div");
    panel.className = "xfocus-yt-panel";
    panel.dataset.xfocusVideoUrl = location.href;

    const renderNext = () => renderWatchLearningPanel(true);
    const built = picked.useExposure
      ? buildExposureCard(picked.card, renderNext)
      : buildAnkiCard(picked.card, renderNext);

    built.closeBtn.addEventListener("click", () => {
      if (built.cleanup) built.cleanup();
      panel.remove();
    });
    panel.appendChild(built.wrapper);
    host.prepend(panel);
  }

  function showFloatingCard(isUsageReminder, minutes) {
    document.querySelectorAll(".xfocus-yt-floating").forEach((el) => el.remove());

    const container = document.createElement("div");
    container.className = "xfocus-yt-floating";

    if (isUsageReminder) {
      const theme = detectYtTheme();
      const wrapper = document.createElement("div");
      wrapper.className = "xfocus-anki-card xfocus-usage-card";
      wrapper.setAttribute("data-xfocus-theme", theme);

      const header = document.createElement("div");
      header.className = "xfocus-anki-header";
      const badge = document.createElement("span");
      badge.className = "xfocus-anki-badge xfocus-usage-badge";
      badge.textContent = t("usageBadge");
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "xfocus-anki-skip";
      closeBtn.textContent = t("closeBtn");
      closeBtn.addEventListener("click", () => container.remove());
      header.appendChild(badge);
      header.appendChild(closeBtn);

      const title = document.createElement("div");
      title.className = "xfocus-usage-title";
      title.textContent = t("ytUsageTitle", { mins: minutes });

      const goal = Math.max(1, Number(state.settings.dailyGoal) || 20);
      const detail = document.createElement("div");
      detail.className = "xfocus-usage-detail";
      detail.textContent = t("usageDetail", {
        reviews: state.stats?.reviewsToday || 0,
        goal,
        streak: state.stats?.streak || 0
      });

      const actions = document.createElement("div");
      actions.className = "xfocus-anki-actions";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "xfocus-btn xfocus-btn-primary";
      okBtn.textContent = t("okBtn");
      okBtn.addEventListener("click", () => container.remove());
      actions.appendChild(okBtn);

      wrapper.appendChild(header);
      wrapper.appendChild(title);
      wrapper.appendChild(detail);
      wrapper.appendChild(actions);
      container.appendChild(wrapper);
    } else {
      const picked = pickLearningCard();
      if (!picked) return;
      const built = picked.useExposure
        ? buildExposureCard(picked.card, null)
        : buildAnkiCard(picked.card, null);
      built.closeBtn.addEventListener("click", () => {
        if (built.cleanup) built.cleanup();
        container.remove();
      });
      container.appendChild(built.wrapper);
    }

    document.body.appendChild(container);
  }

  function checkShortsFloatingCard() {
    if (!location.pathname.startsWith("/shorts")) {
      lastShortsUrl = "";
      return;
    }
    if (!state.settings.ankiEnabled || !state.cards || state.cards.length === 0) return;
    if (location.href === lastShortsUrl) return;

    lastShortsUrl = location.href;
    shortsViewCount += 1;
    const interval = Math.max(1, Number(state.settings.ytShortsCardInterval) || 3);
    if (shortsViewCount % interval === 0) {
      showFloatingCard(false, 0);
    }
  }

  function runPass() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
    }
    applyYtShortsRemoval();
    applyYtRecsRemoval();
    renderWatchLearningPanel(false);
    checkShortsFloatingCard();
  }

  function schedulePass() {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(() => {
      mutationScheduled = false;
      runPass();
    });
  }

  let usageTimerId = null;
  let currentCheckSec = 3;

  async function tickUsageTimer() {
    if (document.hidden) return;
    const sec = Math.max(1, Number(state.settings.usageCheckIntervalSec) || 3);
    const nextStats = await Storage.addYoutubeUsageSeconds(sec);
    state.stats = nextStats;

    if (!state.settings.usageReminderEnabled) return;
    const intervalMin = Math.max(1, Number(state.settings.usageReminderIntervalMin) || 20);
    const usedMin = Math.floor((nextStats.youtubeSecondsToday || 0) / 60);
    const milestone = Math.floor(usedMin / intervalMin) * intervalMin;

    if (milestone >= intervalMin && milestone > (nextStats.ytLastReminderMinute || 0)) {
      state.stats = await Storage.markYoutubeReminderShown(milestone);
      showFloatingCard(true, milestone);
    }
  }

  function startUsageTimer() {
    const sec = Math.max(1, Number(state.settings.usageCheckIntervalSec) || 3);
    if (usageTimerId && sec === currentCheckSec) return;
    if (usageTimerId) clearInterval(usageTimerId);
    currentCheckSec = sec;
    usageTimerId = setInterval(tickUsageTimer, sec * 1000);
  }

  async function init() {
    state = await Storage.getState();
    refreshVoices();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    }
    runPass();

    startUsageTimer();

    const observer = new MutationObserver(() => schedulePass());
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("yt-navigate-finish", schedulePass);
    window.addEventListener("popstate", schedulePass);

    if (ext && ext.storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener(async (_changes, area) => {
        if (area !== "local") return;
        state = await Storage.getState();
        startUsageTimer();
        applyYtShortsRemoval();
        applyYtRecsRemoval();
      });
    }
  }

  init();
})();
