(function () {
  "use strict";

  const ext = globalThis.browser || globalThis.chrome;
  const Storage = globalThis.XFocusStorage;
  const I18n = globalThis.XFocusI18n;

  if (!Storage || !I18n) {
    console.warn("[FocusDeck] Shared modules not loaded on Instagram.");
    return;
  }

  const SUGGESTED_RE = /^(suggested\s+for\s+you|suggested\s+posts|회원님을\s*위한\s*추천|추천\s*게시물|discover\s*people|사람\s*찾아보기|おすすめ|おすすめの投稿)$/i;

  let state = {
    settings: Object.assign({}, Storage.DEFAULT_SETTINGS),
    cards: [],
    stats: Storage.createDefaultStats()
  };

  let lastUrl = location.href;
  let lastCardId = null;
  let mutationScheduled = false;
  let usageTimerId = null;
  let currentCheckSec = 3;
  let overlayElapsedSec = 0;
  let cachedVoices = [];
  let exploreShownForUrl = "";
  let activeOverlayCleanup = null;

  function t(key, vars) {
    return I18n.t(state.settings?.language || "auto", key, vars);
  }

  function detectIgTheme() {
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
    if (!el || el.classList.contains("xfocus-anki-card") || el.classList.contains("xfocus-yt-floating")) return;
    if (el.getAttribute("data-xfocus-hidden") !== reason) {
      el.setAttribute("data-xfocus-hidden", reason);
    }
  }

  function unhideByReason(reason) {
    document.querySelectorAll(`[data-xfocus-hidden="${reason}"]`).forEach((el) => {
      el.removeAttribute("data-xfocus-hidden");
    });
  }

  function findNavContainer(anchor) {
    // Walk up from <a> inside nav without relying on obfuscated class names
    const li = anchor.closest("li");
    if (li) return li;
    let cur = anchor;
    while (cur && cur.parentElement && cur.parentElement.tagName !== "NAV") {
      if (cur.parentElement.children.length > 2) return cur;
      cur = cur.parentElement;
    }
    return anchor;
  }

  function applyIgExploreRemoval() {
    if (!state.settings.igHideExplore) {
      unhideByReason("ig-explore");
      return;
    }

    document.querySelectorAll('a[href="/explore/"], a[href="/explore"]').forEach((a) => {
      hideElement(findNavContainer(a), "ig-explore");
    });
  }

  function applyIgHomeSuggestedRemoval() {
    if (!state.settings.igHideHomeSuggested) {
      unhideByReason("ig-suggested");
      return;
    }

    // Suggested posts inside feed articles (check header area only to avoid caption false positives)
    document.querySelectorAll("main article").forEach((article) => {
      if (article.getAttribute("data-xfocus-hidden")) return;
      const artTop = article.getBoundingClientRect().top;
      const spans = article.querySelectorAll("span, div");
      for (let i = 0; i < Math.min(spans.length, 25); i++) {
        const el = spans[i];
        const relTop = el.getBoundingClientRect().top - artTop;
        if (relTop > 140) break;
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length > 0 && txt.length < 40 && SUGGESTED_RE.test(txt)) {
          hideElement(article, "ig-suggested");
          return;
        }
      }
    });

    // Suggested sidebar / people carousel
    document.querySelectorAll('a[href*="/explore/people"]').forEach((a) => {
      const section = a.closest("aside") || a.closest("section") || a.parentElement?.parentElement;
      if (section && section.tagName !== "MAIN" && section.tagName !== "BODY") {
        hideElement(section, "ig-suggested");
      }
    });
  }

  function applyIgReelsRemoval() {
    if (!state.settings.igHideReels) {
      unhideByReason("ig-reels");
      return;
    }

    document.querySelectorAll('a[href="/reels/"], a[href="/reels"]').forEach((a) => {
      hideElement(findNavContainer(a), "ig-reels");
    });

    document.querySelectorAll("main article").forEach((article) => {
      if (
        article.querySelector('a[href*="/reel/"], a[href*="/reels/"], svg[aria-label="Reels"], svg[aria-label="릴스"]')
      ) {
        hideElement(article, "ig-reels");
      }
    });
  }

  function pickLearningCard() {
    const style = state.settings.learningStyle || "anki";
    const useExposure = style === "exposure" || (style === "mixed" && Math.random() < 0.5);
    const card = useExposure
      ? Storage.selectNextExposureCard(state.cards, state.settings, lastCardId, "instagram")
      : Storage.selectNextCard(state.cards, state.settings, lastCardId, Date.now(), "instagram");
    if (!card) return null;
    lastCardId = card.id;
    return { card, useExposure };
  }

  function buildAnkiCard(card) {
    const theme = detectIgTheme();
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
        furiBtn.addEventListener("click", (e) => {
          e.stopPropagation();
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
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakCardText(promptRaw, wrapper);
      });
      actionsEl.appendChild(ttsBtn);
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
    return { wrapper, closeBtn };
  }

  function buildExposureCard(card) {
    const theme = detectIgTheme();
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
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakCardText(speakText, wrapper);
      });
      actionsEl.appendChild(ttsBtn);
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

    wrapper.addEventListener("click", (e) => e.stopPropagation());
    return { wrapper, closeBtn, cleanup };
  }

  function buildUsageReminderCard(minutes) {
    const theme = detectIgTheme();
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
    header.appendChild(badge);
    header.appendChild(closeBtn);

    const title = document.createElement("div");
    title.className = "xfocus-usage-title";
    title.textContent = t("igUsageTitle", { mins: minutes });

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
    actions.appendChild(okBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(title);
    wrapper.appendChild(detail);
    wrapper.appendChild(actions);
    wrapper.addEventListener("click", (e) => e.stopPropagation());
    return { wrapper, closeBtn, okBtn };
  }

  function showFloatingOverlay(isUsageReminder, minutes, anchorTile, isSquare) {
    if (activeOverlayCleanup) {
      activeOverlayCleanup();
      activeOverlayCleanup = null;
    }
    document.querySelectorAll(".xfocus-yt-floating").forEach((el) => el.remove());
    const container = document.createElement("div");
    container.className = isSquare ? "xfocus-yt-floating xfocus-ig-square" : "xfocus-yt-floating";

    let cardCleanup = null;
    const closeAll = () => {
      if (cardCleanup) {
        cardCleanup();
        cardCleanup = null;
      }
      if (activeOverlayCleanup === closeAll) activeOverlayCleanup = null;
      container.remove();
    };
    activeOverlayCleanup = closeAll;

    if (isUsageReminder) {
      const built = buildUsageReminderCard(minutes);
      built.closeBtn.addEventListener("click", closeAll);
      built.okBtn.addEventListener("click", closeAll);
      container.appendChild(built.wrapper);
    } else {
      const picked = pickLearningCard();
      if (!picked) {
        activeOverlayCleanup = null;
        return;
      }
      const built = picked.useExposure ? buildExposureCard(picked.card) : buildAnkiCard(picked.card);
      cardCleanup = built.cleanup || null;
      built.closeBtn.addEventListener("click", closeAll);
      container.appendChild(built.wrapper);
    }

    document.body.appendChild(container);

    // If anchored to a specific grid tile (e.g. Explore search grid), float over it & auto-close when scrolled out
    if (anchorTile && document.body.contains(anchorTile)) {
      let posRaf = false;
      const updatePos = () => {
        posRaf = false;
        if (!document.body.contains(container) || !document.body.contains(anchorTile)) return;
        const rect = anchorTile.getBoundingClientRect();
        const cardW = container.offsetWidth || 340;
        const cardH = container.offsetHeight || 220;
        const left = Math.max(12, Math.min(window.innerWidth - cardW - 12, rect.left + (rect.width - cardW) / 2));
        const top = Math.max(12, Math.min(window.innerHeight - cardH - 12, rect.top + (rect.height - cardH) / 2));
        container.style.left = `${Math.round(left)}px`;
        container.style.top = `${Math.round(top)}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
      };

      const onScrollOrResize = () => {
        if (posRaf) return;
        posRaf = true;
        requestAnimationFrame(updatePos);
      };

      updatePos();
      window.addEventListener("scroll", onScrollOrResize, { passive: true });
      window.addEventListener("resize", onScrollOrResize, { passive: true });

      const tileObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry && !entry.isIntersecting) {
            tileObserver.disconnect();
            window.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
            closeAll();
          }
        },
        { threshold: 0.05 }
      );
      tileObserver.observe(anchorTile);

      const prevCleanup = cardCleanup;
      cardCleanup = () => {
        tileObserver.disconnect();
        window.removeEventListener("scroll", onScrollOrResize);
        window.removeEventListener("resize", onScrollOrResize);
        if (prevCleanup) prevCleanup();
      };
    }
  }

  function checkExploreGridCard() {
    if (!location.pathname.startsWith("/explore")) {
      exploreShownForUrl = "";
      return;
    }
    if (state.settings.igHideExplore || !state.settings.ankiEnabled || !state.cards || state.cards.length === 0) {
      return;
    }
    if (exploreShownForUrl === location.href) return;

    const tiles = Array.from(document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]')).filter((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 60 && r.height > 60 && r.bottom > 40 && r.top < window.innerHeight - 40;
    });
    if (tiles.length === 0) return;

    exploreShownForUrl = location.href;
    const randomTile = tiles[Math.floor(Math.random() * tiles.length)];
    showFloatingOverlay(false, 0, randomTile, true);
  }

  function runPass() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
    }
    applyIgExploreRemoval();
    applyIgHomeSuggestedRemoval();
    applyIgReelsRemoval();
    checkExploreGridCard();
  }

  function schedulePass() {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(() => {
      mutationScheduled = false;
      runPass();
    });
  }

  async function tickUsageTimer() {
    if (document.hidden) return;
    const sec = Math.max(1, Number(state.settings.usageCheckIntervalSec) || 3);
    const nextStats = await Storage.addInstagramUsageSeconds(sec);
    state.stats = nextStats;

    if (state.settings.usageReminderEnabled) {
      const intervalMin = Math.max(1, Number(state.settings.usageReminderIntervalMin) || 20);
      const usedMin = Math.floor((nextStats.instagramSecondsToday || 0) / 60);
      const milestone = Math.floor(usedMin / intervalMin) * intervalMin;

      if (milestone >= intervalMin && milestone > (nextStats.igLastReminderMinute || 0)) {
        state.stats = await Storage.markInstagramReminderShown(milestone);
        showFloatingOverlay(true, milestone, null, false);
        overlayElapsedSec = 0;
        return;
      }
    }

    // Time-based overlay learning card (rotates automatically even if already open)
    if (
      state.settings.ankiEnabled &&
      state.cards &&
      state.cards.length > 0 &&
      !location.pathname.startsWith("/explore") &&
      !document.querySelector(".xfocus-yt-floating .xfocus-usage-card")
    ) {
      overlayElapsedSec += sec;
      const overlayInterval = Math.max(5, Number(state.settings.overlayCardIntervalSec) || 60);
      if (overlayElapsedSec >= overlayInterval) {
        overlayElapsedSec = 0;
        showFloatingOverlay(false, 0, null, false);
      }
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

    window.addEventListener("popstate", schedulePass);

    if (ext && ext.storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener(async (_changes, area) => {
        if (area !== "local") return;
        state = await Storage.getState();
        startUsageTimer();
        applyIgExploreRemoval();
        applyIgHomeSuggestedRemoval();
        applyIgReelsRemoval();
      });
    }
  }

  init();
})();
