(() => {
  "use strict";

  const DEFAULTS = {
    autoNext: true,
    skipOpening: true,
    skipEnding: true,
  };

  let settings = { ...DEFAULTS };

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
  });

  const EMPTY_STATE = {
    skips: null,
    episodeId: null,
    nextEpisodeId: null,
    episodes: null,
  };

  let state = { ...EMPTY_STATE };
  let stateReceivedAt = 0;
  const done = { opening: false, ending: false, next: false };
  let currentHref = location.href;

  const FS_FLAG = "laftelPlusFS";
  const FS_SELECTOR = "laftelPlusFSSel";
  let wantFullscreen = false;
  let fsSelector = null;

  try {
    if (sessionStorage.getItem(FS_FLAG) === "1") {
      wantFullscreen = true;
      fsSelector = sessionStorage.getItem(FS_SELECTOR);
    }
  } catch (e) {}

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== "LAFTEL_PLUS_STATE" || !data.state) return;
    const prevEpisode = state.episodeId;
    state = { ...EMPTY_STATE, ...data.state };
    stateReceivedAt = Date.now();
    if (state.episodeId !== prevEpisode) {
      done.opening = false;
      done.ending = false;
      done.next = false;
    }
  });

  window.postMessage({ type: "LAFTEL_PLUS_GET" }, "*");

  function hasMeta(category) {
    if (!state.skips) return false;
    if (category === "opening") {
      return state.skips.openingStart != null && state.skips.openingEnd != null;
    }
    return state.skips.endingStart != null;
  }

  function checkSkips(video) {
    if (!video || !state.skips || !video.duration) return;
    const t = video.currentTime;

    if (settings.skipOpening && hasMeta("opening")) {
      const { openingStart, openingEnd } = state.skips;
      if (t < openingStart - 1) done.opening = false;
      if (
        !done.opening &&
        openingEnd > openingStart &&
        openingEnd <= video.duration &&
        t >= openingStart &&
        t < openingEnd - 1
      ) {
        done.opening = true;
        video.currentTime = openingEnd;
        console.debug("[Laftel Plus] opening skipped ->", openingEnd);
      }
    }

    if (settings.skipEnding && hasMeta("ending")) {
      const { endingStart, endingEnd } = state.skips;
      if (t < endingStart - 1) done.ending = false;
      const target =
        endingEnd != null &&
        endingEnd > endingStart &&
        endingEnd < video.duration - 1
          ? endingEnd
          : video.duration;
      if (!done.ending && t >= endingStart && t < target - 1) {
        done.ending = true;
        video.currentTime = target;
        console.debug("[Laftel Plus] ending skipped ->", target);
      }
    }
  }

  function resolveNextEpisodeId() {
    const { episodeId, nextEpisodeId, episodes } = state;
    if (nextEpisodeId != null && nextEpisodeId !== episodeId) {
      return nextEpisodeId;
    }
    if (episodeId == null || !Array.isArray(episodes)) return null;
    const index = episodes.findIndex((e) => e.id === episodeId);
    if (index === -1) return null;
    const current = episodes[index];
    if (isFinite(current.num)) {
      const later = episodes
        .filter((e) => isFinite(e.num) && e.num > current.num)
        .sort((a, b) => a.num - b.num);
      if (later.length) return later[0].id;
    }
    if (index + 1 < episodes.length) return episodes[index + 1].id;
    return null;
  }

  function episodeIdPattern(id) {
    return new RegExp("(^|[/=])" + id + "(?=[/?#]|$)");
  }

  function findNextEpisodeAnchor(nextId) {
    const re = episodeIdPattern(nextId);
    for (const a of document.querySelectorAll("a[href]")) {
      if (re.test(a.getAttribute("href") || "")) return a;
    }
    return null;
  }

  function selectorFor(el) {
    if (!el || el === document.documentElement || el === document.body) return null;
    if (el.tagName === "VIDEO") return "VIDEO";
    const classes =
      typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    if (!classes.length) return null;
    return el.tagName.toLowerCase() + "." + classes.map((c) => CSS.escape(c)).join(".");
  }

  function playerContainer(video) {
    let el = video;
    let best = video;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      el = el.parentElement;
      if (el === document.body) break;
      if (el.clientWidth >= best.clientWidth && el.clientHeight >= best.clientHeight) {
        best = el;
      }
    }
    return best;
  }

  async function switchFullscreenTo(video) {
    let target = null;
    if (fsSelector === "VIDEO") target = video;
    else if (fsSelector) target = document.querySelector(fsSelector);
    if (!target) target = playerContainer(video);
    if (!target) return;
    try {
      if (document.fullscreenElement !== target) await target.requestFullscreen();
      console.debug("[Laftel Plus] fullscreen restored");
    } catch (e) {
      console.debug("[Laftel Plus] fullscreen restore blocked:", e && e.message);
    }
  }

  function clearFsFlags() {
    try {
      sessionStorage.removeItem(FS_FLAG);
      sessionStorage.removeItem(FS_SELECTOR);
    } catch (e) {}
  }

  function handleFullscreenAfterNav(video) {
    if (!wantFullscreen) return;
    wantFullscreen = false;
    clearFsFlags();
    switchFullscreenTo(video);
  }

  async function maybeGoNext() {
    if (!settings.autoNext || done.next) return;
    const current = state.episodeId;
    const next = resolveNextEpisodeId();
    if (current == null || next == null) {
      console.debug("[Laftel Plus] next episode unknown");
      return;
    }
    const re = episodeIdPattern(current);
    if (!re.test(location.href)) {
      console.debug("[Laftel Plus] episode id not found in URL:", location.href);
      return;
    }
    done.next = true;
    const targetUrl = location.href.replace(re, "$1" + next);
    const before = location.href;
    console.debug("[Laftel Plus] moving to next episode:", next);

    // 전체화면 상태라면, 플레이어가 리마운트돼도 전체화면이 사라지지 않도록
    // 먼저 documentElement로 전체화면을 옮겨둔다. (이미 전체화면일 때의 대상
    // 요소 전환은 사용자 제스처 없이 허용됨) 새 화 로드 후 실제 플레이어로 되돌린다.
    const fsEl = document.fullscreenElement;
    if (fsEl) {
      wantFullscreen = true;
      fsSelector = selectorFor(fsEl);
      try {
        sessionStorage.setItem(FS_FLAG, "1");
        if (fsSelector) sessionStorage.setItem(FS_SELECTOR, fsSelector);
      } catch (e) {}
      try {
        await document.documentElement.requestFullscreen();
      } catch (e) {
        console.debug("[Laftel Plus] keep-fullscreen failed:", e && e.message);
      }
    }

    // 1) 라프텔의 다음 화 링크를 클릭 → SPA 내부 이동(문서 유지)
    const anchor = findNextEpisodeAnchor(next);
    if (anchor) {
      anchor.click();
    } else {
      // 2) 링크를 못 찾으면 History API로 라우터를 직접 트리거
      history.pushState({}, "", targetUrl);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }

    // 3) 소프트 네비게이션이 안 먹히면 하드 리로드로 폴백(이동은 보장)
    setTimeout(() => {
      if (location.href === before) location.href = targetUrl;
    }, 2500);
  }

  document.addEventListener(
    "timeupdate",
    (event) => {
      if (event.target instanceof HTMLVideoElement) checkSkips(event.target);
    },
    true
  );

  document.addEventListener(
    "ended",
    (event) => {
      if (event.target instanceof HTMLVideoElement) maybeGoNext();
    },
    true
  );

  function collectVideos(root, acc, depth) {
    if (depth > 6) return;
    for (const v of root.querySelectorAll("video")) acc.push(v);
    if (acc.length) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) collectVideos(el.shadowRoot, acc, depth + 1);
    }
  }

  function locateVideo() {
    const acc = [];
    collectVideos(document, acc, 0);
    let best = null;
    for (const v of acc) {
      if (!best || (v.duration || 0) > (best.duration || 0)) best = v;
    }
    return best;
  }

  let attachedVideo = null;

  setInterval(() => {
    if (location.href !== currentHref) {
      currentHref = location.href;
      done.opening = false;
      done.ending = false;
      done.next = false;
      if (Date.now() - stateReceivedAt > 3000) state = { ...EMPTY_STATE };
    }

    const video = locateVideo();
    if (!video) return;

    if (video !== attachedVideo) {
      attachedVideo = video;
      video.addEventListener("timeupdate", () => checkSkips(video));
      video.addEventListener("ended", () => maybeGoNext());
      handleFullscreenAfterNav(video);
    } else if (
      wantFullscreen &&
      document.fullscreenElement === document.documentElement
    ) {
      handleFullscreenAfterNav(video);
    }

    checkSkips(video);
    if (video.ended && video.duration > 0) maybeGoNext();
  }, 1000);
})();
