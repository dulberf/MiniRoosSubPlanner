import { useState, useEffect } from 'react';
import { DESIGN_WIDTH } from './constants.js';

// The sideline redesign is specified at 1024px wide. Rather than reflowing at
// breakpoints (which would break the pitch/rail split the coach reads at a
// glance), every size is multiplied by a single factor derived from the
// viewport. The 10.2" iPad used at the field is 810 x 1080 — the same 3:4
// aspect ratio as the 1024 x 1366 design — so a uniform 0.79 maps the whole
// layout across with no repositioning.
//
// Clamped: below 0.55 the type drops under the 15px legibility floor the
// design is built around, and above 1.15 a desktop browser just looks silly.
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.15;

export function getScale(width) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, width / DESIGN_WIDTH));
}

export default function useScale() {
  const [scale, setScale] = useState(() =>
    getScale(typeof window === 'undefined' ? DESIGN_WIDTH : window.innerWidth)
  );

  useEffect(() => {
    const measure = () => setScale(getScale(window.innerWidth));
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  // s(px) converts a design-space size to a device-space size.
  const s = (px) => Math.round(px * scale);
  return { scale, s };
}
