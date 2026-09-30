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

/** First run only: this browser's local settings become the shared
 * ones. Guarded by the caller checking the row doesn't exist yet. */
export async function seedSettingsIfEmpty(localSettings) {
  const supabase = getSupabase();
  if (!supabase || !localSettings) return false;
  const { data } = await supabase.from("settings").select("id").eq("id", ROW_ID).limit(1);
  if (data && data.length) return false;
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
