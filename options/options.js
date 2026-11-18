(function () {
  "use strict";

  const Storage = globalThis.XFocusStorage;
  const I18n = globalThis.XFocusI18n;

  const els = {
    language: document.getElementById("language"),
    removeDiscoverTab: document.getElementById("removeDiscoverTab"),
    hideExploreNav: document.getElementById("hideExploreNav"),
    hideDiscoverSections: document.getElementById("hideDiscoverSections"),
    ankiEnabled: document.getElementById("ankiEnabled"),
    hideFurigana: document.getElementById("hideFurigana"),
    usageReminderEnabled: document.getElementById("usageReminderEnabled"),
    ytHideRecommendations: document.getElementById("ytHideRecommendations"),
    ytHideShorts: document.getElementById("ytHideShorts"),
    ytShortsCardInterval: document.getElementById("ytShortsCardInterval"),
    igHideHomeSuggested: document.getElementById("igHideHomeSuggested"),
    igHideExplore: document.getElementById("igHideExplore"),
    igHideReels: document.getElementById("igHideReels"),
    igReelsCardInterval: document.getElementById("igReelsCardInterval"),
    ankiInterval: document.getElementById("ankiInterval"),
    ankiMode: document.getElementById("ankiMode"),
    learningStyle: document.getElementById("learningStyle"),
    ankiDirection: document.getElementById("ankiDirection"),
    ankiActiveDeck: document.getElementById("ankiActiveDeck"),
    dailyGoal: document.getElementById("dailyGoal"),
    usageReminderIntervalMin: document.getElementById("usageReminderIntervalMin"),
    usageCheckIntervalSec: document.getElementById("usageCheckIntervalSec"),
    overlayCardIntervalSec: document.getElementById("overlayCardIntervalSec"),
    mutedKeywords: document.getElementById("mutedKeywords"),
    deckWeightsList: document.getElementById("deckWeightsList"),
    statsBanner: document.getElementById("statsBanner"),
    settingsMsg: document.getElementById("settingsMsg"),

    formTitle: document.getElementById("formTitle"),
    editCardId: document.getElementById("editCardId"),
    cardDeck: document.getElementById("cardDeck"),
    cardHint: document.getElementById("cardHint"),
    cardTags: document.getElementById("cardTags"),
    cardImage: document.getElementById("cardImage"),
    cardImageFile: document.getElementById("cardImageFile"),
    clearImageBtn: document.getElementById("clearImageBtn"),
    cardImagePreview: document.getElementById("cardImagePreview"),
    cardFront: document.getElementById("cardFront"),
    cardBack: document.getElementById("cardBack"),
    saveCardBtn: document.getElementById("saveCardBtn"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
    cardFormMsg: document.getElementById("cardFormMsg"),

    importDeck: document.getElementById("importDeck"),
    importFile: document.getElementById("importFile"),
    importText: document.getElementById("importText"),
    skipDuplicates: document.getElementById("skipDuplicates"),
    importBtn: document.getElementById("importBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    exportTsvBtn: document.getElementById("exportTsvBtn"),
    backupBtn: document.getElementById("backupBtn"),
    restoreBtn: document.getElementById("restoreBtn"),
    restoreFile: document.getElementById("restoreFile"),
    resetProgressBtn: document.getElementById("resetProgressBtn"),
    importMsg: document.getElementById("importMsg"),
    deckManagerList: document.getElementById("deckManagerList"),

    totalCardsCount: document.getElementById("totalCardsCount"),
    filterDeck: document.getElementById("filterDeck"),
    searchQuery: document.getElementById("searchQuery"),
    deleteDeckBtn: document.getElementById("deleteDeckBtn"),
    paginationBar: document.getElementById("paginationBar"),
    cardsList: document.getElementById("cardsList")
  };

  const PAGE_SIZE = 50;
  let currentPage = 1;
  let searchTimer = null;
  let currentState = { settings: {}, cards: [], stats: {} };

  function t(key, vars) {
    return I18n.t(currentState.settings?.language || "auto", key, vars);
  }

  function renderStatsBanner() {
    if (!els.statsBanner) return;
    const s = currentState.settings || {};
    const st = currentState.stats || {};
    const goal = Math.max(1, Number(s.dailyGoal) || 20);
    const mins = Math.floor((st.twitterSecondsToday || 0) / 60);
    const ytMins = Math.floor((st.youtubeSecondsToday || 0) / 60);
    const igMins = Math.floor((st.instagramSecondsToday || 0) / 60);
    els.statsBanner.textContent = t("dailySummary", {
      reviews: st.reviewsToday || 0,
      goal,
      streak: st.streak || 0,
      mins,
      ytMins,
      igMins
    });
  }

  function populateDeckSelects(cards, activeDeck) {
    const decks = Array.from(new Set(cards.map((c) => c.deck || "Default"))).sort();

    const prevFilter = els.filterDeck.value || "ALL";
    const allOpt1 = document.createElement("option");
    allOpt1.value = "ALL";
    allOpt1.textContent = t("allDecks");
    els.ankiActiveDeck.replaceChildren(allOpt1);

    const allOpt2 = document.createElement("option");
    allOpt2.value = "ALL";
    allOpt2.textContent = t("filterAllDecks");
    els.filterDeck.replaceChildren(allOpt2);

    for (const d of decks) {
      const o1 = document.createElement("option");
      o1.value = d;
      o1.textContent = d;
      els.ankiActiveDeck.appendChild(o1);

      const o2 = document.createElement("option");
      o2.value = d;
      o2.textContent = d;
      els.filterDeck.appendChild(o2);
    }

    els.ankiActiveDeck.value = decks.includes(activeDeck) || activeDeck === "ALL" ? activeDeck : "ALL";
    els.filterDeck.value = decks.includes(prevFilter) || prevFilter === "ALL" ? prevFilter : "ALL";
    renderDeckWeights(decks);
    renderDeckManager(cards);
  }

  function renderDeckManager(cards) {
    if (!els.deckManagerList) return;
    els.deckManagerList.innerHTML = "";
    const now = Date.now();
    const groups = new Map();
    for (const c of cards) {
      const name = c.deck || "Default";
      if (!groups.has(name)) groups.set(name, { total: 0, due: 0 });
      const g = groups.get(name);
      g.total += 1;
      if ((c.due || 0) <= now) g.due += 1;
    }

    if (groups.size === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = t("noDecksYet");
      els.deckManagerList.appendChild(p);
      return;
    }

    const sortedNames = Array.from(groups.keys()).sort();
    for (const deckName of sortedNames) {
      const info = groups.get(deckName);
      const row = document.createElement("div");
      row.className = "card-item";

      const top = document.createElement("div");
      top.className = "card-item-top";

      const meta = document.createElement("div");
      meta.className = "card-meta";
      const tag = document.createElement("span");
      tag.className = "deck-tag";
      tag.textContent = deckName;
      const statsSpan = document.createElement("span");
      statsSpan.textContent = t("deckStats", { total: info.total, due: info.due });
      meta.appendChild(tag);
      meta.appendChild(statsSpan);

      const actions = document.createElement("div");
      actions.className = "card-item-actions";

      const platSelect = document.createElement("select");
      platSelect.style.width = "auto";
      platSelect.style.padding = "4px 8px";
      platSelect.style.fontSize = "12px";
      [
        { val: "all", key: "platformAll" },
        { val: "x", key: "platformX" },
        { val: "youtube", key: "platformYt" },
        { val: "instagram", key: "platformIg" }
      ].forEach((optInfo) => {
        const opt = document.createElement("option");
        opt.value = optInfo.val;
        opt.textContent = t(optInfo.key);
        platSelect.appendChild(opt);
      });
      const currentPlat = (currentState.settings?.deckPlatforms && currentState.settings.deckPlatforms[deckName]) || "all";
      platSelect.value = currentPlat;
      platSelect.addEventListener("change", async () => {
        const nextPlatforms = Object.assign({}, currentState.settings?.deckPlatforms || {});
        nextPlatforms[deckName] = platSelect.value;
        currentState.settings = await Storage.saveSettings({ deckPlatforms: nextPlatforms });
        els.settingsMsg.textContent = t("settingsSaved");
        setTimeout(() => { els.settingsMsg.textContent = ""; }, 1800);
      });

      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "btn btn-secondary btn-sm";
      viewBtn.textContent = t("filterDeckBtn");
      viewBtn.addEventListener("click", () => {
        els.filterDeck.value = deckName;
        currentPage = 1;
        renderCardsList();
        els.cardsList.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "btn btn-secondary btn-sm";
      renameBtn.textContent = t("renameDeckBtn");
      renameBtn.addEventListener("click", async () => {
        const nextName = prompt(t("renameDeckPrompt", { deck: deckName }), deckName);
        if (!nextName || !nextName.trim() || nextName.trim() === deckName) return;
        const res = await Storage.renameDeck(deckName, nextName.trim());
        currentState.cards = res.cards;
        currentState.settings = res.settings;
        populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
        renderCardsList();
        els.importMsg.textContent = t("deckRenamed", { from: deckName, to: nextName.trim() });
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.textContent = t("deleteBtn");
      delBtn.addEventListener("click", async () => {
        if (!confirm(t("confirmDeleteDeck", { deck: deckName, count: info.total }))) return;
        const remaining = currentState.cards.filter((c) => (c.deck || "Default") !== deckName);
        currentState.cards = await Storage.saveCards(remaining);
        if (els.filterDeck.value === deckName) els.filterDeck.value = "ALL";
        currentPage = 1;
        populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
        renderCardsList();
      });

      actions.appendChild(platSelect);
      actions.appendChild(viewBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);

      top.appendChild(meta);
      top.appendChild(actions);
      row.appendChild(top);
      els.deckManagerList.appendChild(row);
    }
  }

  function renderDeckWeights(decks) {
    if (!els.deckWeightsList) return;
    els.deckWeightsList.innerHTML = "";
    if (decks.length === 0) {
      const p = document.createElement("span");
      p.className = "muted";
      p.textContent = t("noDecksYet");
      els.deckWeightsList.appendChild(p);
      return;
    }
    const weights = currentState.settings?.ankiDeckWeights || {};
    for (const d of decks) {
      const field = document.createElement("div");
      field.className = "field";
      const label = document.createElement("label");
      label.textContent = t("deckWeightLabel", { deck: d });
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.value = Number.isFinite(Number(weights[d])) ? String(weights[d]) : "1";
      input.dataset.deckWeight = d;
      input.addEventListener("change", saveSettingsFromUI);
      field.appendChild(label);
      field.appendChild(input);
      els.deckWeightsList.appendChild(field);
    }
  }

  function formatDueText(dueMs) {
    const now = Date.now();
    if (!dueMs || dueMs <= now) return t("dueNow");
    const diffHours = Math.round((dueMs - now) / (60 * 60 * 1000));
    if (diffHours < 24) return t("dueHours", { n: Math.max(1, diffHours) });
    const diffDays = Math.round(diffHours / 24);
    return t("dueDays", { n: diffDays });
  }

  function renderCardsList() {
    const deckFilter = els.filterDeck.value || "ALL";
    const query = (els.searchQuery.value || "").trim().toLowerCase();

    if (els.deleteDeckBtn) {
      els.deleteDeckBtn.hidden = deckFilter === "ALL";
    }

    const filtered = currentState.cards.filter((c) => {
      if (deckFilter !== "ALL" && c.deck !== deckFilter) return false;
      if (query) {
        const hay = `${c.front} ${c.back} ${c.hint || ""} ${c.deck || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    els.totalCardsCount.textContent = String(filtered.length);
    els.cardsList.innerHTML = "";
    if (els.paginationBar) els.paginationBar.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = t("noCards");
      els.cardsList.appendChild(empty);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    if (els.paginationBar && totalPages > 1) {
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "btn btn-secondary btn-sm";
      prevBtn.textContent = t("prevPage");
      prevBtn.disabled = currentPage <= 1;
      prevBtn.addEventListener("click", () => {
        currentPage -= 1;
        renderCardsList();
      });

      const info = document.createElement("span");
      info.className = "muted";
      info.style.margin = "0 6px";
      info.textContent = t("pageInfo", { page: currentPage, totalPages, total: filtered.length });

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "btn btn-secondary btn-sm";
      nextBtn.textContent = t("nextPage");
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.addEventListener("click", () => {
        currentPage += 1;
        renderCardsList();
      });

      els.paginationBar.appendChild(prevBtn);
      els.paginationBar.appendChild(info);
      els.paginationBar.appendChild(nextBtn);
    }

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
    const frag = document.createDocumentFragment();

    pageItems.forEach((card) => {
      const item = document.createElement("div");
      item.className = "card-item";

      const top = document.createElement("div");
      top.className = "card-item-top";

      const meta = document.createElement("div");
      meta.className = "card-meta";
      const deckTag = document.createElement("span");
      deckTag.className = "deck-tag";
      deckTag.textContent = card.deck || "Default";
      const dueSpan = document.createElement("span");
      dueSpan.textContent = t("cardStatus", { due: formatDueText(card.due), reps: card.reps || 0 });
      meta.appendChild(deckTag);
      meta.appendChild(dueSpan);

      const actions = document.createElement("div");
      actions.className = "card-item-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-secondary btn-sm";
      editBtn.textContent = t("editBtn");
      editBtn.addEventListener("click", () => startEditCard(card));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.textContent = t("deleteBtn");
      delBtn.addEventListener("click", async () => {
        currentState.cards = await Storage.deleteCard(card.id);
        populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
        renderCardsList();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      top.appendChild(meta);
      top.appendChild(actions);

      const front = document.createElement("div");
      front.className = "card-front-text";
      front.textContent = card.front;

      const back = document.createElement("div");
      back.className = "card-back-text";
      back.textContent = card.back;

      item.appendChild(top);
      if (front.textContent) item.appendChild(front);
      if (card.image) {
        const thumb = document.createElement("img");
        thumb.src = card.image;
        thumb.alt = card.front || "card";
        thumb.style.cssText = "max-width:160px;max-height:110px;border-radius:8px;object-fit:contain;margin:4px 0;";
        item.appendChild(thumb);
      }
      item.appendChild(back);
      frag.appendChild(item);
    });
    els.cardsList.appendChild(frag);
  }

  function setCardImagePreview(src) {
    const val = String(src || "").trim();
    if (els.cardImage) els.cardImage.value = val;
    if (els.cardImagePreview) {
      if (val) {
        els.cardImagePreview.src = val;
        els.cardImagePreview.hidden = false;
      } else {
        els.cardImagePreview.removeAttribute("src");
        els.cardImagePreview.hidden = true;
      }
    }
    if (els.clearImageBtn) els.clearImageBtn.hidden = !val;
  }

  function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File read failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(String(reader.result));
        img.onload = () => {
          const maxW = 640;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL("image/webp", 0.82));
          } catch (_e) {
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          }
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function startEditCard(card) {
    els.editCardId.value = card.id;
    els.formTitle.textContent = t("formEditTitle");
    els.cardDeck.value = card.deck || "Default";
    els.cardHint.value = card.hint || "";
    els.cardTags.value = Array.isArray(card.tags) ? card.tags.join(", ") : "";
    setCardImagePreview(card.image || "");
    els.cardFront.value = card.front || "";
    els.cardBack.value = card.back || "";
    els.cancelEditBtn.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetCardForm() {
    els.editCardId.value = "";
    els.formTitle.textContent = t("formAddTitle");
    els.cardHint.value = "";
    els.cardTags.value = "";
    setCardImagePreview("");
    if (els.cardImageFile) els.cardImageFile.value = "";
    els.cardFront.value = "";
    els.cardBack.value = "";
    els.cancelEditBtn.hidden = true;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function saveSettingsFromUI() {
    const deckWeights = {};
    if (els.deckWeightsList) {
      els.deckWeightsList.querySelectorAll("input[data-deck-weight]").forEach((inp) => {
        const val = Number(inp.value);
        deckWeights[inp.dataset.deckWeight] = Number.isFinite(val) && val >= 0 ? val : 1;
      });
    }
    const mutedKeywords = (els.mutedKeywords?.value || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const next = await Storage.saveSettings({
      language: els.language.value || "auto",
      removeDiscoverTab: els.removeDiscoverTab.checked,
      hideExploreNav: els.hideExploreNav.checked,
      hideDiscoverSections: els.hideDiscoverSections.checked,
      ankiEnabled: els.ankiEnabled.checked,
      hideFurigana: els.hideFurigana.checked,
      usageReminderEnabled: els.usageReminderEnabled.checked,
      ytHideRecommendations: els.ytHideRecommendations ? els.ytHideRecommendations.checked : true,
      ytHideShorts: els.ytHideShorts ? els.ytHideShorts.checked : true,
      ytShortsCardInterval: els.ytShortsCardInterval ? Math.max(1, Number(els.ytShortsCardInterval.value) || 3) : 3,
      igHideHomeSuggested: els.igHideHomeSuggested ? els.igHideHomeSuggested.checked : true,
      igHideExplore: els.igHideExplore ? els.igHideExplore.checked : true,
      igHideReels: els.igHideReels ? els.igHideReels.checked : true,
      igReelsCardInterval: els.igReelsCardInterval ? Math.max(1, Number(els.igReelsCardInterval.value) || 3) : 3,
      ankiInterval: Math.max(1, Number(els.ankiInterval.value) || 5),
      ankiMode: els.ankiMode.value || "due-or-all",
      learningStyle: els.learningStyle ? els.learningStyle.value : "anki",
      ankiDirection: els.ankiDirection.value || "front-to-back",
      ankiActiveDeck: els.ankiActiveDeck.value || "ALL",
      ankiDeckWeights: deckWeights,
      dailyGoal: Math.max(1, Number(els.dailyGoal.value) || 20),
      usageReminderIntervalMin: Math.max(1, Number(els.usageReminderIntervalMin.value) || 20),
      usageCheckIntervalSec: els.usageCheckIntervalSec ? Math.max(1, Number(els.usageCheckIntervalSec.value) || 3) : 3,
      overlayCardIntervalSec: els.overlayCardIntervalSec ? Math.max(5, Number(els.overlayCardIntervalSec.value) || 60) : 60,
      mutedKeywords
    });
    currentState.settings = next;
    I18n.applyDomI18n(next.language);
    renderStatsBanner();
    populateDeckSelects(currentState.cards, next.ankiActiveDeck);
    renderCardsList();
    els.settingsMsg.textContent = t("settingsSaved");
    setTimeout(() => {
      els.settingsMsg.textContent = "";
    }, 2000);
  }

  async function init() {
    currentState = await Storage.getState();
    const s = currentState.settings;

    els.language.value = s.language || "auto";
    I18n.applyDomI18n(s.language || "auto");
    renderStatsBanner();

    els.removeDiscoverTab.checked = !!s.removeDiscoverTab;
    els.hideExploreNav.checked = !!s.hideExploreNav;
    els.hideDiscoverSections.checked = !!s.hideDiscoverSections;
    els.ankiEnabled.checked = !!s.ankiEnabled;
    els.hideFurigana.checked = !!s.hideFurigana;
    els.usageReminderEnabled.checked = s.usageReminderEnabled !== false;
    if (els.ytHideRecommendations) els.ytHideRecommendations.checked = s.ytHideRecommendations !== false;
    if (els.ytHideShorts) els.ytHideShorts.checked = s.ytHideShorts !== false;
    if (els.ytShortsCardInterval) els.ytShortsCardInterval.value = s.ytShortsCardInterval || 3;
    if (els.igHideHomeSuggested) els.igHideHomeSuggested.checked = s.igHideHomeSuggested !== false;
    if (els.igHideExplore) els.igHideExplore.checked = s.igHideExplore !== false;
    if (els.igHideReels) els.igHideReels.checked = s.igHideReels !== false;
    if (els.igReelsCardInterval) els.igReelsCardInterval.value = s.igReelsCardInterval || 3;
    els.ankiInterval.value = s.ankiInterval || 5;
    els.ankiMode.value = s.ankiMode || "due-or-all";
    if (els.learningStyle) els.learningStyle.value = s.learningStyle || "anki";
    els.ankiDirection.value = s.ankiDirection || "front-to-back";
    els.dailyGoal.value = s.dailyGoal || 20;
    els.usageReminderIntervalMin.value = s.usageReminderIntervalMin || 20;
    if (els.usageCheckIntervalSec) els.usageCheckIntervalSec.value = s.usageCheckIntervalSec || 3;
    if (els.overlayCardIntervalSec) els.overlayCardIntervalSec.value = s.overlayCardIntervalSec || 60;
    els.mutedKeywords.value = Array.isArray(s.mutedKeywords) ? s.mutedKeywords.join(", ") : "";

    populateDeckSelects(currentState.cards, s.ankiActiveDeck);
    renderCardsList();

    [
      els.language,
      els.removeDiscoverTab,
      els.hideExploreNav,
      els.hideDiscoverSections,
      els.ankiEnabled,
      els.hideFurigana,
      els.usageReminderEnabled,
      els.ytHideRecommendations,
      els.ytHideShorts,
      els.ytShortsCardInterval,
      els.igHideHomeSuggested,
      els.igHideExplore,
      els.igHideReels,
      els.igReelsCardInterval,
      els.ankiInterval,
      els.ankiMode,
      els.learningStyle,
      els.ankiDirection,
      els.ankiActiveDeck,
      els.dailyGoal,
      els.usageReminderIntervalMin,
      els.usageCheckIntervalSec,
      els.overlayCardIntervalSec,
      els.mutedKeywords
    ].forEach((el) => {
      if (el) el.addEventListener("change", saveSettingsFromUI);
    });

    if (els.cardImage) {
      els.cardImage.addEventListener("input", () => setCardImagePreview(els.cardImage.value));
    }
    if (els.cardImageFile) {
      els.cardImageFile.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const dataUrl = await compressImageFile(file);
        setCardImagePreview(dataUrl);
      });
    }
    if (els.clearImageBtn) {
      els.clearImageBtn.addEventListener("click", () => {
        setCardImagePreview("");
        if (els.cardImageFile) els.cardImageFile.value = "";
      });
    }

    els.saveCardBtn.addEventListener("click", async () => {
      const deck = els.cardDeck.value.trim() || "Default";
      const front = els.cardFront.value.trim();
      const back = els.cardBack.value.trim();
      const hint = els.cardHint.value.trim();
      const tags = els.cardTags.value.trim();
      const image = els.cardImage ? els.cardImage.value.trim() : "";

      if ((!front && !image) || !back) {
        els.cardFormMsg.textContent = t("fillFrontBack");
        return;
      }

      const editId = els.editCardId.value;
      if (editId) {
        currentState.cards = await Storage.updateCard(editId, { deck, front, back, hint, tags, image });
        els.cardFormMsg.textContent = t("cardUpdated");
      } else {
        const res = await Storage.addCard({ deck, front, back, hint, tags, image });
        currentState.cards = res.cards;
        els.cardFormMsg.textContent = t("cardAdded");
      }

      resetCardForm();
      populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
      renderCardsList();
    });

    els.cancelEditBtn.addEventListener("click", resetCardForm);

    els.importFile.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      els.importText.value = await file.text();
    });

    els.importBtn.addEventListener("click", async () => {
      try {
        const defaultDeck = els.importDeck.value.trim() || "Imported";
        const parsed = Storage.parseAnkiImportText(els.importText.value, defaultDeck);
        if (parsed.length === 0) {
          els.importMsg.textContent = t("importEmpty");
          return;
        }
        const skipDuplicates = els.skipDuplicates ? els.skipDuplicates.checked : true;
        const res = await Storage.importCards(parsed, { skipDuplicates });
        currentState.cards = res.cards;
        els.importText.value = "";
        els.importMsg.textContent =
          res.skippedCount > 0
            ? t("importSkipped", { added: res.addedCount, skipped: res.skippedCount })
            : t("importDone", { count: res.addedCount });
        populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
        renderCardsList();
      } catch (err) {
        els.importMsg.textContent = t("importError", { msg: err.message });
      }
    });

    if (els.backupBtn) {
      els.backupBtn.addEventListener("click", async () => {
        const backup = await Storage.exportFullBackup();
        downloadBlob(
          JSON.stringify(backup, null, 2),
          `x-focus-anki-backup-${new Date().toISOString().slice(0, 10)}.json`,
          "application/json"
        );
      });
    }

    if (els.restoreBtn && els.restoreFile) {
      els.restoreBtn.addEventListener("click", () => els.restoreFile.click());
      els.restoreFile.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const payload = JSON.parse(await file.text());
          const restored = await Storage.restoreFullBackup(payload);
          currentState = restored;
          await init();
          els.importMsg.textContent = t("restoreDone", { count: restored.cards.length });
        } catch (err) {
          els.importMsg.textContent = t("restoreError", { msg: err.message });
        } finally {
          els.restoreFile.value = "";
        }
      });
    }

    els.exportJsonBtn.addEventListener("click", () => {
      const json = JSON.stringify(currentState.cards, null, 2);
      downloadBlob(json, `x-focus-anki-cards-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    });

    els.exportTsvBtn.addEventListener("click", () => {
      const tsv = currentState.cards
        .map((c) => [c.front, c.back, c.hint || "", (c.tags || []).join(" ")].map((v) => String(v).replace(/[\t\r\n]+/g, " ")).join("\t"))
        .join("\n");
      downloadBlob(tsv, `x-focus-anki-cards-${new Date().toISOString().slice(0, 10)}.tsv`, "text/tab-separated-values;charset=utf-8");
    });

    els.resetProgressBtn.addEventListener("click", async () => {
      currentState.cards = await Storage.resetAllProgress();
      els.importMsg.textContent = t("resetDone");
      populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
      renderCardsList();
    });

    els.filterDeck.addEventListener("change", () => {
      currentPage = 1;
      renderCardsList();
    });
    els.searchQuery.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentPage = 1;
        renderCardsList();
      }, 180);
    });
    if (els.deleteDeckBtn) {
      els.deleteDeckBtn.addEventListener("click", async () => {
        const deck = els.filterDeck.value;
        if (!deck || deck === "ALL") return;
        const count = currentState.cards.filter((c) => c.deck === deck).length;
        if (!confirm(t("confirmDeleteDeck", { deck, count }))) return;
        const remaining = currentState.cards.filter((c) => c.deck !== deck);
        currentState.cards = await Storage.saveCards(remaining);
        els.filterDeck.value = "ALL";
        currentPage = 1;
        populateDeckSelects(currentState.cards, currentState.settings.ankiActiveDeck);
        renderCardsList();
      });
    }
  }

  init();
})();
