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

  function maybeGoNext() {
    if (!settings.autoNext || done.next) return;
    const current = state.episodeId;
    const next = resolveNextEpisodeId();
    if (current == null || next == null) {
      console.debug("[Laftel Plus] next episode unknown");
      return;
    }
    const re = new RegExp("(^|[/=])" + current + "(?=[/?#]|$)");
    if (!re.test(location.href)) {
      console.debug("[Laftel Plus] episode id not found in URL:", location.href);
      return;
    }
    done.next = true;
    console.debug("[Laftel Plus] moving to next episode:", next);
    location.href = location.href.replace(re, "$1" + next);
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
    }

    checkSkips(video);
    if (video.ended && video.duration > 0) maybeGoNext();
  }, 1000);
})();
