import { StashTabType, type D2SharedStash } from './d2i';
import { GD } from './gamedata';
import { GEM_CODES } from './collection';
import { createCompactItem, ItemMode, StorePage, withNewId, withPlacement, withStackSize, type D2Item } from './item';

/**
 * The Reign of the Warlock stackables stash tab on one board, ten columns wide, with one slot per stackable item
 * type: runes El to Zod, then gems by type (Amethyst, Diamond, Emerald, Ruby, Sapphire, Topaz, Skull) from Chipped
 * to Perfect, the two rejuvenation potions, the Pandemonium keys and the Uber Ancients' summoning materials (both
 * two cells tall), the uber organs, the Token of Absolution, the essences and the Worldstone Shards.
 *
 * (The game splits these over Gems, Materials and Runes tabs; one board is quicker to look over.)
 */
export const STACKABLES_COLS = 10;
/** The tab's name in the app. */
export const STACKABLES_LABEL = 'Stackables';

export interface StackSlot {
  code: string;
  x: number;
  y: number;
  h: 1 | 2;
  group: 'rune' | 'gem' | 'potion' | 'key' | 'uber' | 'organ' | 'token' | 'essence' | 'shard';
}

const RUNES = Array.from({ length: 33 }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);
// [chipped, flawed, normal, flawless, perfect]
const GEMS = [
  ['gcv', 'gfv', 'gsv', 'gzv', 'gpv'], // amethyst
  ['gcw', 'gfw', 'gsw', 'glw', 'gpw'], // diamond
  ['gcg', 'gfg', 'gsg', 'glg', 'gpg'], // emerald
  ['gcr', 'gfr', 'gsr', 'glr', 'gpr'], // ruby
  ['gcb', 'gfb', 'gsb', 'glb', 'gpb'], // sapphire
  ['gcy', 'gfy', 'gsy', 'gly', 'gpy'], // topaz
  ['skc', 'skf', 'sku', 'skl', 'skz'], // skull
].flat();

function build(): StackSlot[] {
  const slots: StackSlot[] = [];
  let i = 0;
  const flow = (codes: string[], group: StackSlot['group']) => {
    for (const code of codes) {
      slots.push({ code, x: i % STACKABLES_COLS, y: Math.floor(i / STACKABLES_COLS), h: 1, group });
      i++;
    }
  };
  flow(RUNES, 'rune');
  flow(GEMS, 'gem');
  flow(['rvs', 'rvl'], 'potion');
  // then a tall row: keys and uber ancient materials, with the organs and the token beside them
  const tallRow = Math.ceil(i / STACKABLES_COLS);
  ['pk1', 'pk2', 'pk3'].forEach((code, n) => slots.push({ code, x: n, y: tallRow, h: 2, group: 'key' }));
  ['ua1', 'ua2', 'ua3', 'ua4', 'ua5'].forEach((code, n) => slots.push({ code, x: 3 + n, y: tallRow, h: 2, group: 'uber' }));
  slots.push({ code: 'dhn', x: 8, y: tallRow, h: 1, group: 'organ' });
  slots.push({ code: 'bey', x: 9, y: tallRow, h: 1, group: 'organ' });
  slots.push({ code: 'mbr', x: 8, y: tallRow + 1, h: 1, group: 'organ' });
  slots.push({ code: 'toa', x: 9, y: tallRow + 1, h: 1, group: 'token' });
  i = (tallRow + 2) * STACKABLES_COLS;
  flow(['tes', 'ceh', 'bet', 'fed'], 'essence');
  flow(['xa1', 'xa2', 'xa3', 'xa4', 'xa5'], 'shard');
  return slots;
}

export const STACKABLE_SLOTS: StackSlot[] = build();
export const STACKABLE_CODES: string[] = STACKABLE_SLOTS.map((s) => s.code);
export const STACKABLES_ROWS = Math.max(...STACKABLE_SLOTS.map((s) => s.y + s.h));

export function stackCount(item: D2Item): number {
  // a loose potion can read quantity 0: that's still one item
  return item.advancedStackSize ?? (item.quantity || 1);
}

/**
 * Matches the tab's items to board slots. Items of the same code are summed; anything the board doesn't know
 * (a future patch's new stackable) is returned in `extra` so it is still shown.
 */
