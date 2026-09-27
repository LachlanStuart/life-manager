import { useSyncExternalStore } from 'react';

export interface SunburstDisplay {
  radialLabels: boolean;
  fontSize: number;
  minFontSize: number;
  labelPadding: number;
  /** Space kept between a radial label and the outside edge of its slice. */
  outerLabelPadding: number;
  minCharacters: number;
  maxDepth: number;
  ringWeights: number[];
}

export const SUNBURST_DISPLAY_KEY = 'life-manager.sunburst-display.v1';
export const DEFAULT_SUNBURST_DISPLAY: SunburstDisplay = {
  radialLabels: true,
  fontSize: 14,
  minFontSize: 9,
  labelPadding: 4,
  outerLabelPadding: 8,
  minCharacters: 3,
  maxDepth: 7,
  ringWeights: [.65, 1, 1.3, 1.5, 1.7, 1.9, 2.1],
};

/** Defaults used for a narrow/touch viewport when no preference has been saved yet. */
export const MOBILE_SUNBURST_DISPLAY: SunburstDisplay = {
  ...DEFAULT_SUNBURST_DISPLAY,
  minFontSize: 5,
  labelPadding: 1,
  outerLabelPadding: 1,
  ringWeights: [...DEFAULT_SUNBURST_DISPLAY.ringWeights],
};

const MOBILE_DISPLAY_MEDIA_QUERY = '(max-width: 700px)';

/**
 * Whether the current browser should receive the compact display defaults.
 * A saved preference always wins; this only selects defaults for missing values.
 */
export function isMobileSunburstDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  ensureResponsiveListeners();
  return mediaQuery?.matches ?? window.innerWidth <= 700;
}

/** Return a fresh copy so callers cannot mutate the shared defaults. */
export function getDefaultSunburstDisplay(): SunburstDisplay {
  const defaults = isMobileSunburstDisplay() ? MOBILE_SUNBURST_DISPLAY : DEFAULT_SUNBURST_DISPLAY;
  return { ...defaults, ringWeights: [...defaults.ringWeights] };
}

function rawStorageValue() {
  try { return globalThis.localStorage?.getItem(SUNBURST_DISPLAY_KEY) ?? null; }
  catch { return null; }
}

let mediaQueryFactory: typeof window.matchMedia | undefined;
let mediaQuery: MediaQueryList | null | undefined;
let mediaListenerAttached = false;
let resizeListenerAttached = false;

const responsiveDisplayChanged = () => {
  // Keep the raw storage cache: explicit saved values still win. The responsive
  // identity below makes missing legacy fields reparse against the new defaults.
  cachedMobile = undefined;
  subscribers.forEach(listener => listener());
};

function detachResponsiveListeners() {
  if (mediaQuery && mediaListenerAttached) {
    const listener = responsiveDisplayChanged;
    if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', listener);
    else mediaQuery.removeListener?.(listener);
    mediaListenerAttached = false;
  }
  if (typeof window !== 'undefined' && resizeListenerAttached) {
    window.removeEventListener('resize', responsiveDisplayChanged);
    resizeListenerAttached = false;
  }
}

function ensureResponsiveListeners() {
  if (typeof window === 'undefined') return;
  const factory = window.matchMedia;
  if (factory !== mediaQueryFactory) {
    detachResponsiveListeners();
    mediaQueryFactory = factory;
    mediaQuery = undefined;
    if (factory) {
      try { mediaQuery = factory.call(window, MOBILE_DISPLAY_MEDIA_QUERY); }
      catch { mediaQuery = null; }
    } else mediaQuery = null;
  }
  if (mediaQuery) {
    if (!mediaListenerAttached && subscribers.size > 0) {
      const listener = responsiveDisplayChanged;
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', listener);
      else mediaQuery.addListener?.(listener);
      mediaListenerAttached = true;
    }
    if (resizeListenerAttached) {
      window.removeEventListener('resize', responsiveDisplayChanged);
      resizeListenerAttached = false;
    }
  } else if (!resizeListenerAttached && subscribers.size > 0) {
    // Older browsers (and a few embedded web views) may not expose matchMedia.
    window.addEventListener('resize', responsiveDisplayChanged);
    resizeListenerAttached = true;
  }
}

function parseDisplay(raw: string | null): SunburstDisplay {
  const defaults = getDefaultSunburstDisplay();
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw) as Partial<SunburstDisplay>;
    if (!value || typeof value !== 'object') return defaults;
    const valid = (key: keyof SunburstDisplay, predicate: (value: number) => boolean): number => {
      const number = value[key];
      return typeof number === 'number' && Number.isFinite(number) && predicate(number)
        ? number : defaults[key] as number;
    };
    return {
      radialLabels: typeof value.radialLabels === 'boolean' ? value.radialLabels : true,
      // Font sizes must remain positive for SVG text layout, but intentionally have
      // no arbitrary upper bound: the settings editor is also useful for testing
      // large charts and unusual viewport sizes.
      fontSize: valid('fontSize', value => value > 0),
      minFontSize: valid('minFontSize', value => value > 0),
      labelPadding: valid('labelPadding', value => value >= 0),
      outerLabelPadding: valid('outerLabelPadding', value => value >= 0),
      minCharacters: Math.max(1, Math.round(valid('minCharacters', value => value >= 1))),
      // Seven is a structural limit: the layout has seven configurable rings.
      maxDepth: Math.min(7, Math.max(1, Math.round(valid('maxDepth', value => value >= 1)))),
      ringWeights: defaults.ringWeights.map((fallback, index) => {
        const weight = value.ringWeights?.[index];
        return typeof weight === 'number' && Number.isFinite(weight)
          ? Math.max(Number.MIN_VALUE, weight) : fallback;
      }),
    };
  } catch { return defaults; }
}

/** Read the persisted display preferences, tolerating unavailable or malformed storage. */
export function readSunburstDisplay(): SunburstDisplay {
  return parseDisplay(rawStorageValue());
}

let cachedRaw: string | null | undefined;
let cachedDisplay: SunburstDisplay | undefined;
let cachedMobile: boolean | undefined;
const subscribers = new Set<() => void>();

function currentDisplay(): SunburstDisplay {
  ensureResponsiveListeners();
  const raw = rawStorageValue();
  const mobile = isMobileSunburstDisplay();
  if (cachedDisplay === undefined || cachedRaw !== raw || cachedMobile !== mobile) {
    cachedRaw = raw;
    cachedMobile = mobile;
    cachedDisplay = parseDisplay(raw);
  }
  return cachedDisplay;
}

/** Persist display preferences and notify all mounted sunbursts immediately. */
export function writeSunburstDisplay(display: SunburstDisplay): void {
  const next = parseDisplay(JSON.stringify(display));
  const raw = JSON.stringify(next);
  cachedDisplay = next;
  try { globalThis.localStorage?.setItem(SUNBURST_DISPLAY_KEY, raw); } catch { /* Private browsing may disable storage. */ }
  // If storage is blocked, retain the in-memory preference for this session.
  // Cache the value that was actually observed so getSnapshot does not discard it.
  cachedRaw = rawStorageValue();
  cachedMobile = isMobileSunburstDisplay();
  subscribers.forEach(listener => listener());
}

export function subscribeSunburstDisplay(listener: () => void): () => void {
  subscribers.add(listener);
  ensureResponsiveListeners();
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) detachResponsiveListeners();
  };
}

export function useSunburstDisplay(): SunburstDisplay {
  return useSyncExternalStore(subscribeSunburstDisplay, currentDisplay, () => DEFAULT_SUNBURST_DISPLAY);
}
