/**
 * Unit tests for the WhatsApp connection diagnosis.
 *
 * This exists because "WhatsApp is not connected — set the Twilio
 * variables" was shown to someone who HAD set them. The cause was a
 * variable created with an empty value: the key is then present in
 * process.env, so it reads as set in every listing, while nothing can
 * send. Telling those two apart is the whole job here.
 *
 *   node scripts/check-twilio-env.mjs
 */
import { whatsappStatus } from "../src/lib/notify/twilio-env.ts";

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const SID = `AC${"0".repeat(32)}`;          // 34 chars, starts AC
const TOKEN = "0".repeat(32);                // 32 chars
const FROM = "whatsapp:+14155238886";

/** Run whatsappStatus() against a specific environment. */
function statusWith(env) {
  const saved = {};
  const names = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"];
  for (const n of names) {
    saved[n] = Object.prototype.hasOwnProperty.call(process.env, n)
      ? process.env[n] : undefined;
    delete process.env[n];
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return whatsappStatus();
  } finally {
    for (const n of names) {
      delete process.env[n];
      if (saved[n] !== undefined) process.env[n] = saved[n];
    }
  }
}

step("A complete, well-formed configuration connects");
const good = statusWith({
  TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: FROM,
});
ok("connected", good.connected, JSON.stringify(good.detail));
ok("nothing reported missing", good.missing.length === 0);
ok("nothing reported malformed", good.malformed.length === 0);
ok("no value is ever echoed back",
  !JSON.stringify(good.detail).includes(TOKEN) &&
  !JSON.stringify(good.detail).includes(SID));

step("A variable that was never created reads as MISSING");
const absent = statusWith({ TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: FROM });
ok("not connected", !absent.connected);
ok("names the one that is absent",
  absent.missing.includes("TWILIO_ACCOUNT_SID"), absent.missing.join(","));
ok("and says MISSING",
  absent.detail.TWILIO_ACCOUNT_SID === "MISSING", absent.detail.TWILIO_ACCOUNT_SID);

/*
 * The actual reported bug. The key exists, so every listing shows the
 * variable as present, and the old code could only say "set the Twilio
 * variables" to someone who plainly had.
 */
step("A variable created with an EMPTY value is told apart from a missing one");
const empty = statusWith({
  TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: FROM,
});
ok("not connected", !empty.connected);
ok("says present but EMPTY, not MISSING",
  /present but EMPTY/.test(empty.detail.TWILIO_ACCOUNT_SID ?? ""),
  empty.detail.TWILIO_ACCOUNT_SID);

const whitespace = statusWith({
  TWILIO_ACCOUNT_SID: "   \n", TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: FROM,
});
ok("whitespace counts as empty too",
  /present but EMPTY/.test(whitespace.detail.TWILIO_ACCOUNT_SID ?? ""),
  whitespace.detail.TWILIO_ACCOUNT_SID);

step("Values in the wrong box are caught");
const swapped = statusWith({
  TWILIO_ACCOUNT_SID: TOKEN, TWILIO_AUTH_TOKEN: SID, TWILIO_WHATSAPP_FROM: FROM,
});
ok("not connected", !swapped.connected);
ok("the SID box is flagged",
  swapped.malformed.includes("TWILIO_ACCOUNT_SID"), JSON.stringify(swapped.detail));
ok("the token box is flagged",
  swapped.malformed.includes("TWILIO_AUTH_TOKEN"), JSON.stringify(swapped.detail));
ok("and the swap is named, not just reported",
  /Auth Token or a Content SID/.test(swapped.detail.TWILIO_ACCOUNT_SID ?? ""),
  swapped.detail.TWILIO_ACCOUNT_SID);

// A Content SID (HX…) is the other thing people paste into the SID box.
const contentSid = statusWith({
  TWILIO_ACCOUNT_SID: `HX${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: FROM,
});
ok("a Content SID in the Account SID box is caught",
  contentSid.malformed.includes("TWILIO_ACCOUNT_SID"), contentSid.detail.TWILIO_ACCOUNT_SID);

step("The sender has to be a dialable number");
for (const [bad, why] of [
  ["+1 415 523 8886", "spaces"],
  ["14155238886", "no plus"],
  ["whatsapp:sandbox", "not a number"],
  ["", "empty"],
]) {
  const r = statusWith({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: bad });
  ok(`rejects ${JSON.stringify(bad)} (${why})`, !r.connected, JSON.stringify(r.detail.TWILIO_WHATSAPP_FROM));
}

step("Both accepted forms of the sender work");
for (const good of ["whatsapp:+14155238886", "+14155238886"]) {
  const r = statusWith({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_WHATSAPP_FROM: good });
  ok(`accepts ${JSON.stringify(good)}`, r.connected, JSON.stringify(r.detail));
}

console.log(failures === 0 ? "\n✓ All Twilio-env checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