export function arrangeStackables(items: D2Item[]): { bySlot: Map<string, { items: D2Item[]; count: number }>; extra: D2Item[] } {
  const known = new Set(STACKABLE_CODES);
  const bySlot = new Map<string, { items: D2Item[]; count: number }>();
  const extra: D2Item[] = [];
  for (const it of items) {
    if (!known.has(it.code)) {
      extra.push(it);
      continue;
    }
    const e = bySlot.get(it.code) ?? { items: [], count: 0 };
    e.items.push(it);
    e.count += stackCount(it);
    bySlot.set(it.code, e);
  }
  return { bySlot, extra };
}

/** The game caps each stackables slot at 99. */
export const STACK_MAX = 99;

export function isBoardStackable(item: D2Item): boolean {
  return STACKABLE_CODES.includes(item.code);
}

export interface StackCheck {
  ok: boolean;
  reason?: string;
}

/** Can `item` (a single item, or a stack from another Stackables tab) be added to the stackables tab? */
export function canStack(stash: D2SharedStash, tab: number, item: D2Item): StackCheck {
  const t = stash.tabs[tab];
  if (!t || t.type !== StashTabType.Advanced) return { ok: false, reason: 'Not a Stackables tab.' };
  if (item.saveVersion !== t.version) return { ok: false, reason: `Item is from a v${item.saveVersion} save; this stash is v${t.version}.` };
  if (!isBoardStackable(item)) return { ok: false, reason: 'Only runes, gems, rejuvenation potions, keys, uber parts, essences, tokens and shards stack here.' };
  if (item.advBit === undefined || item.sockets.length) return { ok: false, reason: "This item can't be stacked." };
  const have = t.items.filter((i) => i.code === item.code).reduce((n, i) => n + stackCount(i), 0);
  if (have + stackCount(item) > STACK_MAX) return { ok: false, reason: `That stack is full (${STACK_MAX} max).` };
  return { ok: true };
}

/** Adds the item to its stack (creating the stack if needed). Mutates the stash; returns the stack item. */
export function addToStack(stash: D2SharedStash, tab: number, item: D2Item): D2Item {
  const chk = canStack(stash, tab, item);
  if (!chk.ok) throw new Error(chk.reason);
  const items = stash.tabs[tab].items;
  const i = items.findIndex((x) => x.code === item.code);
  if (i >= 0) {
    const merged = withStackSize(items[i], stackCount(items[i]) + stackCount(item));
    items[i] = merged;
    return merged;
  }
  const placed = withStackSize(withPlacement(item, { mode: ItemMode.Stored, page: StorePage.Stash, x: 0, y: 0, bodyLoc: 0 }), stackCount(item));
  items.push(placed);
  return placed;
}

/**
 * Takes one item off a stack: the stack shrinks by one (or disappears), and a plain single item is returned
 * for placing elsewhere. Mutates the stash.
 */
export function takeFromStack(stash: D2SharedStash, stackItem: D2Item): D2Item {
  for (const t of stash.tabs) {
    const i = t.items.indexOf(stackItem);
    if (i < 0) continue;
    const n = stackCount(stackItem);
    const plain = withStackSize(stackItem, undefined);
    // the stack keeps its id; a split-off copy of a non-compact item gets its own
    const single = n > 1 ? withNewId(plain) : plain;
    if (n > 1) t.items[i] = withStackSize(stackItem, n - 1);
    else t.items.splice(i, 1);
    return single;
  }
  throw new Error('Stack not found');
}

/** True when the item lives in a Stackables tab of this stash. */
export function inStackablesTab(stash: D2SharedStash, item: D2Item): boolean {
  return stash.tabs.some((t) => t.type === StashTabType.Advanced && t.items.includes(item));
}


/** Each gem type's grades in order, Chipped to Perfect. */
export function gemChains(): string[][] {
  const byType = new Map<string, string[]>();
  for (const code of GEM_CODES) {
    const t = GD.items[code].type;
    byType.set(t, [...(byType.get(t) ?? []), code]);
  }
  return [...byType.values()];
}

export interface GemUpgrade {
  /** Gems made, by the code of the new gem. */
  made: { from: string; to: string; count: number }[];
  /** Grades with three or more gems that couldn't upgrade because the next stack is full. */
  blocked: { from: string; to: string }[];
}

const stackTotal = (t: { items: D2Item[] }, code: string) => t.items.filter((i) => i.code === code).reduce((n, i) => n + stackCount(i), 0);

