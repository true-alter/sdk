/**
 * JCS (RFC 8785) canonical JSON under the published profile, and the strict
 * parser that reads wire text into it.
 *
 * The profile is pinned by `vectors/canonical-jcs-v1.json`, which the Python
 * runtime reads as well. Both sides refuse the same inputs:
 *
 *   - a duplicate member name, compared after escape decoding
 *   - an unpaired UTF-16 surrogate, in a value or a member name
 *   - an integer past 2^53-1 in magnitude
 *   - a non-finite number
 *   - containers nested deeper than {@link CANONICAL_MAX_DEPTH}
 *
 * Two of those can only be seen in the TEXT. `JSON.parse` keeps the last of
 * two duplicate members and throws the first away, and it turns every number
 * into a double, so `9007199254740993` arrives as `9007199254740992` with
 * nothing to show it was ever different. Anything reading JSON off the wire
 * that will be canonicalised, hashed or signed should parse it with
 * {@link parseStrictWire}, never with `JSON.parse`. {@link canonicalStringify}
 * applies every bound it can still observe on a value that is already
 * parsed; it cannot detect a duplicate member, because there is none left.
 */

import { AlterCanonicalizationError, type CanonicalRefusal } from './errors.js';

/**
 * Deepest container nesting the profile admits. 64 nested containers are
 * accepted and a 65th is refused. The vector file's `profile.max_depth`
 * carries the same number, and the conformance suite checks the two agree.
 */
export const CANONICAL_MAX_DEPTH = 64;

/** Largest integer magnitude the profile admits, 2^53-1. */
export const CANONICAL_MAX_SAFE_INTEGER = 9007199254740991;

// ECMAScript's Number::toString writes an integral value below 1e21 as plain
// digits and switches to exponent form at 1e21. A value past 2^53-1 in the
// digit range therefore reaches the wire as an integer literal, which a
// strict peer refuses; one at 1e21 or above reaches it as `1e+21`, a double.
const EXPONENT_FORM_FLOOR = 1e21;

function refuse(
  refusal: CanonicalRefusal,
  message: string,
  where: { path?: string; offset?: number } = {},
): never {
  throw new AlterCanonicalizationError(refusal, message, where);
}

// ---------------------------------------------------------------------------
// Canonical serialisation of a parsed value
// ---------------------------------------------------------------------------

