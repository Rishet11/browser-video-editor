import type { EDL } from "./edl";

/**
 * Safely serialize a value for embedding inside an inline <script> tag.
 * JSON.stringify output can contain `</script`, which would close the tag
 * early if placed raw in HTML (a real injection vector since element props
 * hold user-editable text and src strings).
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Renders a standalone HTML document that plays back the given EDL without
 * any bundler or server. The vanilla-JS block below mirrors the timing
 * contract in src/lib/edl.ts (resolveAt) and src/lib/videoSync.ts exactly,
 * so the exported file and the live editor preview are the same renderer.
 */
export function renderStandaloneHtml(edl: EDL): string {
  const edlJson = serializeForScript(edl);
  const title = escapeHtml(edl.name || "Composition");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; background: #111; height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    font-family: system-ui, sans-serif;
  }
  #stage {
    position: relative;
    overflow: hidden;
    background: black;
    max-width: 100%;
    width: ${edl.width}px;
    aspect-ratio: ${edl.width} / ${edl.height};
  }
  #inner {
    position: absolute;
    top: 0;
    left: 0;
    width: ${edl.width}px;
    height: ${edl.height}px;
    transform-origin: top left;
  }
  #play-btn {
    margin-top: 12px;
    padding: 8px 16px;
    font-size: 14px;
    cursor: pointer;
    display: none;
  }
</style>
</head>
<body>
<div id="stage">
  <div id="inner"></div>
</div>
<button id="play-btn">Play</button>
<script>
const EDL = ${edlJson};
</script>
<script>
// mirrors src/lib/edl.ts resolveAt + src/lib/videoSync.ts — keep in sync
(function () {
  var SEEK_TOLERANCE = 0.15;

  function resolveAt(edl, t) {
    var layersByIndex = edl.layers.slice().sort(function (a, b) { return a.index - b.index; });
    var result = [];
    for (var i = 0; i < layersByIndex.length; i++) {
      var layer = layersByIndex[i];
      for (var j = 0; j < layer.elements.length; j++) {
        var el = layer.elements[j];
        if (el.start <= t && t < el.start + el.duration) {
          var localTime = el.type === "video" ? el.trimIn + (t - el.start) : t - el.start;
          var copy = {};
          for (var k in el) { if (Object.prototype.hasOwnProperty.call(el, k)) copy[k] = el[k]; }
          copy.localTime = localTime;
          result.push(copy);
        }
      }
    }
    return result;
  }

  function needsSeek(currentTime, target) {
    return Math.abs(currentTime - target) > SEEK_TOLERANCE;
  }

  function num(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }
  function str(v, fallback) {
    return typeof v === "string" ? v : fallback;
  }

  var stage = document.getElementById("stage");
  var inner = document.getElementById("inner");
  var playBtn = document.getElementById("play-btn");

  // Paint order comes from the layer index, not from DOM insertion order, so it
  // matches Stage.tsx exactly. The editor needs the explicit z-index because it
  // mounts videos in a separate pass; mirroring it here keeps the two renderers
  // from diverging if either one's build order ever changes.
  var allElements = [];
  var orderedLayers = EDL.layers.slice().sort(function (a, b) { return a.index - b.index; });
  orderedLayers.forEach(function (layer, layerOrder) {
    layer.elements.forEach(function (el, i) {
      allElements.push({ el: el, z: layerOrder * 1000 + i });
    });
  });

  var nodes = {}; // id -> { root, video? }

  // Build every node once, up front. Never recreate them per frame.
  allElements.forEach(function (entryDef) {
    var el = entryDef.el;
    var x = num(el.props.x, 0);
    var y = num(el.props.y, 0);
    var w = num(el.props.w, 100);
    var h = num(el.props.h, 100);

    var root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = x + "px";
    root.style.top = y + "px";
    root.style.width = w + "px";
    root.style.height = h + "px";
    root.style.zIndex = String(entryDef.z);
    root.style.display = "none";

    var entry = { root: root };

    if (el.type === "text") {
      var css = el.props.css && typeof el.props.css === "object" ? el.props.css : {};
      for (var prop in css) {
        if (Object.prototype.hasOwnProperty.call(css, prop)) {
          root.style[prop] = css[prop];
        }
      }
      root.style.position = "absolute";
      root.style.left = x + "px";
      root.style.top = y + "px";
      root.textContent = str(el.props.text, "");
    } else if (el.type === "image") {
      var img = document.createElement("img");
      img.src = str(el.props.src, "");
      img.alt = "";
      img.draggable = false;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      root.appendChild(img);
    } else if (el.type === "video") {
      var video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = str(el.props.src, "");
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      root.appendChild(video);
      entry.video = video;
      // Video nodes persist for the whole session; visibility is toggled
      // via style, never by removing/recreating the node, since remounting
      // a <video> reloads the media and restarts it from zero.
      root.style.opacity = "0";
      root.style.visibility = "hidden";
    }

    nodes[el.id] = entry;
    inner.appendChild(root);
  });

  function resize() {
    var containerWidth = stage.getBoundingClientRect().width;
    var scale = containerWidth > 0 ? containerWidth / EDL.width : 0;
    inner.style.transform = "scale(" + scale + ")";
  }
  window.addEventListener("resize", resize);
  resize();

  var prevVisibleVideoIds = {};
  var autoplayBlocked = false;

  function syncVideos(t) {
    var visible = resolveAt(EDL, t);
    var currentIds = {};
    visible.forEach(function (el) {
      if (el.type !== "video") return;
      currentIds[el.id] = true;
      var entry = nodes[el.id];
      if (!entry || !entry.video) return;
      var video = entry.video;
      var target = el.localTime;
      if (needsSeek(video.currentTime, target)) {
        video.currentTime = target;
      }
      if (video.paused) {
        video.play().catch(function () {
          autoplayBlocked = true;
          playBtn.style.display = "inline-block";
        });
      }
    });
    for (var id in prevVisibleVideoIds) {
      if (!currentIds[id]) {
        var entry2 = nodes[id];
        if (entry2 && entry2.video && !entry2.video.paused) {
          entry2.video.pause();
        }
      }
    }
    prevVisibleVideoIds = currentIds;
  }

  function render(t) {
    var visible = resolveAt(EDL, t);
    var visibleIds = {};
    visible.forEach(function (el) { visibleIds[el.id] = true; });

    for (var id in nodes) {
      var entry = nodes[id];
      var isVisible = !!visibleIds[id];
      if (entry.video) {
        entry.root.style.opacity = isVisible ? "1" : "0";
        entry.root.style.visibility = isVisible ? "visible" : "hidden";
        entry.root.style.display = "block";
      } else {
        entry.root.style.display = isVisible ? "block" : "none";
      }
    }

    syncVideos(t);
  }

  var rafId = null;
  var startTs = null;
  var playing = false;

  function tick(now) {
    if (!playing) return;
    if (startTs === null) startTs = now;
    var t = (now - startTs) / 1000;
    if (t >= EDL.duration) {
      render(EDL.duration - 0.0001 >= 0 ? EDL.duration : 0);
      playing = false;
      rafId = null;
      return;
    }
    render(t);
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (playing) return;
    playing = true;
    startTs = null;
    rafId = requestAnimationFrame(tick);
  }

  playBtn.addEventListener("click", function () {
    playBtn.style.display = "none";
    start();
  });

  render(0);
  start();
  // If the composition has no videos to gate on, or autoplay of the rAF
  // loop itself never got here, still surface the play button as a fallback.
  requestAnimationFrame(function () {
    if (!playing && !autoplayBlocked) {
      playBtn.style.display = "inline-block";
    }
  });
})();
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
