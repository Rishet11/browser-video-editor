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
            src: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
          },
        },
        {
          id: "bg-video-1",
          layerId: "layer-1",
          type: "video",
          start: 7,
          duration: 8,
          trimIn: 12,
          props: {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
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
            src: "https://images.unsplash.com/photo-1519681393784-d120267933ba",
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
