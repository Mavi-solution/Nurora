/**
 * Unit tests for the Persona intake rules.
 *
 * The one that matters: what counts as a "first visit". The form asks
 * for address, area, education and occupation on a first visit and
 * skips them afterwards, so getting this wrong either re-asks a client
 * for details the clinic already holds, or never asks at all.
 *
 *   node scripts/check-persona.mjs
 */
import { ONCE_ONLY_FIELDS, personaState } from "../src/lib/business/persona.ts";

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const blank = {
  background: null,
  presenting_concern: null,
  referral_source: null,
  address: null,
  area: null,
  education: null,
  occupation: null,
  intake_completed_at: null,
};

const client = (over = {}) => ({ ...blank, ...over });

step("A brand-new client is a first visit");
const fresh = personaState(client());
ok("asks for the once-only details", fresh.isFirstVisit);
ok("all four are outstanding", fresh.outstanding.length === 4, fresh.outstanding.join(","));
ok("and the intake is not complete", !fresh.complete);

step("Once the details are on file, a follow-up skips them");
const returning = personaState(
  client({ address: "12 Main St", area: "Adyar", education: "B.Com", occupation: "Teacher" }),
);
ok("no longer a first visit", !returning.isFirstVisit);
ok("nothing outstanding", returning.outstanding.length === 0);

/*
 * The important subtlety. Not every field applies to every client — a
 * client who is not working has no occupation — so "complete" cannot
 * mean all four are non-empty, or the form would nag forever and get
 * ignored. The stamp is what settles it.
 */
step("A stamped intake counts as taken even with a gap");
const partial = client({
  address: "12 Main St",
  area: "Adyar",
  occupation: null,
  education: null,
  intake_completed_at: "2026-09-01T10:00:00.000Z",
});
const stamped = personaState(partial);
ok("not treated as a first visit", !stamped.isFirstVisit);
ok("but the gaps are still reported", stamped.outstanding.length === 2, stamped.outstanding.join(","));

step("Without the stamp, a gap still means a first visit");
const unstamped = personaState(client({ address: "12 Main St", area: "Adyar" }));
ok("still a first visit", unstamped.isFirstVisit);
ok("naming what is left", unstamped.outstanding.join(",") === "education,occupation",
  unstamped.outstanding.join(","));

/*
 * Booked three times before anyone sat down with them. A rule based on
 * counting appointments would have stopped asking; this one does not.
 */
step("Being booked repeatedly does not make the details appear");
ok("a client with no details is a first visit however many times they are booked",
  personaState(client()).isFirstVisit);

step("Complete means the whole form, not just the concern box");
ok("a concern alone is not complete",
  !personaState(client({ presenting_concern: "Anxious" })).complete);
ok("the once-only half alone is not complete",
  !personaState(client({
    address: "x", area: "y", education: "z", occupation: "w",
  })).complete);
ok("everything answered is complete",
  personaState(client({
    background: "Lives alone",
    presenting_concern: "Anxious",
    referral_source: "Doctor or hospital referral",
    address: "x", area: "y", education: "z", occupation: "w",
  })).complete);

step("Whitespace is not an answer");
ok("a field of spaces still counts as outstanding",
  personaState(client({ address: "   " })).outstanding.includes("address"));
ok("and a concern of spaces is not complete",
  !personaState(client({
    background: " ", presenting_concern: "   ", referral_source: "x",
    address: "x", area: "y", education: "z", occupation: "w",
  })).complete);

step("The once-only list is what the form and the stamp agree on");
ok("four fields, named",
  ONCE_ONLY_FIELDS.join(",") === "address,area,education,occupation",
  ONCE_ONLY_FIELDS.join(","));

console.log(failures === 0 ? "\n✓ All persona checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
