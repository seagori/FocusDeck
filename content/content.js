(function () {
  "use strict";

  const ext = globalThis.browser || globalThis.chrome;
  const Storage = globalThis.XFocusStorage;
  const I18n = globalThis.XFocusI18n;

  if (!Storage || !I18n) {
    console.warn("[FocusDeck] Shared modules not loaded.");
    return;
  }

  function t(key, vars) {
    return I18n.t(state.settings?.language || "auto", key, vars);
  }

  const DISCOVER_TAB_RE = /^(for\s*you|추천|discover|para\s*ti|pour\s*vous|おすすめ)$/i;
  const FOLLOWING_TAB_RE = /^(following|팔로우\s*중|siguiendo|abonnements|フォロー中)$/i;
  const INLINE_DISCOVER_RE = /^(discover(\s*more)?|더\s*찾아보기|more\s*posts|추천\s*게시물|related\s*posts|관련\s*게시물)$/i;

  let state = {
    settings: Object.assign({}, Storage.DEFAULT_SETTINGS),
    cards: [],
    stats: Storage.createDefaultStats()
  };

  let lastUrl = location.href;
  let lastAutoSwitchAt = 0;
  let sessionTweetCount = 0;
  let lastInjectedCardId = null;
  let mutationScheduled = false;
  let pendingUsageReminderMin = 0;

  function detectXTheme() {
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const match = bg.match(/\d+/g);
    if (!match || match.length < 3) return "light";
    const r = Number(match[0]);
    const g = Number(match[1]);
    const b = Number(match[2]);
    if (r < 12 && g < 12 && b < 12) return "dark";
    if (r < 45 && g < 55 && b < 70) return "dim";
    return "light";
  }

  function isHomePath() {
    return /^\/(home)?\/?$/i.test(location.pathname);
  }

  function isStatusDetailPath() {
    return /\/status\/\d+/i.test(location.pathname);
  }

  function hideElement(el, reason) {
    if (!el) return;
    if (el.getAttribute("data-xfocus-hidden") !== reason) {
      el.setAttribute("data-xfocus-hidden", reason);
    }
  }

  function unhideByReason(reason) {
    document.querySelectorAll(`[data-xfocus-hidden="${reason}"]`).forEach((el) => {
      el.removeAttribute("data-xfocus-hidden");
    });
  }

  function applyDiscoverRemoval() {
    const { removeDiscoverTab, hideExploreNav, hideDiscoverSections } = state.settings;

    if (removeDiscoverTab && isHomePath()) {
      const tablists = document.querySelectorAll('[role="tablist"]');
      tablists.forEach((tablist) => {
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        if (tabs.length < 2) return;

        let discoverTab = null;
        let followingTab = null;

        for (const tab of tabs) {
          const text = (tab.textContent || "").replace(/\s+/g, " ").trim();
          if (!discoverTab && DISCOVER_TAB_RE.test(text)) {
            discoverTab = tab;
          } else if (!followingTab && FOLLOWING_TAB_RE.test(text)) {
            followingTab = tab;
          }
        }

        if (discoverTab && followingTab) {
          const isSelected = discoverTab.getAttribute("aria-selected") === "true";
          if (isSelected && Date.now() - lastAutoSwitchAt > 1200) {
            lastAutoSwitchAt = Date.now();
            followingTab.click();
          }
          let wrapper = discoverTab.closest('[role="presentation"]');
          if (!wrapper) {
            wrapper = discoverTab;
            while (wrapper.parentElement && wrapper.parentElement !== tablist) {
              wrapper = wrapper.parentElement;
            }
          }
          hideElement(wrapper, "discover-tab");
        }
      });
    } else {
      unhideByReason("discover-tab");
    }

    if (hideExploreNav) {
      document
        .querySelectorAll('[data-testid="AppTabBar_Explore_Link"], a[href="/explore"]')
        .forEach((el) => hideElement(el, "explore-nav"));
    } else {
      unhideByReason("explore-nav");
    }

    if (hideDiscoverSections) {
      const sidebarSelectors = [
        '[aria-label*="Trending"]',
        '[aria-label*="실시간 트렌드"]',
        '[aria-label*="Who to follow"]',
        '[aria-label*="팔로우 추천"]',
        '[data-testid="GrokDrawer"]'
      ];
      document.querySelectorAll(sidebarSelectors.join(",")).forEach((el) => {
        const container = el.closest('[data-testid="sidebarColumn"] > div > div > div') || el;
        hideElement(container, "discover-section");
      });

      const containers = new Set();
      document.querySelectorAll('main [data-testid="cellInnerDiv"]').forEach((cell) => {
        if (cell.parentElement) containers.add(cell.parentElement);
      });

      containers.forEach((container) => {
        const children = Array.from(container.children);
        let inDiscoverBlock = false;
        for (const child of children) {
          if (child.getAttribute("data-testid") !== "cellInnerDiv") continue;
          if (inDiscoverBlock) {
            hideElement(child, "discover-section");
            continue;
          }
          if (!child.querySelector('article[data-testid="tweet"]')) {
            const heading = child.querySelector("h2, [role='heading'], span");
            if (heading && INLINE_DISCOVER_RE.test((heading.textContent || "").replace(/\s+/g, " ").trim())) {
              inDiscoverBlock = true;
              hideElement(child, "discover-section");
            }
          }
        }
      });
    } else {
      unhideByReason("discover-section");
    }
  }

  function applyKeywordMute(forceRescan) {
    const rawKeywords = Array.isArray(state.settings.mutedKeywords) ? state.settings.mutedKeywords : [];
    const keywords = rawKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean);

    if (keywords.length === 0) {
      unhideByReason("muted-keyword");
      if (forceRescan) {
        document.querySelectorAll('main [data-testid="cellInnerDiv"]').forEach((c) => {
          delete c.dataset.xfocusMuteChecked;
        });
      }
      return;
    }

    document.querySelectorAll('main [data-testid="cellInnerDiv"]').forEach((cell) => {
      if (!forceRescan && cell.dataset.xfocusMuteChecked === "1") return;
      const article = cell.querySelector('article[data-testid="tweet"]');
      if (!article) return;
      cell.dataset.xfocusMuteChecked = "1";
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const hay = ((textEl ? textEl.innerText : article.innerText) || "").toLowerCase();
      const matched = keywords.some((kw) => hay.includes(kw));
      if (matched) {
        hideElement(cell, "muted-keyword");
      } else if (cell.getAttribute("data-xfocus-hidden") === "muted-keyword") {
        cell.removeAttribute("data-xfocus-hidden");
      }
    });
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

  let cachedVoices = [];
  function refreshVoices() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    }
  }

  function showTtsNotice(cardEl, lang) {
    if (!cardEl) return;
    let notice = cardEl.querySelector(".xfocus-tts-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "xfocus-anki-deck";
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
      if (vocabMatch) {
        text = vocabMatch[1].trim();
      }
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
          if (matched) {
            utter.voice = matched;
          } else {
            showTtsNotice(cardEl, lang);
          }
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

  function createUsageReminderElement(minutes) {
    const theme = detectXTheme();
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
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      wrapper.remove();
    });

    header.appendChild(badge);
    header.appendChild(closeBtn);

    const title = document.createElement("div");
    title.className = "xfocus-usage-title";
    title.textContent = t("usageTitle", { mins: minutes });

    const goal = Math.max(1, Number(state.settings.dailyGoal) || 20);
    const reviews = state.stats?.reviewsToday || 0;
    const streak = state.stats?.streak || 0;
    const detail = document.createElement("div");
    detail.className = "xfocus-usage-detail";
    detail.textContent = t("usageDetail", { reviews, goal, streak });

    const actions = document.createElement("div");
    actions.className = "xfocus-anki-actions";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "xfocus-btn xfocus-btn-primary";
    okBtn.textContent = t("okBtn");
    okBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      wrapper.remove();
    });
    actions.appendChild(okBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(title);
    wrapper.appendChild(detail);
    wrapper.appendChild(actions);
    wrapper.addEventListener("click", (e) => e.stopPropagation());
    return wrapper;
  }

  function createAnkiCardElement(card) {
    const theme = detectXTheme();
    const wrapper = document.createElement("div");
    wrapper.className = "xfocus-anki-card";
    wrapper.setAttribute("data-xfocus-theme", theme);
    wrapper.setAttribute("data-xfocus-card-id", card.id);

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

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "xfocus-anki-skip";
    skipBtn.textContent = t("skipBtn");
    skipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      wrapper.remove();
    });

    header.appendChild(badgeGroup);
    header.appendChild(skipBtn);

    const canStripFurigana = !isReversed && Storage.hasFurigana(promptRaw);
    let furiganaHidden = !!(state.settings.hideFurigana && canStripFurigana);

    const frontEl = document.createElement("div");
    frontEl.className = "xfocus-anki-front";
    frontEl.textContent = furiganaHidden ? Storage.stripFurigana(promptRaw) : promptRaw;

    wrapper.appendChild(header);
    if (frontEl.textContent) {
      wrapper.appendChild(frontEl);
    }

    if (card.image) {
      const imgEl = document.createElement("img");
      imgEl.className = "xfocus-card-image";
      imgEl.src = card.image;
      imgEl.alt = card.front || card.deck || "card image";
      imgEl.loading = "lazy";
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
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakCardText(promptRaw, wrapper);
      });
      actionsEl.appendChild(ttsBtn);
    }

    if (canStripFurigana) {
      const furiBtn = document.createElement("button");
      furiBtn.type = "button";
      furiBtn.className = "xfocus-btn";
      furiBtn.textContent = furiganaHidden ? t("showReadingBtn") : t("hideReadingBtn");
      furiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        furiganaHidden = !furiganaHidden;
        frontEl.textContent = furiganaHidden ? Storage.stripFurigana(promptRaw) : promptRaw;
        furiBtn.textContent = furiganaHidden ? t("showReadingBtn") : t("hideReadingBtn");
      });
      actionsEl.appendChild(furiBtn);
    }

    if (hintEl) {
      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "xfocus-btn";
      hintBtn.textContent = t("showHintBtn");
      hintBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        hintEl.hidden = !hintEl.hidden;
        hintBtn.textContent = hintEl.hidden ? t("showHintBtn") : t("hideHintBtn");
      });
      actionsEl.appendChild(hintBtn);
    }

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "xfocus-btn xfocus-btn-primary";
    revealBtn.textContent = t("showAnswerBtn");

    revealBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      backEl.hidden = false;
      actionsEl.innerHTML = "";

      if (canSpeak && answerRaw) {
        const ttsBtn2 = document.createElement("button");
        ttsBtn2.type = "button";
        ttsBtn2.className = "xfocus-btn";
        ttsBtn2.textContent = "🔊";
        ttsBtn2.addEventListener("click", (ev) => {
          ev.stopPropagation();
          speakCardText(answerRaw, wrapper);
        });
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
        btn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
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
        });
        actionsEl.appendChild(btn);
      });
    });

    actionsEl.appendChild(revealBtn);
    wrapper.appendChild(actionsEl);
    wrapper.addEventListener("click", (e) => e.stopPropagation());

    return wrapper;
  }

  function createExposureCardElement(card) {
    const theme = detectXTheme();
    const wrapper = document.createElement("div");
    wrapper.className = "xfocus-anki-card";
    wrapper.setAttribute("data-xfocus-theme", theme);
    wrapper.setAttribute("data-xfocus-card-id", card.id);

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
      imgEl.alt = card.front || card.deck || "exposure image";
      imgEl.loading = "lazy";
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
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakCardText(speakText, wrapper);
      });
      actionsEl.appendChild(ttsBtn);
    }
    if (actionsEl.children.length > 0) {
      wrapper.appendChild(actionsEl);
    }

    let isVisible = false;
    let viewCounted = false;
    let unsavedSecs = 0;
    let tickTimer = null;

    const flushExposure = async () => {
      if (!viewCounted && unsavedSecs === 0) return;
      const secsToSave = unsavedSecs;
      const countViewNow = !viewCounted;
      unsavedSecs = 0;
      if (countViewNow) {
        viewCounted = true;
        totalViews += 1;
      }
      await Storage.recordExposure(card.id, secsToSave, countViewNow);
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
            flushExposure();
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
              if (unsavedSecs >= 5) {
                flushExposure();
              }
            }, 1000);
          }
        } else {
          stopTimer();
          if (unsavedSecs > 0) flushExposure();
        }
      },
      { threshold: [0, 0.4] }
    );

    observer.observe(wrapper);

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stopTimer();
      observer.disconnect();
      if (unsavedSecs > 0) flushExposure();
      wrapper.remove();
    });

    wrapper.addEventListener("click", (e) => e.stopPropagation());
    return wrapper;
  }

  function injectAnkiCards() {
    if (isStatusDetailPath()) return;

    const interval = Math.max(1, Number(state.settings.ankiInterval) || 5);
    const cells = document.querySelectorAll('main [data-testid="cellInnerDiv"]');

    cells.forEach((cell) => {
      if (cell.getAttribute("data-xfocus-hidden") === "muted-keyword") return;
      if (pendingUsageReminderMin > 0 && !cell.querySelector(".xfocus-usage-card")) {
        const article = cell.querySelector('article[data-testid="tweet"]');
        if (article) {
          const mins = pendingUsageReminderMin;
          pendingUsageReminderMin = 0;
          cell.appendChild(createUsageReminderElement(mins));
          return;
        }
      }

      if (!state.settings.ankiEnabled) return;
      if (!state.cards || state.cards.length === 0) return;
      if (cell.dataset.xfocusSeen) return;
      const article = cell.querySelector('article[data-testid="tweet"]');
      if (!article) return;

      cell.dataset.xfocusSeen = "1";
      sessionTweetCount += 1;

      if (sessionTweetCount % interval === 0) {
        const style = state.settings.learningStyle || "anki";
        const useExposure = style === "exposure" || (style === "mixed" && Math.random() < 0.5);
        const card = useExposure
          ? Storage.selectNextExposureCard(state.cards, state.settings, lastInjectedCardId, "x")
          : Storage.selectNextCard(state.cards, state.settings, lastInjectedCardId, Date.now(), "x");
        if (!card) return;
        lastInjectedCardId = card.id;
        const cardEl = useExposure ? createExposureCardElement(card) : createAnkiCardElement(card);
        cell.appendChild(cardEl);
      }
    });
  }

  function runPass() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sessionTweetCount = 0;
    }
    applyDiscoverRemoval();
    applyKeywordMute();
    injectAnkiCards();
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
    const nextStats = await Storage.addTwitterUsageSeconds(sec);
    state.stats = nextStats;

    if (!state.settings.usageReminderEnabled) return;
    const intervalMin = Math.max(1, Number(state.settings.usageReminderIntervalMin) || 20);
    const usedMin = Math.floor((nextStats.twitterSecondsToday || 0) / 60);
    const milestone = Math.floor(usedMin / intervalMin) * intervalMin;

    if (milestone >= intervalMin && milestone > (nextStats.lastReminderMinute || 0)) {
      pendingUsageReminderMin = milestone;
      state.stats = await Storage.markUsageReminderShown(milestone);
      injectAnkiCards();
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

    const observer = new MutationObserver(() => {
      schedulePass();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("popstate", schedulePass);

    if (ext && ext.storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local") return;
        state = await Storage.getState();
        startUsageTimer();
        applyDiscoverRemoval();
        if (changes.settings) {
          applyKeywordMute(true);
        }
      });
    }
  }

  init();
})();