/** Sets a stack's count (creating, shrinking or removing it). Mutates the tab. */
export function setStack(stash: D2SharedStash, tab: number, code: string, n: number): void {
  const t = stash.tabs[tab];
  const at = t.items.findIndex((i) => i.code === code);
  if (n <= 0) {
    t.items = t.items.filter((i) => i.code !== code);
    return;
  }
  if (at >= 0) {
    const first = t.items[at];
    t.items = t.items.filter((i) => i === first || i.code !== code);
    t.items[t.items.indexOf(first)] = withStackSize(first, n);
    return;
  }
  const fresh = withPlacement(createCompactItem(code, t.version), { mode: ItemMode.Stored, page: StorePage.Stash, x: 0, y: 0, bodyLoc: 0 });
  t.items.push(withStackSize(fresh, n));
}

/** What upgrading the tab's gems would do, without changing anything. */
export function planGemUpgrade(stash: D2SharedStash, tab: number, keep = 1): GemUpgrade {
  const t = stash.tabs[tab];
  const out: GemUpgrade = { made: [], blocked: [] };
  if (!t || t.type !== StashTabType.Advanced) return out;
  for (const chain of gemChains()) {
    const have = chain.map((c) => stackTotal(t, c));
    for (let i = 0; i < chain.length - 1; i++) {
      const sets = Math.max(0, Math.floor((have[i] - keep) / 3)); // `keep` of each grade stay
      const k = Math.min(sets, STACK_MAX - have[i + 1]);
      if (k < sets) out.blocked.push({ from: chain[i], to: chain[i + 1] });
      if (k <= 0) continue;
      have[i] -= 3 * k;
      have[i + 1] += k;
      out.made.push({ from: chain[i], to: chain[i + 1], count: k });
    }
  }
  return out;
}

/**
 * Combines every three gems of one grade into one of the next, lowest grade first so the new gems can combine
 * again, always keeping `keep` of every grade (keep 1: 10 Chipped → 3 Flawed + 1 Chipped; a grade with `keep` or fewer gems isn't touched). A grade whose next stack is full (99) is left as it is. Mutates the stash.
 */
export function upgradeGems(stash: D2SharedStash, tab: number, keep = 1): GemUpgrade {
  const plan = planGemUpgrade(stash, tab, keep);
  const t = stash.tabs[tab];
  if (!plan.made.length) return plan;
  const before = [...t.items];
  try {
    for (const m of plan.made) {
      setStack(stash, tab, m.from, stackTotal(t, m.from) - 3 * m.count);
      setStack(stash, tab, m.to, stackTotal(t, m.to) + m.count);
    }
  } catch (err) {
    t.items = before;
    throw err;
  }
  return plan;
}

export interface RuneRecipe {
  from: string;
  to: string;
  cost: 2 | 3;
  gem?: string;
}

// the gem for each recipe from Thul -> Amn up to Cham -> Zod (cubemain.txt)
const RUNE_GEMS = ['gcy', 'gcv', 'gcb', 'gcr', 'gcg', 'gcw', 'gfy', 'gfv', 'gfb', 'gfr', 'gfg', 'gfw', 'gsy', 'gsv', 'gsb', 'gsr', 'gsg', 'gsw', 'gly', 'gzv', 'glb', 'glr', 'glg'];
const FIRST_GEM_RECIPE = 9; // Thul -> Amn
const FIRST_TWO_RUNE_RECIPE = 20; // Pul -> Um

export const RUNE_RECIPES: RuneRecipe[] = RUNES.slice(0, -1).map((from, i) => ({
  from,
  to: RUNES[i + 1],
  cost: i >= FIRST_TWO_RUNE_RECIPE ? 2 : 3,
  ...(i >= FIRST_GEM_RECIPE ? { gem: RUNE_GEMS[i - FIRST_GEM_RECIPE] } : {}),
}));

/** Pul: the last rune made from three runes, so a default upgrade never spends Pul or higher. */
export const DEFAULT_RUNE_MAX = 'r21';

export interface RuneUpgradeOptions {
  keep?: number;
  maxRune?: string;
}

export interface RuneUpgrade {
  made: (RuneRecipe & { count: number })[];
  /** Recipes with enough runes that were cut short by a full next stack or too few gems. */
  blocked: { from: string; to: string; gem?: string; reason: 'full' | 'gem' }[];
}

const wholeCount = (n: number | undefined, fallback: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : fallback);

