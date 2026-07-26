import type { EDL } from "./edl";

/**
 * Demo composition: 15s, 1920x1080, 3 layers, 5 elements.
 * Visible set at t=0 differs from t=8. Includes one video with non-zero
 * trimIn to demonstrate the trim/split story.
 */
export const SEED_EDL: EDL = {
  id: "seed-edl",
  name: "Demo Composition",
  duration: 15,
  width: 1920,
  height: 1080,
  layers: [
    {
      id: "layer-1",
      name: "Background",
      index: 0,
      elements: [
        {
          id: "bg-image-1",
          layerId: "layer-1",
          type: "image",
          start: 0,
          duration: 7,
          trimIn: 0,
          props: {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            src: "/demo/bg.jpg",
          },
        },
        {
          id: "bg-video-1",
          layerId: "layer-1",
          type: "video",
          start: 7,
          // `/demo/clip.mp4` is 10s long, so trimIn + duration must stay inside
          // that or the element seeks past the end of the source and shows a
          // frozen last frame. Source range used here is 2s..8s.
          duration: 6,
          trimIn: 2,
          props: {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            src: "/demo/clip.mp4",
          },
        },
      ],
    },
    {
      id: "layer-2",
      name: "Overlay",
      index: 1,
      elements: [
        {
          id: "overlay-image-1",
          layerId: "layer-2",
          type: "image",
          start: 2,
          duration: 6,
          trimIn: 0,
          props: {
            x: 1200,
            y: 700,
            w: 600,
            h: 300,
            src: "/demo/overlay.jpg",
          },
        },
      ],
    },
    {
      id: "layer-3",
      name: "Text",
      index: 2,
      elements: [
        {
          id: "title-text-1",
          layerId: "layer-3",
          type: "text",
          start: 0,
          duration: 4,
          trimIn: 0,
          props: {
            x: 100,
            y: 100,
            w: 1000,
            h: 200,
            text: "Welcome",
            css: { fontSize: 72, color: "#ffffff", fontWeight: 700 },
          },
        },
        {
          id: "caption-text-1",
          layerId: "layer-3",
          type: "text",
          start: 8,
          duration: 5,
          trimIn: 0,
          props: {
            x: 100,
            y: 900,
            w: 1200,
            h: 150,
            text: "Big Buck Bunny",
            css: { fontSize: 48, color: "#ffff00", fontWeight: 700 },
          },
        },
      ],
    },
  ],
};
