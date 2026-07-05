(() => {
  "use strict";

  const state = {
    skips: null,
    episodeId: null,
    nextEpisodeId: null,
    episodes: null,
  };

  function post() {
    window.postMessage({ type: "LAFTEL_PLUS_STATE", state }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === "LAFTEL_PLUS_GET") post();
  });

  function findPlaybackInfo(node, depth) {
    if (!node || typeof node !== "object" || depth > 4) return null;
    if (node.op_start != null || node.ed_start != null) return node;
    for (const value of Object.values(node)) {
      const found = findPlaybackInfo(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function findNextEpisodeId(node, depth) {
    if (!node || typeof node !== "object" || depth > 4) return null;
    for (const [key, value] of Object.entries(node)) {
      const k = key.toLowerCase();
      if (/next/.test(k) && /episode/.test(k)) {
        if (typeof value === "number") return value;
        if (value && typeof value === "object" && typeof value.id === "number") {
          return value.id;
        }
      }
      if (value && typeof value === "object") {
        const found = findNextEpisodeId(value, depth + 1);
        if (found != null) return found;
      }
    }
    return null;
  }

  function extractEpisodeList(data) {
    const arr = Array.isArray(data)
      ? data
      : data && Array.isArray(data.results)
        ? data.results
        : null;
    if (!arr || arr.length < 2) return null;
    const episodes = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") return null;
      if (item.id == null || item.episode_num == null) return null;
      episodes.push({ id: item.id, num: parseFloat(item.episode_num) });
    }
    return episodes;
  }

  function scan(data) {
    try {
      let changed = false;
      const info = findPlaybackInfo(data, 0);
      if (info) {
        state.skips = {
          openingStart: info.op_start ?? null,
          openingEnd: info.op_end ?? null,
          endingStart: info.ed_start ?? null,
          endingEnd: info.ed_end ?? null,
        };
        if (info.episode_id != null) state.episodeId = info.episode_id;
        changed = true;
      }
      const next = findNextEpisodeId(data, 0);
      if (next != null) {
        state.nextEpisodeId = next;
        changed = true;
      }
      const episodes = extractEpisodeList(data);
      if (episodes) {
        state.episodes = episodes;
        changed = true;
      }
      if (changed) post();
    } catch (e) {}
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = origFetch.apply(this, args);
    try {
      const input = args[0];
      const url =
        typeof input === "string" ? input : input && input.url ? input.url : "";
      if (/api\.laftel\.net/.test(url)) {
        promise
          .then((res) => {
            res
              .clone()
              .json()
              .then(scan)
              .catch(() => {});
          })
          .catch(() => {});
      }
    } catch (e) {}
    return promise;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__laftelPlusUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      if (!/api\.laftel\.net/.test(this.__laftelPlusUrl || "")) return;
      try {
        const data =
          this.responseType === "json"
            ? this.response
            : JSON.parse(this.responseText);
        if (data) scan(data);
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };
})();