/**
 * JCS (RFC 8785) canonical JSON of an already-parsed value.
 *
 *   - object members sorted by UTF-16 code unit, which is what
 *     `Array.prototype.sort` on strings does and what RFC 8785 section 3.2.3
 *     requires; not by code point, and the two disagree whenever a non-BMP
 *     name meets one in U+E000..U+FFFF
 *   - numbers as ECMAScript `Number::toString` writes them
 *   - no whitespace, and non-ASCII passed through unescaped
 *
 * Refuses, with an {@link AlterCanonicalizationError}: an unpaired surrogate,
 * a non-finite number, nesting past {@link CANONICAL_MAX_DEPTH}, and any
 * value JSON cannot represent. Also refuses an integral number from 2^53 up
 * to 1e21 in magnitude. A parsed number no longer says whether it was
 * written as an integer, and a value in that range is written back out as
 * integer digits that a strict peer refuses, so it is refused here rather
 * than signed and rejected downstream. To canonicalise a text such as
 * `1e20`, which the profile admits because it is written as a double, use
 * {@link canonicalizeWireText}.
 *
 * Duplicate member names are NOT detected here and cannot be: a parsed value
 * has already lost them. Parse wire text with {@link parseStrictWire}.
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value, 0, '$', false);
}

function serialize(value: unknown, depth: number, path: string, fromStrictText: boolean): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value, path, fromStrictText);
    case 'string':
      return encodeString(value, path);
    case 'object':
      break;
    default:
      refuse('unsupported_value', `${typeof value} at ${path} is not representable in JSON`, { path });
  }

  if (Array.isArray(value)) {
    checkDepth(depth, path);
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) {
      items.push(serialize(value[i], depth + 1, `${path}[${i}]`, fromStrictText));
    }
    return '[' + items.join(',') + ']';
  }

  // A Date, Map, Set, typed array or boxed primitive would otherwise walk as
  // an object with no members and canonicalise to `{}`, which is not what
  // `JSON.stringify` sends for it, so the digest would describe a different
  // value from the one on the wire.
  const tag = Object.prototype.toString.call(value);
  if (tag !== '[object Object]') {
    refuse('unsupported_value', `${tag.slice(8, -1)} at ${path} is not a plain JSON object`, { path });
  }
  checkDepth(depth, path);
  const obj = value as Record<string, unknown>;
  const names = Object.keys(obj).sort();
  const members: string[] = [];
  for (const name of names) {
    members.push(
      encodeString(name, `${path} member name`) +
        ':' +
        serialize(obj[name], depth + 1, `${path}.${name}`, fromStrictText),
    );
  }
  return '{' + members.join(',') + '}';
}

// `depth` counts the containers enclosing this one, so the check belongs on
// entry to a container: an empty 65th container has no child to carry a
// per-value check down to it.
function checkDepth(depth: number, path: string, offset?: number): void {
  if (depth >= CANONICAL_MAX_DEPTH) {
    refuse('depth_bound', `container nesting deeper than ${CANONICAL_MAX_DEPTH} at ${path}`, {
      path,
      offset,
    });
  }
}

function serializeNumber(n: number, path: string, fromStrictText: boolean): string {
  if (!Number.isFinite(n)) {
    refuse('non_finite_number', `number is not finite at ${path}: ${n}`, { path });
  }
  // A number that came through the strict text parser had its integer
  // literals bounded there, where the literal was still visible.
  if (!fromStrictText && Number.isInteger(n)) {
    const magnitude = Math.abs(n);
    if (magnitude > CANONICAL_MAX_SAFE_INTEGER && magnitude < EXPONENT_FORM_FLOOR) {
      refuse('unsafe_integer', `integer magnitude greater than 2^53-1 at ${path}: ${n}`, { path });
    }
  }
  return JSON.stringify(n);
}

/**
 * JSON string escape per RFC 8785 section 3.2.2.2, which is exactly what
 * `JSON.stringify` does for a well-formed string. An unpaired surrogate is
 * refused rather than escaped: the string is not well-formed Unicode, has no
 * UTF-8 encoding, and a peer hashing the same bytes cannot represent it.
 */
function encodeString(s: string, where: string): string {
  if (!isWellFormed(s)) {
    refuse('unpaired_surrogate', `unpaired UTF-16 surrogate in ${where}: ${JSON.stringify(s)}`, {
      path: where,
    });
  }
  return JSON.stringify(s);
}

/**
 * True when `s` contains no unpaired surrogate. `String.prototype.isWellFormed`
 * is ES2024 and is not assumed, since this package supports older runtimes.
 */
function isWellFormed(s: string): boolean {
  const builtin = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof builtin === 'function') return builtin.call(s);
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff) return false;
    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    if (next < 0xdc00 || next > 0xdfff) return false;
    i++;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Strict wire parser
// ---------------------------------------------------------------------------

/**
 * Parse JSON text with every profile bound applied, reading the text itself
 * rather than handing it to `JSON.parse`.
 *
 * Refuses, with an {@link AlterCanonicalizationError} whose `refusal` names
 * the bound:
 *
 *   - `duplicate_member` for a member name repeated in any object, at any
 *     depth, compared after escape decoding
 *   - `unsafe_integer` for an integer literal past 2^53-1 in magnitude. A
 *     literal written with a fraction or an exponent, such as `1e20` or
 *     `2.5`, is a double and is admitted wherever it is finite
 *   - `non_finite_number` for a literal that overflows, such as `1e400`,
 *     and for the non-JSON tokens `NaN`, `Infinity` and `-Infinity`
 *   - `depth_bound` for containers nested deeper than
 *     {@link CANONICAL_MAX_DEPTH}
 *   - `unpaired_surrogate` for a surrogate with no partner, escaped or raw
 *   - `malformed_json` for anything else that is not JSON, including bytes
 *     that are not UTF-8
 *   - `trailing_content` for anything but whitespace after the value
 *
 * The result is plain data, with every object's members as own enumerable
 * properties, `__proto__` included, exactly as `JSON.parse` would build it.
 */
