"use client";

import { createClient } from "@/lib/supabase/client";

export const ATTACHMENT_BUCKET = "attachments";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Upload one booking attachment and hand back its storage path.
 *
 * The bucket is private, so the path alone grants nothing — the app
 * issues a short-lived signed URL when someone actually needs to open
 * the file.
 *
 * Files are keyed under a random id rather than the original filename:
 * a client's name in a filename would otherwise leak through a path,
 * and two people uploading "recording.m4a" must not collide.
 */
export async function uploadAttachment(
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 25MB.`,
    };
  }

  const supabase = createClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    return {
      ok: false,
      // Storage errors are terse; the common ones are worth translating.
      error: /mime|content type/i.test(error.message)
        ? "That file type is not accepted. Use audio, an image, a PDF or plain text."
        : /exceeded|too large/i.test(error.message)
          ? "That file is too large — the limit is 25MB."
          : error.message,
    };
  }

  return { ok: true, path };
}
