/**
 * Unit tests for phone-number handling. No browser, no database.
 *
 * These exist because the field regressed in a way a UI test could not
 * catch: every browser check used fill(), which sets a value in one
 * shot, while a person types one character at a time. The rules below
 * are the ones that actually decide whether a client's reminder can be
 * delivered.
 *
 *   node scripts/check-phone-input.mjs
 */
import {
  DIALING_CODES,
  joinDialingCode,
  normalisePhoneInput,
  splitDialingCode,
} from "../src/lib/dialing-codes.ts";
import { toE164 } from "../src/lib/notify/phone.ts";

// validation.ts is not imported directly: it reaches phone.ts through
// an extensionless specifier, which Node's type-stripping loader
// cannot resolve. toE164 is the rule that actually matters here — a
// number is dialable exactly when it normalises to itself.

let failures = 0;
const step = (n) => console.log(`\n▸ ${n}`);
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  }
}
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

/* ------------------------------------------------------------- splitting */

step("splitDialingCode reads a code off a number that declares one");
check("plain Indian mobile is local, not +98",
  splitDialingCode("9840011223"), { code: "91", national: "9840011223" });
check("+91 is recognised",
  splitDialingCode("+919840011223"), { code: "91", national: "9840011223" });
check("00 is the international prefix too",
  splitDialingCode("00919840011223"), { code: "91", national: "9840011223" });
check("spaces and brackets do not confuse it",
  splitDialingCode("+91 (98400) 11223"), { code: "91", national: "9840011223" });
check("empty stays empty",
  splitDialingCode(""), { code: "91", national: "" });
check("null is safe",
  splitDialingCode(null), { code: "91", national: "" });

// Longest-match, not first-match. "+971" must not be read as "+97"
// or "+9", and "+1" must not swallow "+91".
step("longest match wins, so the Gulf is not read as India");
check("UAE", splitDialingCode("+971501234567"), { code: "971", national: "501234567" });
check("Qatar", splitDialingCode("+97412345678"), { code: "974", national: "12345678" });
check("USA", splitDialingCode("+12125550123"), { code: "1", national: "2125550123" });
check("UK", splitDialingCode("+447700900123"), { code: "44", national: "7700900123" });

/* -------------------------------------------------------------- joining */

step("joinDialingCode produces storable E.164");
check("basic", joinDialingCode("91", "9840011223"), "+919840011223");
check("a trunk zero is dropped", joinDialingCode("91", "09840011223"), "+919840011223");
check("formatting is stripped", joinDialingCode("91", "98400 11223"), "+919840011223");
check("nothing typed means nothing stored", joinDialingCode("91", ""), "");
check("only a zero is nothing", joinDialingCode("91", "0"), "");

/* --------------------------------------------------------- normalising */

step("normalisePhoneInput fixes what people actually type");
check("an international number pasted into the national box moves the code",
  normalisePhoneInput("91", "+971 50 123 4567"), { code: "971", national: "501234567" });
check("00 form too",
  normalisePhoneInput("91", "00971501234567"), { code: "971", national: "501234567" });
check("the country code typed AS WELL as selected is de-duplicated",
  normalisePhoneInput("91", "919840011223"), { code: "91", national: "9840011223" });
check("a lone + is not a number",
  normalisePhoneInput("91", "+"), { code: "91", national: "" });
check("what is already right is left alone",
  normalisePhoneInput("91", "9840011223"), { code: "91", national: "9840011223" });

/*
 * The trap. Indian mobiles begin 6-9, so 9123456789 is a perfectly
 * ordinary number that happens to start with the country's own code.
 * Stripping it on a prefix match would silently turn a real client's
 * number into an undialable one — which is worse than not tidying at
 * all, because nothing would look wrong.
 */
step("a local number that happens to start with its own country code survives");
check("9123456789 keeps all ten digits",
  normalisePhoneInput("91", "9123456789"), { code: "91", national: "9123456789" });
check("and still stores correctly",
  joinDialingCode("91", normalisePhoneInput("91", "9123456789").national),
  "+919123456789");
check("911234567890 IS the code twice (12 digits)",
  normalisePhoneInput("91", "911234567890"), { code: "91", national: "1234567890" });

// Same shape, a country whose national length we do not claim to know:
// no guess is made, because a wrong guess breaks a real number.
step("no de-duplication where the national length is not known");
const germany = DIALING_CODES.find((c) => c.iso === "DE");
ok("Germany is listed without a fixed national length", germany && germany.nsn === undefined);
check("so a German number is left exactly as typed",
  normalisePhoneInput("49", "4915123456789"),
  { code: "49", national: "4915123456789" });

/* ------------------------------------------------- round trip to storage */

step("what the field stores is what the sender can dial");
for (const typed of [
  "9840011223",
  "+91 98400 11223",
  "098400 11223",
  "919840011223",
  "+971 50 123 4567",
]) {
  const tidy = normalisePhoneInput("91", typed);
  const stored = joinDialingCode(tidy.code, tidy.national);
  ok(`${JSON.stringify(typed)} -> ${stored}`,
    Boolean(stored) && toE164(stored) === stored,
    `stored ${stored}, toE164 ${toE164(stored)}`);
}

/* --------------------------------------------------------- the list itself */

step("the dialling-code list is coherent");
ok("India is first, and is the default", DIALING_CODES[0].code === "91");
ok("every code is digits only", DIALING_CODES.every((c) => /^\d{1,4}$/.test(c.code)));
ok("every entry has a name and an ISO code",
  DIALING_CODES.every((c) => c.name.length > 1 && /^[A-Z]{2}$/.test(c.iso)));
ok("no duplicate countries",
  new Set(DIALING_CODES.map((c) => c.iso)).size === DIALING_CODES.length);
ok("declared national lengths are plausible",
  DIALING_CODES.every((c) => c.nsn === undefined || (c.nsn >= 6 && c.nsn <= 12)));
ok("the Gulf, the anglophone diaspora and Europe are covered",
  ["971", "44", "1", "61", "65", "60"].every((code) =>
    DIALING_CODES.some((c) => c.code === code)));

console.log(failures === 0 ? "\n✓ All phone-input checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