export function parseStrictWire(text: string | Uint8Array): unknown {
  return new StrictParser(decodeText(text)).parseDocument();
}

/**
 * Parse `text` strictly and return its canonical form. The same result as
 * `canonicalStringify(parseStrictWire(text))` for every input except a
 * double written in exponent or fraction form whose value is an integer
 * from 2^53 up to 1e21, such as `1e20`. The profile admits that literal,
 * and only the text shows it was written as a double, so only this function
 * can canonicalise it. This is the path the published vector suite runs.
 */
export function canonicalizeWireText(text: string | Uint8Array): string {
  return serialize(parseStrictWire(text), 0, '$', true);
}

function decodeText(text: string | Uint8Array): string {
  if (typeof text === 'string') {
    if (!isWellFormed(text)) {
      refuse('unpaired_surrogate', 'text contains an unpaired UTF-16 surrogate');
    }
    return text;
  }
  if (text instanceof Uint8Array) {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
    } catch {
      return refuse('malformed_json', 'bytes are not valid UTF-8');
    }
  }
  return refuse('unsupported_value', 'parseStrictWire expects a string or a Uint8Array');
}

const DIGITS_OF_MAX_SAFE = String(CANONICAL_MAX_SAFE_INTEGER);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

class StrictParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): unknown {
    this.skipWhitespace();
    if (this.pos >= this.text.length) this.fail('empty text');
    const value = this.parseValue(0, '$');
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      refuse('trailing_content', `unexpected content after the JSON value at offset ${this.pos}`, {
        offset: this.pos,
      });
    }
    return value;
  }

  private fail(what: string): never {
    return refuse('malformed_json', `${what} at offset ${this.pos}`, { offset: this.pos });
  }

  private skipWhitespace(): void {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  private parseValue(depth: number, path: string): unknown {
    const c = this.text[this.pos];
    switch (c) {
      case '{':
        return this.parseObject(depth, path);
      case '[':
        return this.parseArray(depth, path);
      case '"':
        return this.parseString(path);
      case 't':
        return this.literal('true', true);
      case 'f':
        return this.literal('false', false);
      case 'n':
        return this.literal('null', null);
      case 'N':
      case 'I':
        return this.nonFinite(path);
      case '-':
        if (this.text.startsWith('-Infinity', this.pos)) return this.nonFinite(path);
        return this.parseNumber(path);
      default:
        if (isDigit(c)) return this.parseNumber(path);
        return this.fail(c === undefined ? 'unexpected end of text' : `unexpected character ${JSON.stringify(c)}`);
    }
  }

  private literal<T>(word: string, value: T): T {
    if (!this.text.startsWith(word, this.pos)) this.fail(`invalid literal, expected ${word}`);
    this.pos += word.length;
    return value;
  }

  // The non-JSON tokens are refused by name, as a peer whose parser admits
  // them refuses them at the number bound.
  private nonFinite(path: string): never {
    for (const word of ['NaN', 'Infinity', '-Infinity']) {
      if (this.text.startsWith(word, this.pos)) {
        return refuse('non_finite_number', `number is not finite at ${path}: ${word}`, {
          path,
          offset: this.pos,
        });
      }
    }
    return this.fail('invalid literal');
  }

  private parseObject(depth: number, path: string): Record<string, unknown> {
    checkDepth(depth, path, this.pos);
    this.pos++; // {
    const obj: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return obj;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') this.fail('expected a member name');
      const nameOffset = this.pos;
      const name = this.parseString(`${path} member name`);
      if (seen.has(name)) {
        refuse('duplicate_member', `duplicate object member name at ${path}: ${JSON.stringify(name)}`, {
          path,
          offset: nameOffset,
        });
      }
      seen.add(name);
      this.skipWhitespace();
      if (this.text[this.pos] !== ':') this.fail("expected ':'");
      this.pos++;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1, `${path}.${name}`);
      // defineProperty, not assignment: assigning `__proto__` would set the
      // prototype instead of creating the member JSON.parse creates.
      Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return obj;
      }
      this.fail("expected ',' or '}'");
    }
  }

  private parseArray(depth: number, path: string): unknown[] {
    checkDepth(depth, path, this.pos);
    this.pos++; // [
    const out: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      out.push(this.parseValue(depth + 1, `${path}[${out.length}]`));
      this.skipWhitespace();
      const c = this.text[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return out;
      }
      this.fail("expected ',' or ']'");
    }
  }

  private parseString(path: string): string {
    const start = this.pos;
    const t = this.text;
    this.pos++; // opening quote
    let out = '';
    let runStart = this.pos;
    for (;;) {
      if (this.pos >= t.length) {
        this.pos = start;
        this.fail('unterminated string');
      }
      const c = t.charCodeAt(this.pos);
      if (c === 0x22) {
        out += t.slice(runStart, this.pos);
        this.pos++;
        break;
      }
      if (c < 0x20) this.fail('unescaped control character in string');
      if (c !== 0x5c) {
        this.pos++;
        continue;
      }
      out += t.slice(runStart, this.pos);
      switch (t[this.pos + 1]) {
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'u': {
          const hex = t.slice(this.pos + 2, this.pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        default:
          this.fail('invalid escape');
      }
      this.pos += 2;
      runStart = this.pos;
    }
    // The text itself is well-formed, so a surrogate left unpaired here came
    // from an escape: `\ud800` alone, or a high and a low escape that are not
    // adjacent.
    if (!isWellFormed(out)) {
      refuse('unpaired_surrogate', `unpaired UTF-16 surrogate in ${path}`, { path, offset: start });
    }
    return out;
  }

  private parseNumber(path: string): number {
    const t = this.text;
    const start = this.pos;
    if (t[this.pos] === '-') this.pos++;
    if (t[this.pos] === '0') {
      this.pos++;
    } else if (isDigit(t[this.pos])) {
      while (isDigit(t[this.pos])) this.pos++;
    } else {
      this.fail('invalid number');
    }
    const intEnd = this.pos;
    let integerLiteral = true;
    if (t[this.pos] === '.') {
      integerLiteral = false;
      this.pos++;
      if (!isDigit(t[this.pos])) this.fail('invalid number, expected a digit');
      while (isDigit(t[this.pos])) this.pos++;
    }
    if (t[this.pos] === 'e' || t[this.pos] === 'E') {
      integerLiteral = false;
      this.pos++;
      if (t[this.pos] === '+' || t[this.pos] === '-') this.pos++;
      if (!isDigit(t[this.pos])) this.fail('invalid number, expected a digit');
      while (isDigit(t[this.pos])) this.pos++;
    }
    const literal = t.slice(start, this.pos);
    if (integerLiteral) {
      // JSON forbids leading zeros, so digit count orders magnitude and an
      // equal-length string compare settles the rest, with no rounding.
      const digits = t.slice(t[start] === '-' ? start + 1 : start, intEnd);
      if (
        digits.length > DIGITS_OF_MAX_SAFE.length ||
        (digits.length === DIGITS_OF_MAX_SAFE.length && digits > DIGITS_OF_MAX_SAFE)
      ) {
        refuse('unsafe_integer', `integer magnitude greater than 2^53-1 at ${path}: ${literal}`, {
          path,
          offset: start,
        });
      }
    }
    const n = Number(literal);
    if (!Number.isFinite(n)) {
      refuse('non_finite_number', `number is not finite at ${path}: ${literal}`, { path, offset: start });
    }
    return n;
  }
}