export function planRuneUpgrade(stash: D2SharedStash, tab: number, opts: RuneUpgradeOptions = {}): RuneUpgrade {
  const t = stash.tabs[tab];
  const out: RuneUpgrade = { made: [], blocked: [] };
  if (!t || t.type !== StashTabType.Advanced) return out;
  const keep = wholeCount(opts.keep, 1);
  const maxAt = RUNES.indexOf(opts.maxRune ?? DEFAULT_RUNE_MAX);
  const last = maxAt >= 0 ? maxAt : RUNES.indexOf(DEFAULT_RUNE_MAX);
  const have = new Map<string, number>();
  const count = (code: string) => have.get(code) ?? stackTotal(t, code);
  // Repeats because spending a full stack can free room for the recipe below it. `made` stays in
  // run order, so a recipe can appear twice and no stack passes 99 on the way.
  let changed = true;
  while (changed) {
    changed = false;
    out.blocked = [];
    for (const recipe of RUNE_RECIPES) {
      if (RUNES.indexOf(recipe.to) > last) break;
      const sets = Math.max(0, Math.floor((count(recipe.from) - keep) / recipe.cost));
      if (!sets) continue;
      const room = Math.max(0, STACK_MAX - count(recipe.to));
      const gems = recipe.gem ? count(recipe.gem) : Infinity;
      const k = Math.min(sets, room, gems);
      if (k < sets) out.blocked.push({ from: recipe.from, to: recipe.to, gem: recipe.gem, reason: gems < room ? 'gem' : 'full' });
      if (k <= 0) continue;
      have.set(recipe.from, count(recipe.from) - recipe.cost * k);
      have.set(recipe.to, count(recipe.to) + k);
      if (recipe.gem) have.set(recipe.gem, count(recipe.gem) - k);
      out.made.push({ ...recipe, count: k });
      changed = true;
    }
  }
  return out;
}

/** Net of cascades: a rune made by one recipe and used by the next counts on neither side. */
export function runeUpgradeTotals(plan: RuneUpgrade): { made: number; spent: number } {
  const change = new Map<string, number>();
  for (const m of plan.made) {
    change.set(m.from, (change.get(m.from) ?? 0) - m.cost * m.count);
    change.set(m.to, (change.get(m.to) ?? 0) + m.count);
  }
  const deltas = [...change.values()];
  return {
    made: deltas.reduce((n, d) => n + Math.max(d, 0), 0),
    spent: deltas.reduce((n, d) => n + Math.max(-d, 0), 0),
  };
}

export interface StackChange {
  code: string;
  before: number;
  after: number;
}

/** Each rune and gem stack the plan ends up changing, lowest first. A rune made and fully respent isn't listed. */
export function runeUpgradeChanges(stash: D2SharedStash, tab: number, plan: RuneUpgrade): { runes: StackChange[]; gems: StackChange[] } {
  const t = stash.tabs[tab];
  const delta = new Map<string, number>();
  const add = (code: string, n: number) => delta.set(code, (delta.get(code) ?? 0) + n);
  for (const m of plan.made) {
    add(m.from, -m.cost * m.count);
    add(m.to, m.count);
    if (m.gem) add(m.gem, -m.count);
  }
  const changes = [...delta].filter(([, d]) => d !== 0).map(([code, d]) => ({ code, before: stackTotal(t, code), after: stackTotal(t, code) + d }));
  return {
    runes: changes.filter((c) => RUNES.includes(c.code)).sort((a, b) => RUNES.indexOf(a.code) - RUNES.indexOf(b.code)),
    gems: changes.filter((c) => !RUNES.includes(c.code)),
  };
}

/** Runs lowest first so new runes can combine again. Mutates the stash. */
export function upgradeRunes(stash: D2SharedStash, tab: number, opts: RuneUpgradeOptions = {}): RuneUpgrade {
  const plan = planRuneUpgrade(stash, tab, opts);
  const t = stash.tabs[tab];
  if (!plan.made.length) return plan;
  const before = [...t.items];
  try {
    for (const m of plan.made) {
      setStack(stash, tab, m.from, stackTotal(t, m.from) - m.cost * m.count);
      if (m.gem) setStack(stash, tab, m.gem, stackTotal(t, m.gem) - m.count);
      setStack(stash, tab, m.to, stackTotal(t, m.to) + m.count);
    }
  } catch (err) {
    t.items = before;
    throw err;
  }
  return plan;
}
