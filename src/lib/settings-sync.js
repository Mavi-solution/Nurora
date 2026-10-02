import { getSupabase } from "./supabase";

/*
 * Practice settings, shared across every device.
 *
 * Unlike the other tables, this is one row holding the whole settings
 * object as JSONB — see the migration's comment for why. There is
 * nothing to translate field-by-field: the value that comes back from
 * Supabase is exactly the `data.settings` object the rest of the app
 * already expects, and saving is exactly that object going back in.
 */
const ROW_ID = "practice";

export async function loadSettings() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from("settings").select("value").eq("id", ROW_ID).limit(1);
  if (error || !data || !data.length) return null;
  return data[0].value;
}

export async function saveSettings(settings) {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("settings").upsert({ id: ROW_ID, value: settings, updated_at: new Date().toISOString() });
}

/** See counsellors-sync.js's claimSeedLock for why this exists: an
 * "is the row there yet" check isn't atomic, and two devices racing it
 * can both decide they're first. Settings happens to be safe from
 * actual duplication either way — `id` is the fixed constant ROW_ID,
 * so a losing insert collides on that primary key and fails cleanly —
 * but it shares the same lock as every other table for consistency. */
async function claimSeedLock(key) {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from("seed_locks").insert({ key });
  return !error;
}

/** First run only: this browser's local settings become the shared
 * ones. */
export async function seedSettingsIfEmpty(localSettings) {
  if (!localSettings) return false;
  if (!(await claimSeedLock("settings"))) return false;
  const supabase = getSupabase();
  const { error } = await supabase.from("settings").insert({ id: ROW_ID, value: localSettings });
  return !error;
}

export function subscribeSettings(onChange) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel("settings-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: `id=eq.${ROW_ID}` }, (payload) => {
      if (payload.new) onChange(payload.new.value);
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
