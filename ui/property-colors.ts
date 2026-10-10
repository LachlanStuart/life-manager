export const PROPERTY_COLORS = [
  { name: 'Blue', value: '#658baa' },
  { name: 'Orange', value: '#c88d51' },
  { name: 'Green', value: '#719477' },
  { name: 'Purple', value: '#9381ad' },
  { name: 'Red', value: '#bd7070' },
  { name: 'Teal', value: '#629b98' },
  { name: 'Yellow', value: '#baa052' },
  { name: 'Pink', value: '#bd809f' },
  { name: 'Terracotta', value: '#c78369' },
  { name: 'Mauve', value: '#a2929b' },
  { name: 'Sand', value: '#a9a48f' },
  { name: 'Gray', value: '#7b8178' },
  { name: 'Light gray', value: '#b4b8ae' },
] as const;

export const DEFAULT_UNSET_COLOR = PROPERTY_COLORS[12].value;

/** Prefer unused colors; balance reuse once the palette is exhausted. */
export function nextPropertyColor(usedColors: string[]): string {
  const usage = new Map<string, number>();
  for (const color of usedColors) {
    const key = color.toLowerCase();
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  return PROPERTY_COLORS.reduce((best, color) =>
    (usage.get(color.value) ?? 0) < (usage.get(best.value) ?? 0) ? color : best).value;
}
