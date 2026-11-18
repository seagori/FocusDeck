(function (root) {
  "use strict";

  const ext = root.browser || root.chrome || null;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const DEFAULT_SETTINGS = Object.freeze({
    language: "auto", // "auto" | "ko" | "en" | "ja"
    removeDiscoverTab: true,
    hideExploreNav: true,
    hideDiscoverSections: true,
    ankiEnabled: true,
    ankiInterval: 5,
    ankiMode: "due-or-all", // "due-or-all" | "due-only" | "random"
    ankiActiveDeck: "ALL",
    learningStyle: "anki", // "anki" | "exposure" | "mixed"
    ankiDirection: "front-to-back", // "front-to-back" | "back-to-front" | "both"
    ankiDeckWeights: {}, // { [deckName]: number }
    deckPlatforms: {}, // { [deckName]: "all" | "x" | "youtube" }
    hideFurigana: false,
    mutedKeywords: [], // string[]
    dailyGoal: 20,
    usageReminderEnabled: true,
    usageReminderIntervalMin: 20,
    usageCheckIntervalSec: 3,
    overlayCardIntervalSec: 60,
    ytHideRecommendations: true,
    ytHideShorts: true,
    ytShortsCardInterval: 3,
    igHideHomeSuggested: true,
    igHideExplore: true,
    igHideReels: true,
    igReelsCardInterval: 3
  });

  function getTodayKey(nowMs) {
    const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function getYesterdayKey(nowMs) {
    return getTodayKey((Number.isFinite(nowMs) ? nowMs : Date.now()) - DAY_MS);
  }

  function createDefaultStats(nowMs) {
    return {
      date: getTodayKey(nowMs),
      reviewsToday: 0,
      streak: 0,
      lastGoalDate: "",
      twitterSecondsToday: 0,
      lastReminderMinute: 0,
      youtubeSecondsToday: 0,
      ytLastReminderMinute: 0,
      instagramSecondsToday: 0,
      igLastReminderMinute: 0
    };
  }

  function normalizeStats(raw, nowMs) {
    const today = getTodayKey(nowMs);
    const base = createDefaultStats(nowMs);
    if (!raw || typeof raw !== "object") return base;

    const streak = Number.isFinite(raw.streak) ? raw.streak : 0;
    const lastGoalDate = typeof raw.lastGoalDate === "string" ? raw.lastGoalDate : "";

    if (raw.date !== today) {
      // New day: reset daily counters, preserve streak if goal was met yesterday or today
      const yesterday = getYesterdayKey(nowMs);
      const keepStreak = lastGoalDate === yesterday || lastGoalDate === today ? streak : 0;
      return Object.assign({}, base, {
        streak: keepStreak,
        lastGoalDate
      });
    }

    return {
      date: today,
      reviewsToday: Number.isFinite(raw.reviewsToday) ? raw.reviewsToday : 0,
      streak,
      lastGoalDate,
      twitterSecondsToday: Number.isFinite(raw.twitterSecondsToday) ? raw.twitterSecondsToday : 0,
      lastReminderMinute: Number.isFinite(raw.lastReminderMinute) ? raw.lastReminderMinute : 0,
      youtubeSecondsToday: Number.isFinite(raw.youtubeSecondsToday) ? raw.youtubeSecondsToday : 0,
      ytLastReminderMinute: Number.isFinite(raw.ytLastReminderMinute) ? raw.ytLastReminderMinute : 0,
      instagramSecondsToday: Number.isFinite(raw.instagramSecondsToday) ? raw.instagramSecondsToday : 0,
      igLastReminderMinute: Number.isFinite(raw.igLastReminderMinute) ? raw.igLastReminderMinute : 0
    };
  }

  function createStarterCards() {
    return [];
  }

  function generateId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return "card-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeCard(raw, defaultDeck) {
    const now = Date.now();
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
      : typeof raw.tags === "string"
        ? raw.tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
        : [];
    return {
      id: raw.id ? String(raw.id) : generateId(),
      deck: String(raw.deck || defaultDeck || "Default").trim() || "Default",
      front: String(raw.front || "").trim(),
      back: String(raw.back || "").trim(),
      hint: raw.hint ? String(raw.hint).trim() : "",
      image: raw.image ? String(raw.image).trim() : "",
      tags,
      interval: Number.isFinite(raw.interval) ? raw.interval : 0,
      ease: Number.isFinite(raw.ease) ? Math.max(1.3, raw.ease) : 2.5,
      reps: Number.isInteger(raw.reps) ? raw.reps : 0,
      lapses: Number.isInteger(raw.lapses) ? raw.lapses : 0,
      due: Number.isFinite(raw.due) ? raw.due : now,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now
    };
  }

  function stripFurigana(text) {
    return String(text || "")
      .replace(/[（(][ぁ-んァ-ンー・\s]+[）)]/g, "")
      .trim();
  }

  function hasFurigana(text) {
    return /[（(][ぁ-んァ-ンー・\s]+[）)]/.test(String(text || ""));
  }

  function computeSm2Review(card, rating, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    let interval = card.interval || 0;
    let ease = card.ease || 2.5;
    let reps = card.reps || 0;
    let lapses = card.lapses || 0;
    let due;

    if (rating === "again") {
      reps = 0;
      lapses += 1;
      interval = 0;
      ease = Math.max(1.3, +(ease - 0.2).toFixed(2));
      due = now + 5 * 60 * 1000;
    } else if (rating === "hard") {
      interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
      reps += 1;
      ease = Math.max(1.3, +(ease - 0.15).toFixed(2));
      due = now + interval * DAY_MS;
    } else if (rating === "good") {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.max(1, Math.round(interval * ease));
      reps += 1;
      due = now + interval * DAY_MS;
    } else if (rating === "easy") {
      if (reps === 0) interval = 4;
      else if (reps === 1) interval = 8;
      else interval = Math.max(1, Math.round(interval * ease * 1.3));
      reps += 1;
      ease = +(ease + 0.15).toFixed(2);
      due = now + interval * DAY_MS;
    } else {
      due = now + DAY_MS;
    }

    return Object.assign({}, card, { interval, ease, reps, lapses, due });
  }

  function formatIntervalLabel(intervalDays, rating, settingLang) {
    const lang = root.XFocusI18n ? root.XFocusI18n.resolveLang(settingLang) : "ko";
    if (rating === "again" || intervalDays <= 0) {
      return lang === "en" ? "5m" : lang === "ja" ? "5分後" : "5분 후";
    }
    if (intervalDays === 1) {
      return lang === "en" ? "1d" : lang === "ja" ? "1日後" : "1일 후";
    }
    if (intervalDays < 30) {
      return lang === "en" ? `${intervalDays}d` : lang === "ja" ? `${intervalDays}日後` : `${intervalDays}일 후`;
    }
    const months = Math.round(intervalDays / 30);
    return lang === "en" ? `${months}mo` : lang === "ja" ? `${months}ヶ月後` : `${months}개월 후`;
  }

  function filterByDeck(cards, deck) {
    if (!deck || deck === "ALL") return cards;
    return cards.filter((c) => c.deck === deck);
  }

  function filterByPlatform(cards, settings, platform) {
    if (!platform) return cards;
    const map = settings?.deckPlatforms;
    if (!map || typeof map !== "object") return cards;
    return cards.filter((c) => {
      const rule = map[c.deck || "Default"] || "all";
      return rule === "all" || rule === platform;
    });
  }

  function pickWeightedDeck(pool, weights) {
    const decks = Array.from(new Set(pool.map((c) => c.deck || "Default")));
    if (decks.length <= 1) return decks[0] || null;
    if (!weights || typeof weights !== "object") return null;

    const entries = decks.map((d) => {
      const w = Number(weights[d]);
      return { deck: d, weight: Number.isFinite(w) && w >= 0 ? w : 1 };
    });

    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    if (total <= 0) return null;

    let r = Math.random() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r <= 0) return e.deck;
    }
    return entries[entries.length - 1].deck;
  }

  function applyWeightedDeckFilter(pool, settings) {
    if (pool.length === 0) return pool;
    if (settings?.ankiActiveDeck && settings.ankiActiveDeck !== "ALL") return pool;
    const weights = settings?.ankiDeckWeights;
    if (!weights || typeof weights !== "object" || Object.keys(weights).length === 0) return pool;

    const chosenDeck = pickWeightedDeck(pool, weights);
    if (!chosenDeck) return [];
    return pool.filter((c) => (c.deck || "Default") === chosenDeck);
  }

  function selectNextCard(cards, settings, excludeId, nowMs, platform) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const validCards = filterByPlatform(
      (cards || []).filter((c) => (c.front || c.image) && c.back),
      settings,
      platform
    );
    if (validCards.length === 0) return null;

    let pool = filterByDeck(validCards, settings?.ankiActiveDeck || "ALL");
    if (pool.length === 0) return null;

    // Exclude decks explicitly set to weight 0
    if ((!settings?.ankiActiveDeck || settings.ankiActiveDeck === "ALL") && settings?.ankiDeckWeights) {
      const weights = settings.ankiDeckWeights;
      if (Object.keys(weights).length > 0) {
        pool = pool.filter((c) => {
          const w = Number(weights[c.deck || "Default"]);
          return !(Number.isFinite(w) && w === 0);
        });
        if (pool.length === 0) return null;
      }
    }

    const mode = settings?.ankiMode || "due-or-all";
    const duePool = pool.filter((c) => (c.due || 0) <= now);

    if (mode === "due-only") {
      const weightedDue = applyWeightedDeckFilter(duePool, settings);
      if (weightedDue.length === 0) return null;
      let bestDue = null;
      let fallbackDue = null;
      for (let i = 0; i < weightedDue.length; i++) {
        const c = weightedDue[i];
        if (c.id !== excludeId) {
          if (!bestDue || (c.due || 0) < (bestDue.due || 0)) bestDue = c;
        } else if (!fallbackDue || (c.due || 0) < (fallbackDue.due || 0)) {
          fallbackDue = c;
        }
      }
      return bestDue || fallbackDue || null;
    }

    if (mode === "due-or-all" && duePool.length > 0) {
      const weightedDue = applyWeightedDeckFilter(duePool, settings);
      if (weightedDue.length > 0) {
        let bestDue = null;
        let fallbackDue = null;
        for (let i = 0; i < weightedDue.length; i++) {
          const c = weightedDue[i];
          if (c.id !== excludeId) {
            if (!bestDue || (c.due || 0) < (bestDue.due || 0)) bestDue = c;
          } else if (!fallbackDue || (c.due || 0) < (fallbackDue.due || 0)) {
            fallbackDue = c;
          }
        }
        if (bestDue || fallbackDue) return bestDue || fallbackDue;
      }
    }

    const weightedPool = applyWeightedDeckFilter(pool, settings);
    if (weightedPool.length === 0) return null;
    const candidates = weightedPool.length > 1 ? weightedPool.filter((c) => c.id !== excludeId) : weightedPool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function selectNextExposureCard(cards, settings, excludeId, platform) {
    const validCards = filterByPlatform(
      (cards || []).filter((c) => (c.front || c.image) && (c.back || c.hint)),
      settings,
      platform
    );
    if (validCards.length === 0) return null;

    let pool = filterByDeck(validCards, settings?.ankiActiveDeck || "ALL");
    pool = applyWeightedDeckFilter(pool, settings);
    if (pool.length === 0) return null;

    // Pick card with fewest views (tie-break by oldest lastSeenAt)
    let best = null;
    let fallback = null;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const v = c.views || 0;
      const seen = c.lastSeenAt || 0;
      if (c.id !== excludeId) {
        if (!best || v < (best.views || 0) || (v === (best.views || 0) && seen < (best.lastSeenAt || 0))) {
          best = c;
        }
      } else {
        fallback = c;
      }
    }
    return best || fallback;
  }

  function parseAnkiImportText(text, defaultDeck) {
    const rawText = String(text || "");
    const trimmed = rawText.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .map((item) => normalizeCard(item, defaultDeck))
        .filter((c) => (c.front || c.image) && c.back);
    }

    const lines = rawText.split(/\r?\n/);
    const cards = [];
    for (const rawLine of lines) {
      const line = rawLine.replace(/[\r\n]+$/g, "");
      if (!line.trim() || line.trim().startsWith("#")) continue;

      let parts;
      if (line.includes("\t")) parts = line.split("\t");
      else if (line.includes("::")) parts = line.split("::");
      else if (line.includes(";")) parts = line.split(";");
      else continue;

      const front = (parts[0] || "").trim();
      const back = (parts[1] || "").trim();
      const hint = parts.length >= 4 ? (parts[2] || "").trim() : "";
      const tagsRaw = parts.length >= 4 ? parts[3] : (parts[2] || "");
      const image = parts.length >= 5 ? (parts[4] || "").trim() : "";
      if ((front || image) && back) {
        cards.push(
          normalizeCard({ deck: defaultDeck || "Default", front, back, hint, tags: tagsRaw, image }, defaultDeck)
        );
      }
    }
    return cards;
  }

  async function storageGet(keys) {
    if (!ext || !ext.storage || !ext.storage.local) return {};
    return await ext.storage.local.get(keys);
  }

  async function storageSet(obj) {
    if (!ext || !ext.storage || !ext.storage.local) return;
    await ext.storage.local.set(obj);
  }

  function mergeCardProgress(card, srsProgress, exposureProgress) {
    const p = srsProgress && srsProgress[card.id];
    const e = exposureProgress && exposureProgress[card.id];
    if (!p && !e) return card;
    return Object.assign({}, card, p ? {
      interval: Number.isFinite(p.interval) ? p.interval : card.interval || 0,
      ease: Number.isFinite(p.ease) ? p.ease : card.ease || 2.5,
      reps: Number.isInteger(p.reps) ? p.reps : card.reps || 0,
      lapses: Number.isInteger(p.lapses) ? p.lapses : card.lapses || 0,
      due: Number.isFinite(p.due) ? p.due : card.due || 0
    } : {}, e ? {
      views: Number.isInteger(e.views) ? e.views : 0,
      totalSeconds: Number.isFinite(e.totalSeconds) ? e.totalSeconds : 0,
      lastSeenAt: Number.isFinite(e.lastSeenAt) ? e.lastSeenAt : 0
    } : {});
  }

  async function getState() {
    const data = await storageGet(["settings", "cards", "srsProgress", "exposureProgress", "stats", "initialized"]);
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    let rawCards = Array.isArray(data.cards) ? data.cards : null;
    const srsProgress = data.srsProgress && typeof data.srsProgress === "object" ? data.srsProgress : {};
    const exposureProgress = data.exposureProgress && typeof data.exposureProgress === "object" ? data.exposureProgress : {};
    const stats = normalizeStats(data.stats);

    if (!data.initialized && !rawCards) {
      rawCards = createStarterCards();
      await storageSet({ settings, cards: rawCards, srsProgress, exposureProgress, stats, initialized: true });
    } else if (!rawCards) {
      rawCards = [];
    }

    const cards = rawCards.map((c) => mergeCardProgress(c, srsProgress, exposureProgress));
    return { settings, cards, srsProgress, exposureProgress, stats };
  }

  async function saveSettings(partial) {
    const { settings } = await getState();
    const next = Object.assign({}, settings, partial);
    await storageSet({ settings: next });
    return next;
  }

  async function saveCards(cards) {
    await storageSet({ cards, initialized: true });
    return cards;
  }

  async function addCard(cardInput) {
    const { cards } = await getState();
    const card = normalizeCard(cardInput);
    const next = [card, ...cards];
    await saveCards(next);
    return { card, cards: next };
  }

  async function updateCard(id, patch) {
    const { cards } = await getState();
    const next = cards.map((c) => (c.id === id ? normalizeCard(Object.assign({}, c, patch, { id })) : c));
    await saveCards(next);
    return next;
  }

  async function deleteCard(id) {
    const { cards, srsProgress } = await getState();
    const next = cards.filter((c) => c.id !== id);
    if (srsProgress && srsProgress[id]) {
      delete srsProgress[id];
      await storageSet({ cards: next, srsProgress, initialized: true });
    } else {
      await saveCards(next);
    }
    return next;
  }

  async function reviewCard(id, rating) {
    const data = await storageGet(["cards", "srsProgress", "settings", "stats"]);
    const rawCards = Array.isArray(data.cards) ? data.cards : [];
    const srsProgress = data.srsProgress && typeof data.srsProgress === "object"
      ? Object.assign({}, data.srsProgress)
      : {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    const stats = normalizeStats(data.stats);

    const target = rawCards.find((c) => c.id === id);
    let updated = null;
    if (target) {
      const merged = mergeCardProgress(target, srsProgress);
      updated = computeSm2Review(merged, rating);
      srsProgress[id] = {
        interval: updated.interval,
        ease: updated.ease,
        reps: updated.reps,
        lapses: updated.lapses,
        due: updated.due
      };
    }

    const today = getTodayKey();
    const nextStats = Object.assign({}, stats, {
      reviewsToday: (stats.reviewsToday || 0) + 1
    });
    const goal = Math.max(1, Number(settings.dailyGoal) || 20);
    if (nextStats.reviewsToday >= goal && nextStats.lastGoalDate !== today) {
      const yesterday = getYesterdayKey();
      nextStats.streak = nextStats.lastGoalDate === yesterday ? (nextStats.streak || 0) + 1 : 1;
      nextStats.lastGoalDate = today;
    }

    if (updated) {
      // Write ONLY srsProgress + stats (tiny payload even with 10,000+ cards)
      await storageSet({ srsProgress, stats: nextStats });
    }

    const cards = rawCards.map((c) => mergeCardProgress(c, srsProgress));
    return { updated, cards, stats: nextStats };
  }

  async function resetAllProgress() {
    const { cards } = await getState();
    const now = Date.now();
    const resetCards = cards.map((c) =>
      Object.assign({}, c, { interval: 0, ease: 2.5, reps: 0, lapses: 0, due: now - 1000 })
    );
    await storageSet({ cards: resetCards, srsProgress: {}, initialized: true });
    return resetCards;
  }

  async function renameDeck(oldDeck, newDeck) {
    const from = String(oldDeck || "").trim();
    const to = String(newDeck || "").trim();
    if (!from || !to || from === to) return await getState();

    const { cards, settings } = await getState();
    const nextCards = cards.map((c) => ((c.deck || "Default") === from ? Object.assign({}, c, { deck: to }) : c));

    const nextWeights = Object.assign({}, settings.ankiDeckWeights || {});
    if (Object.prototype.hasOwnProperty.call(nextWeights, from)) {
      nextWeights[to] = nextWeights[from];
      delete nextWeights[from];
    }
    const nextPlatforms = Object.assign({}, settings.deckPlatforms || {});
    if (Object.prototype.hasOwnProperty.call(nextPlatforms, from)) {
      nextPlatforms[to] = nextPlatforms[from];
      delete nextPlatforms[from];
    }
    const nextActiveDeck = settings.ankiActiveDeck === from ? to : settings.ankiActiveDeck;
    const nextSettings = Object.assign({}, settings, {
      ankiDeckWeights: nextWeights,
      deckPlatforms: nextPlatforms,
      ankiActiveDeck: nextActiveDeck
    });

    await storageSet({ cards: nextCards, settings: nextSettings, initialized: true });
    return { cards: nextCards, settings: nextSettings };
  }

  async function importCards(parsedCards, options) {
    const skipDuplicates = options?.skipDuplicates !== false;
    const { cards } = await getState();
    const existingKeys = new Set(
      cards.map((c) => `${(c.deck || "Default").trim()}\u0000${(c.front || "").trim()}`)
    );

    const toAdd = [];
    let skippedCount = 0;
    for (const c of parsedCards) {
      const key = `${(c.deck || "Default").trim()}\u0000${(c.front || "").trim()}`;
      if (skipDuplicates && existingKeys.has(key)) {
        skippedCount += 1;
        continue;
      }
      existingKeys.add(key);
      toAdd.push(c);
    }

    const merged = [...toAdd, ...cards];
    await saveCards(merged);
    return { addedCount: toAdd.length, skippedCount, cards: merged };
  }

  async function exportFullBackup() {
    const { settings, cards, srsProgress, stats } = await getState();
    return {
      format: "focusdeck-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      stats,
      srsProgress,
      cards
    };
  }

  async function restoreFullBackup(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.cards)) {
      throw new Error("Invalid backup format");
    }
    const settings = Object.assign({}, DEFAULT_SETTINGS, payload.settings || {});
    const cards = payload.cards.map((c) => normalizeCard(c)).filter((c) => c.front && c.back);
    const srsProgress = payload.srsProgress && typeof payload.srsProgress === "object" ? payload.srsProgress : {};
    const stats = normalizeStats(payload.stats);

    await storageSet({ settings, cards, srsProgress, stats, initialized: true });
    return { settings, cards: cards.map((c) => mergeCardProgress(c, srsProgress)), srsProgress, stats };
  }

  async function recordExposure(id, deltaSeconds, countView) {
    const delta = Math.max(0, Math.min(300, Math.round(Number(deltaSeconds) || 0)));
    const data = await storageGet(["exposureProgress"]);
    const exposureProgress =
      data.exposureProgress && typeof data.exposureProgress === "object"
        ? Object.assign({}, data.exposureProgress)
        : {};
    const prev = exposureProgress[id] || { views: 0, totalSeconds: 0, lastSeenAt: 0 };
    const next = {
      views: (prev.views || 0) + (countView ? 1 : 0),
      totalSeconds: (prev.totalSeconds || 0) + delta,
      lastSeenAt: Date.now()
    };
    exposureProgress[id] = next;
    await storageSet({ exposureProgress });
    return next;
  }

  async function addTwitterUsageSeconds(seconds) {
    const delta = Math.max(0, Math.min(120, Math.round(Number(seconds) || 0)));
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      twitterSecondsToday: (stats.twitterSecondsToday || 0) + delta
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  async function markUsageReminderShown(minuteMilestone) {
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      lastReminderMinute: Math.max(stats.lastReminderMinute || 0, minuteMilestone)
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  async function addYoutubeUsageSeconds(seconds) {
    const delta = Math.max(0, Math.min(120, Math.round(Number(seconds) || 0)));
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      youtubeSecondsToday: (stats.youtubeSecondsToday || 0) + delta
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  async function markYoutubeReminderShown(minuteMilestone) {
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      ytLastReminderMinute: Math.max(stats.ytLastReminderMinute || 0, minuteMilestone)
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  async function addInstagramUsageSeconds(seconds) {
    const delta = Math.max(0, Math.min(120, Math.round(Number(seconds) || 0)));
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      instagramSecondsToday: (stats.instagramSecondsToday || 0) + delta
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  async function markInstagramReminderShown(minuteMilestone) {
    const { stats } = await getState();
    const nextStats = Object.assign({}, stats, {
      igLastReminderMinute: Math.max(stats.igLastReminderMinute || 0, minuteMilestone)
    });
    await storageSet({ stats: nextStats });
    return nextStats;
  }

  const api = {
    DEFAULT_SETTINGS,
    getTodayKey,
    createDefaultStats,
    normalizeStats,
    createStarterCards,
    normalizeCard,
    stripFurigana,
    hasFurigana,
    computeSm2Review,
    formatIntervalLabel,
    selectNextCard,
    selectNextExposureCard,
    parseAnkiImportText,
    getState,
    saveSettings,
    saveCards,
    addCard,
    updateCard,
    deleteCard,
    reviewCard,
    recordExposure,
    resetAllProgress,
    renameDeck,
    importCards,
    exportFullBackup,
    restoreFullBackup,
    addTwitterUsageSeconds,
    markUsageReminderShown,
    addYoutubeUsageSeconds,
    markYoutubeReminderShown,
    addInstagramUsageSeconds,
    markInstagramReminderShown
  };

  root.XFocusStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
