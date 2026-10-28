"use client";
import { useEffect, useRef } from "react";
import "./LoopClip.css";

export type ClipId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** True when autoplay must be skipped: reduced motion or data saver. */
function noAutoplay() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/**
 * Concurrent playback cap: decoding many <video>s at once stalls phones. Small screens play at most 2 clips at a time,
 * larger ones 6. The oldest playing clip yields (pauses) when a new one scrolls in.
 */
const playing: HTMLVideoElement[] = [];
const maxPlaying = () => (window.matchMedia("(max-width: 820px)").matches ? 2 : 6);
function startPlay(v: HTMLVideoElement) {
  const i = playing.indexOf(v);
  if (i > -1) playing.splice(i, 1);
  playing.push(v);
  while (playing.length > maxPlaying()) playing.shift()?.pause();
  v.play().catch(() => {});
}
function stopPlay(v: HTMLVideoElement) {
  const i = playing.indexOf(v);
  if (i > -1) playing.splice(i, 1);
  v.pause();
}

/**
 * A tiny muted looping sample clip in a perforated slip frame with a mono caption.
 * Shows the poster until on screen, plays only while visible, never autoplays under reduced motion or data saver.
 */
export function LoopClip({ n, caption, meta = "0:04", sample = true, className = "", ratio = "3 / 4" }: {
  n: ClipId;
  caption: string;
  meta?: string;
  sample?: boolean;
  className?: string;
  ratio?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === "undefined" || noAutoplay()) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) startPlay(v);
        else stopPlay(v);
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => {
      io.disconnect();
      stopPlay(v);
    };
  }, []);
  return (
    <figure className={`lc ${className}`.trim()}>
      <video
        ref={ref}
        className="lc-vid"
        style={{ aspectRatio: ratio }}
        poster={`/clips/c${n}.jpg`}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
      >
        <source src={`/clips/c${n}.webm`} type="video/webm" />
        <source src={`/clips/c${n}.mp4`} type="video/mp4" />
      </video>
      <figcaption className="lc-cap micro">
        <span>{caption}</span>
        <span>{sample ? `Sample footage · ${meta}` : meta}</span>
      </figcaption>
    </figure>
  );
}
