(function () {
  "use strict";

  const ext = globalThis.browser || globalThis.chrome;
  const Storage = globalThis.XFocusStorage;
  const I18n = globalThis.XFocusI18n;

  const els = {
    language: document.getElementById("language"),
    removeDiscoverTab: document.getElementById("removeDiscoverTab"),
    hideExploreNav: document.getElementById("hideExploreNav"),
    hideDiscoverSections: document.getElementById("hideDiscoverSections"),
    ytHideRecommendations: document.getElementById("ytHideRecommendations"),
    ytHideShorts: document.getElementById("ytHideShorts"),
    igHideHomeSuggested: document.getElementById("igHideHomeSuggested"),
    igHideExplore: document.getElementById("igHideExplore"),
    igHideReels: document.getElementById("igHideReels"),
    ankiEnabled: document.getElementById("ankiEnabled"),
    hideFurigana: document.getElementById("hideFurigana"),
    learningStyle: document.getElementById("learningStyle"),
    ankiDirection: document.getElementById("ankiDirection"),
    ankiInterval: document.getElementById("ankiInterval"),
    ankiActiveDeck: document.getElementById("ankiActiveDeck"),
    ankiStats: document.getElementById("ankiStats"),
    dailyStats: document.getElementById("dailyStats"),
    quickDeck: document.getElementById("quickDeck"),
    quickFront: document.getElementById("quickFront"),
    quickBack: document.getElementById("quickBack"),
    quickAddBtn: document.getElementById("quickAddBtn"),
    quickAddMsg: document.getElementById("quickAddMsg"),
    openOptionsBtn: document.getElementById("openOptionsBtn"),
    manageCardsBtn: document.getElementById("manageCardsBtn")
  };

  let currentLang = "auto";

  function t(key, vars) {
    return I18n.t(currentLang, key, vars);
  }

  function renderDeckOptions(cards, activeDeck) {
    const decks = Array.from(new Set(cards.map((c) => c.deck || "Default"))).sort();
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = t("allDecks");
    els.ankiActiveDeck.replaceChildren(allOpt);
    for (const d of decks) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      els.ankiActiveDeck.appendChild(opt);
    }
    els.ankiActiveDeck.value = decks.includes(activeDeck) || activeDeck === "ALL" ? activeDeck : "ALL";
  }

  function renderStats(cards, settings, stats) {
    const now = Date.now();
    const dueCount = cards.filter((c) => (c.due || 0) <= now).length;
    els.ankiStats.textContent = t("statsPill", { total: cards.length, due: dueCount });
    const goal = Math.max(1, Number(settings?.dailyGoal) || 20);
    const reviews = stats?.reviewsToday || 0;
    const streak = stats?.streak || 0;
    const mins = Math.floor((stats?.twitterSecondsToday || 0) / 60);
    const ytMins = Math.floor((stats?.youtubeSecondsToday || 0) / 60);
    const igMins = Math.floor((stats?.instagramSecondsToday || 0) / 60);
    if (els.dailyStats) {
      els.dailyStats.textContent = t("dailySummary", { reviews, goal, streak, mins, ytMins, igMins });
    }
  }

  async function loadUI() {
    const { settings, cards, stats } = await Storage.getState();
    currentLang = settings.language || "auto";
    els.language.value = currentLang;
    I18n.applyDomI18n(currentLang);

    els.removeDiscoverTab.checked = !!settings.removeDiscoverTab;
    els.hideExploreNav.checked = !!settings.hideExploreNav;
    els.hideDiscoverSections.checked = !!settings.hideDiscoverSections;
    if (els.ytHideRecommendations) els.ytHideRecommendations.checked = settings.ytHideRecommendations !== false;
    if (els.ytHideShorts) els.ytHideShorts.checked = settings.ytHideShorts !== false;
    if (els.igHideHomeSuggested) els.igHideHomeSuggested.checked = settings.igHideHomeSuggested !== false;
    if (els.igHideExplore) els.igHideExplore.checked = settings.igHideExplore !== false;
    if (els.igHideReels) els.igHideReels.checked = settings.igHideReels !== false;
    els.ankiEnabled.checked = !!settings.ankiEnabled;
    els.hideFurigana.checked = !!settings.hideFurigana;
    if (els.learningStyle) els.learningStyle.value = settings.learningStyle || "anki";
    els.ankiDirection.value = settings.ankiDirection || "front-to-back";
    els.ankiInterval.value = settings.ankiInterval || 5;

    renderDeckOptions(cards, settings.ankiActiveDeck);
    renderStats(cards, settings, stats);
  }

  async function onSettingChange() {
    currentLang = els.language.value || "auto";
    await Storage.saveSettings({
      language: currentLang,
      removeDiscoverTab: els.removeDiscoverTab.checked,
      hideExploreNav: els.hideExploreNav.checked,
      hideDiscoverSections: els.hideDiscoverSections.checked,
      ytHideRecommendations: els.ytHideRecommendations ? els.ytHideRecommendations.checked : true,
      ytHideShorts: els.ytHideShorts ? els.ytHideShorts.checked : true,
      igHideHomeSuggested: els.igHideHomeSuggested ? els.igHideHomeSuggested.checked : true,
      igHideExplore: els.igHideExplore ? els.igHideExplore.checked : true,
      igHideReels: els.igHideReels ? els.igHideReels.checked : true,
      ankiEnabled: els.ankiEnabled.checked,
      hideFurigana: els.hideFurigana.checked,
      learningStyle: els.learningStyle ? els.learningStyle.value : "anki",
      ankiDirection: els.ankiDirection.value || "front-to-back",
      ankiInterval: Math.max(1, Number(els.ankiInterval.value) || 5),
      ankiActiveDeck: els.ankiActiveDeck.value || "ALL"
    });
    I18n.applyDomI18n(currentLang);
    await loadUI();
  }

  function openOptions() {
    if (ext && ext.runtime && typeof ext.runtime.openOptionsPage === "function") {
      ext.runtime.openOptionsPage();
    } else if (ext && ext.runtime) {
      window.open(ext.runtime.getURL("options/options.html"), "_blank");
    }
  }

  function bindEvents() {
    [
      els.language,
      els.removeDiscoverTab,
      els.hideExploreNav,
      els.hideDiscoverSections,
      els.ytHideRecommendations,
      els.ytHideShorts,
      els.igHideHomeSuggested,
      els.igHideExplore,
      els.igHideReels,
      els.ankiEnabled,
      els.hideFurigana,
      els.learningStyle,
      els.ankiDirection,
      els.ankiInterval,
      els.ankiActiveDeck
    ].forEach((el) => {
      if (el) el.addEventListener("change", onSettingChange);
    });

    els.openOptionsBtn.addEventListener("click", openOptions);
    els.manageCardsBtn.addEventListener("click", openOptions);

    els.quickAddBtn.addEventListener("click", async () => {
      const deck = els.quickDeck.value.trim() || "Default";
      const front = els.quickFront.value.trim();
      const back = els.quickBack.value.trim();
      if (!front || !back) {
        els.quickAddMsg.textContent = t("fillFrontBack");
        return;
      }
      const res = await Storage.addCard({ deck, front, back });
      els.quickFront.value = "";
      els.quickBack.value = "";
      els.quickAddMsg.textContent = t("cardSaved");
      renderDeckOptions(res.cards, els.ankiActiveDeck.value);
      const latest = await Storage.getState();
      renderStats(res.cards, latest.settings, latest.stats);
    });
  }

  bindEvents();
  loadUI();
})();
