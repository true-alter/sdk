#!/usr/bin/env python3
# CORE_INTENT: refuse a commit that changes something more than one module
#   reads, until the commit either touches every consumer or NAMES the ones
#   deliberately left alone.
# EFFECTIVENESS_METRIC: every fire, every discharge and every skip is appended
#   to ~/.local/share/alter/cc/consumer-sweep-gate/events.log, so the fire rate
#   and the escape rate are both measurable rather than argued about. A gate
#   whose discharge rate approaches 1.0 is crying wolf and the log is what
#   shows it.
# SCOPE_PREDICATE: commit-msg stage, staged diff touches a code file that is
#   not a test/fixture/migration, an anchor symbol on a changed line is defined
#   in the repo and read by 2..FANOUT_CEILING non-test modules, and at least one
#   of those modules is neither staged nor named in the commit message.
# SUBSTRATE_SCOPE: monorepo PLUS every sibling armed by
#   scripts/install-consumer-sweep-sibling.sh. core.hooksPath points every
#   worktree of this repo at the primary checkout's .githooks, so this covers
#   every commit made in the monorepo and its worktrees, by a session or a
#   subagent alike. Sibling repos are covered once armed, and the installer's
#   --check face is how a repo's arming is read rather than assumed.
#
#   THE SIBLING NON-REACH WAS STATED HERE AND HAS BEEN CLOSED, 2026-09-12. The
#   original note said siblings sit on their own .git/hooks. Measured, the
#   landscape is three-way, not two-way: seven siblings resolve core.hooksPath
#   to their own .githooks, five resolve to the global ~/.config/git/hooks,
#   eleven sit on .git/hooks and one runs husky. The note was closed rather than
#   corrected in place because the credential-shape regression this gate exists
#   to catch happened on 2026-09-12 in substrate and alter-cli, both outside the
#   reach the note described as acceptable.
#
#   THE DISPATCHER IS THE HALF THAT DECIDED THE FIX. No sibling carried a
#   commit-msg dispatcher at all, so copying this module alone would have
#   installed a file git never invokes, which reads exactly like a passing gate.
#   The installer writes the dispatcher and then asks git where it will look.
#
#   THE COMMIT PATHS THIS STILL DOES NOT REACH, asked at the class rather than
#   the member, per selection-cc-fixes-gate-defects-unprompted-and-at-the-class-
#   rather-than-the-member-2026-09-08:
#     - a squash-merge performed on the remote, which runs no local hook. Every
#       commit inside it was gated as it was authored, so the PR is covered by
#       construction rather than by this file.
#     - a sibling that has not been armed, readable with the installer's
#       --check face rather than presumed either way.
#     - --no-verify and hooksPath redirection, already the banned class.
#   Because core.hooksPath is an ABSOLUTE path into the primary checkout, this
#   gate goes live for every worktree at the moment the primary checkout's
#   working copy carries it, not at the moment this branch lands.
#
# consumer-sweep.py, the mechanical rung under
# blake-selection-the-consumer-sweep-becomes-a-mechanical-gate-because-the-fix
# -the-named-surface-and-miss-the-real-one-class-recurred-twice-in-one-session
# -2026-09-09.
#
# THE CLASS. Twice in one session, ninety minutes apart, a correct fix landed on
# one of several surfaces carrying the same thing, and nothing anywhere asked
# which other surface carried it. Both times the tests passed and the fix was
# real. A mutation proof is the strongest evidence about the property tested and
# says nothing about whether it is the right property, so no amount of test
# discipline reaches this class; only an instrument that reads the OTHER files
# does.
#
#   ONE: contract storage changed to hold a commitment instead of raw recovery
#   factor keys, three tests written, one mutation-proven. The same raw keys
#   ride in public enrolment calldata, which no test touched.
#
#   TWO: the pending-factor read path was fixed to require attestation; the
#   claim path, which is the one that actually reaches the chain, was left
#   building its permit off the raw pending store.
#
# WHY THE NAMING ESCAPE IS THE HALF THAT DECIDES THIS. A gate that cries wolf
# gets routed around: the dispatch-path gate has denied 511 times across 74
# sessions because every session patched its prompt at the point of refusal and
# carried nothing forward. So the refusal here PRINTS THE READY-MADE TRAILER
# with every unswept consumer already listed. Satisfying the gate is pasting one
# line, and the only work it actually demands is reading the list, which is
# exactly the work the class needs done. Compliance cost is deliberately as
# close to the cost of looking as it can be made.
#
# WHY commit-msg AND NOT PreToolUse-on-Edit. A per-edit gate cannot know whether
# the other consumer is about to be edited in the next tool call, so it would
# fire on every intermediate state of every multi-file change. That is the
# 511-denial outcome arriving by a different road. The commit is the first
# moment the change is a complete set, and it is also the only stage that can
# read the naming escape, because the escape lives in the commit message.
#
# FAIL CLOSED ON FINDINGS, FAIL OPEN ON INFRASTRUCTURE. A finding refuses the
# commit. A missing git, an unreadable index, a grep that exceeds the time
# budget, or any unexpected exception passes the commit and logs the reason. A
# commit hook that can wedge gets disabled permanently and then guards nothing.

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time

# --- Tuning -----------------------------------------------------------------
#
# Every number here is a precision/recall dial. They are named and gathered so a
# later session tunes them against the events log rather than re-deriving them.

CODE_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".sol", ".go", ".rs")

# Paths whose consumers are not the kind this class is about. A test that reads
# the changed symbol is EXPECTED to be left alone by a behaviour change, and
# firing on tests would put a false consumer in front of every refusal.
EXCLUDE_FRAGMENTS = (
    "/test_",
    "/tests/",
    "test_",
    "_test.",
    ".test.",
    ".spec.",
    "/__tests__/",
    "/fixtures/",
    "/mocks/",
    "/__mocks__/",
    "conftest.py",
    "/node_modules/",
    "/dist/",
    "/build/",
    "/.next/",
    "/vendor/",
    "/__pycache__/",
    "/migrations/",
    "/alembic/",
    ".d.ts",
    "/coverage/",
    "/.venv/",
    "/venv/",
    "/site-packages/",
)

# An identifier shorter than this is noise in every language here.
MIN_SYMBOL_LEN = 5

# A symbol read by more modules than this is infrastructure, not a surface pair.
# Firing on it would put twenty paths in front of a one-line change and teach
# the reader to stop reading the list, which is the failure mode this gate is
# most exposed to.
FANOUT_CEILING = 12

# Below this, "more than one module reads it" is not satisfied.
FANOUT_FLOOR = 2

# A module stem found in more files than this is a common word, not a module
# reference, so linkage through it is not evidence of anything.
STEM_DISCRIMINATION_CEILING = 20

# Bound on anchor symbols carried into the grep. Beyond it the commit is broad
# enough that a per-symbol consumer list would be unreadable anyway.
MAX_ANCHORS = 60

# Global anchor budget for one commit. Beyond it the sweep is bounded and
# SAYS SO, rather than running past the hook's time budget and failing open
# with no account of what went unchecked.
MAX_TOTAL_ANCHORS = 300

# Hard wall-clock budget. Past it the gate passes the commit and logs a timeout.
DEFAULT_TIMEOUT_S = 12.0

STOPWORDS = frozenset(
    """
abstract, and, args, array, assert, async, await, boolean, break, bytes, calldata,
case, catch, class, const, constructor, continue, data, def, default, delete,
elif, else, emit, enum, error, event, except, exports, extends, external, false,
final, finally, float, for, from, function, global, if, immutable, implements,
import, index, indexed, instanceof, int, interface, internal, is, item, items,
lambda, let, list, mapping, memory, module, new, none, nonpayable, not, null,
number, object, or, override, pass, payable, pragma, print, private, protected,
public, pure, raise, require, result, results, return, returns, revert, self,
solidity, static, storage, str, string, struct, super, switch, this, throw,
true, try, tuple, type, typeof, undefined, union, unless, using, value, values,
var, view, virtual, void, while, with, yield, params, param, kwargs, options,
config, context, request, response, session, logger, logging, output, input,
target, source, length, message, status, format, update, create, delete_,
""".replace("\n", "").split(",")
)
STOPWORDS = frozenset(w.strip() for w in STOPWORDS if w.strip())

IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def quoted(text: str, match: re.Match) -> bool:
    """True when the identifier is a bare string literal, e.g. `"claimed_at"`.

    A dict key that happens to spell an ORM column is not a module reading that
    column, and counting it as one produced a false consumer on a real commit:
    `micro_mirror.py` writing `"claimed_at": now` was reported as an untouched
    reader of `assessment.py`'s `claimed_at` column.
    """
    start, end = match.span()
    before = text[start - 1] if start > 0 else ""
    after = text[end] if end < len(text) else ""
    return before in ("'", '"') and after in ("'", '"')


TRAILER_RE = re.compile(r"^\s*consumers[-_ ]considered\s*:\s*(.*)$", re.IGNORECASE)


# A grep hit counts as a DEFINITION of the symbol when it matches one of these.
# The requirement exists so a bare word appearing in prose or in an unrelated
# local variable cannot become an anchor: an anchor must be something the repo
# actually defines somewhere.
def _definition_patterns(symbol: str) -> list[re.Pattern]:
    s = re.escape(symbol)
    return [
        re.compile(
            r"^\s*(export\s+)?(default\s+)?(public\s+|private\s+|internal\s+|external\s+)?"
            r"(async\s+)?(abstract\s+)?"
            r"(def|class|function|struct|interface|type|enum|event|trait|impl|fn|contract|library)\s+"
            + s
            + r"\b"
        ),
        # Module-level binding, COLUMN ZERO ONLY. An indented `NAME = ...` is a
        # local, and treating locals as definitions is what took the measured
        # fire rate to 76% of real commits: two files each holding a local named
        # `new_text` read as one symbol shared between them.
        re.compile(r"^" + s + r"\s*(:[^=]*)?=[^=]"),
        # The ORM column shape `name: Mapped[...]` inside a model body, which is
        # a genuine declaration and is necessarily indented.
        re.compile(r"^\s{0,8}" + s + r"\s*:\s*(Mapped|Column)\b"),
        # Solidity state variable / mapping declaration.
        re.compile(r"^\s*mapping\s*\(.*\)\s*(public|private|internal)?\s*" + s + r"\b"),
        re.compile(
            r"^\s*(uint\d*|int\d*|address|bytes\d*|bool|string)\[?\]?\s+"
            r"(public|private|internal|constant|immutable|\s)*" + s + r"\b"
        ),
    ]


class Infrastructure(Exception):
    """Raised for anything that means the gate could not run. Fails OPEN."""


def _git(args: list[str], cwd: str, timeout: float) -> str:
    try:
        proc = subprocess.run(
            ["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise Infrastructure("git not on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise Infrastructure(f"git {args[0]} exceeded {timeout:.0f}s") from exc
    if proc.returncode not in (0, 1):  # 1 is grep's "no match", not an error
        raise Infrastructure(f"git {' '.join(args[:2])} exit {proc.returncode}")
    return proc.stdout


def is_code_path(path: str) -> bool:
    if not path.endswith(CODE_SUFFIXES):
        return False
    probe = "/" + path
    return not any(frag in probe for frag in EXCLUDE_FRAGMENTS)


def changed_files(cwd: str, rev_range: str | None, timeout: float) -> list[str]:
    args = ["diff", "--name-only", "--diff-filter=ACMR"]
    args += [rev_range] if rev_range else ["--cached"]
    return [p for p in _git(args, cwd, timeout).splitlines() if p.strip()]


def changed_lines(
    cwd: str, rev_range: str | None, paths: list[str], timeout: float
) -> dict[str, list[str]]:
    """Repo-relative path -> the added and removed lines of its hunks."""
    if not paths:
        return {}
    args = ["diff", "-U0", "--no-color"]
    args += [rev_range] if rev_range else ["--cached"]
    args += ["--"] + paths
    out = _git(args, cwd, timeout)
    per_file: dict[str, list[str]] = {}
    current: str | None = None
    for line in out.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            per_file.setdefault(current, [])
            continue
        if (
            line.startswith("--- ")
            or line.startswith("diff --git")
            or line.startswith("@@")
        ):
            continue
        if current and line[:1] in ("+", "-") and not line.startswith(("+++", "---")):
            per_file[current].append(line[1:])
    return per_file


def anchor_candidates(lines: list[str]) -> set[str]:
    """Identifiers on changed lines that are SHAPED like a named thing.

    The shape rule (an underscore, an internal capital, or eight characters) is
    the single biggest noise control in this file. It drops loop variables and
    short locals without a repo index, at the cost of missing a short
    single-word lowercase name. That trade is deliberate: a missed anchor
    reverts to the status quo ante, a spurious one teaches the reader to skim.
    """
    found: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(("#", "//", "*", "/*")):
            continue
        for ident in IDENT_RE.findall(line):
            if len(ident) < MIN_SYMBOL_LEN:
                continue
            if ident.lower() in STOPWORDS:
                continue
            if ident.startswith("__"):
                continue
            shaped = (
                ("_" in ident.strip("_"))
                or any(c.isupper() for c in ident[1:])
                or ident[0].isupper()
                or len(ident) >= 8
            )
            if shaped:
                found.add(ident)
    return found


def grep_references(
    cwd: str, symbols: list[str], timeout: float, ref: str | None = None
) -> dict[str, list[tuple[str, str]]]:
    """symbol -> [(path, line_text)], over tracked non-test code files only.

    `ref` searches a tree-ish instead of the working tree. The hook path leaves
    it unset, because the staged tree is what the commit will be. The
    retrospective `--range` path sets it, because measuring a past commit's fire
    rate against TODAY's file set answers a different question than the one
    asked.
    """
    hits: dict[str, list[tuple[str, str]]] = {s: [] for s in symbols}
    if not symbols:
        return hits
    pathspecs = ["--"] + [f"*{suf}" for suf in CODE_SUFFIXES]
    for start in range(0, len(symbols), MAX_ANCHORS):
        chunk = symbols[start : start + MAX_ANCHORS]
        pattern = "|".join(re.escape(s) for s in chunk)
        args = ["grep", "-I", "-n", "-w", "-E", "-e", pattern]
        if ref:
            args.append(ref)
        out = _git(args + pathspecs, cwd, timeout)
        by_lower = {s.lower(): s for s in chunk}
        for row in out.splitlines():
            if ref:
                if not row.startswith(ref + ":"):
                    continue
                row = row[len(ref) + 1 :]
            parts = row.split(":", 2)
            if len(parts) < 3:
                continue
            path, _lineno, text = parts
            if not is_code_path(path):
                continue
            for match in IDENT_RE.finditer(text):
                ident = match.group(0)
                canonical = by_lower.get(ident.lower())
                if canonical and ident == canonical and not quoted(text, match):
                    hits[canonical].append((path, text))
    return hits


def module_linkage(
    cwd: str, definers: list[str], timeout: float, ref: str | None = None
) -> dict[str, set[str]]:
    """definer path -> the set of files that actually name that module.

    "Names the module" is an import in Python, TypeScript, Go and Rust, and in
    Solidity it is either an import or a call through the contract type, which is
    why the bare stem counts and not only an import line. The stem is the file's
    basename without its suffix, which is the module name in every language here.
    """
    linkage: dict[str, set[str]] = {d: set() for d in definers}
    if not definers:
        return linkage
    stems: dict[str, list[str]] = {}
    for definer in definers:
        stem = definer.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if len(stem) >= 3:
            stems.setdefault(stem, []).append(definer)
    if not stems:
        return linkage
    pathspecs = ["--"] + [f"*{suf}" for suf in CODE_SUFFIXES]
    keys = sorted(stems)
    for start in range(0, len(keys), MAX_ANCHORS):
        chunk = keys[start : start + MAX_ANCHORS]
        pattern = "|".join(re.escape(s) for s in chunk)
        args = ["grep", "-I", "-n", "-w", "-E", "-e", pattern]
        if ref:
            args.append(ref)
        out = _git(args + pathspecs, cwd, timeout)
        by_lower = {s.lower(): s for s in chunk}
        for row in out.splitlines():
            if ref:
                if not row.startswith(ref + ":"):
                    continue
                row = row[len(ref) + 1 :]
            parts = row.split(":", 2)
            if len(parts) < 3:
                continue
            path, _lineno, text = parts
            if not is_code_path(path):
                continue
            for ident in IDENT_RE.findall(text):
                canonical = by_lower.get(ident.lower())
                if canonical and ident == canonical:
                    for definer in stems[canonical]:
                        linkage[definer].add(path)

    # AN UNDISCRIMINATING STEM PROVES NOTHING. `assessment`, `models`, `config`
    # and their kind appear in most of the tree, so "this file names the defining
    # module" degenerates to "this file exists". Rather than hand-listing the
    # generic words, measure it: a stem found in more files than this is not
    # evidence of a relationship, and every symbol behind it is dropped. Measured
    # instance: micro_mirror.py sits under services/assessment/ and so "named"
    # models/assessment.py without reading anything from it.
    for definer, files in list(linkage.items()):
        if len(files) > STEM_DISCRIMINATION_CEILING:
            linkage[definer] = set()
    return linkage


def parse_named(message: str) -> list[str]:
    """Paths named in a Consumers-considered trailer, parentheticals removed.

    THE PARENTHETICAL IS STRIPPED BEFORE THE COMMA SPLIT, and the order is the
    whole of this function. The refusal message invites "a reason in parentheses
    after a path", and a reason written as an ordinary English sentence contains
    commas. Splitting first shatters that reason across chunks, leaves every
    fragment with an unbalanced bracket that the paren-strip can no longer
    match, and turns each fragment into a bogus path. The real path is then
    outnumbered and the commit is refused for naming its consumer.

    So an author who does exactly what the refusal told them to do is refused
    again, with the same message, and learns that the escape is unreliable. An
    escape believed unreliable stops being used, which is a cost paid from
    inside the gate where no test of its FINDINGS can see it.

    Anchor: lesson-the-consumer-sweep-invited-a-parenthetical-reason-then-split-
    the-trailer-on-commas-first-so-a-reason-written-as-a-sentence-refused-the-
    commit-2026-09-11
    """
    named: list[str] = []
    for line in message.splitlines():
        match = TRAILER_RE.match(line)
        if not match:
            continue
        without_reasons = re.sub(r"\([^)]*\)", "", match.group(1))
        for chunk in without_reasons.split(","):
            cleaned = chunk.strip().strip("`'\"")
            if cleaned:
                named.append(cleaned)
    return named


def is_named(path: str, named: list[str]) -> bool:
    """Generous matching, on purpose.

    The gate is asking for evidence that somebody LOOKED at the file, not for a
    correctly typed path. A basename, a suffix or the full path all discharge.
    Tightening this would raise the cost of the escape, which is the one cost
    that must stay near zero.
    """
    base = path.rsplit("/", 1)[-1]
    for name in named:
        candidate = name.strip("/")
        if not candidate:
            continue
        if (
            path == candidate
            or path.endswith("/" + candidate)
            or candidate.endswith(path)
        ):
            return True
        if candidate == base:
            return True
    return False


def analyse(cwd: str, message: str, rev_range: str | None, timeout: float) -> dict:
    deadline = time.monotonic() + timeout

    def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise Infrastructure(f"consumer sweep exceeded its {timeout:.0f}s budget")
        return left

    staged_all = changed_files(cwd, rev_range, remaining())
    staged_code = [p for p in staged_all if is_code_path(p)]
    if not staged_code:
        return {
            "verdict": "clean",
            "reason": "no code files in the change",
            "findings": [],
        }

    per_file = changed_lines(cwd, rev_range, staged_code, remaining())
    candidates: set[str] = set()
    origin: dict[str, set[str]] = {}
    for path, lines in per_file.items():
        for symbol in anchor_candidates(lines):
            candidates.add(symbol)
            origin.setdefault(symbol, set()).add(path)

    if not candidates:
        return {
            "verdict": "clean",
            "reason": "no anchor-shaped symbols on changed lines",
            "findings": [],
        }

    ordered = sorted(candidates)
    bounded = 0
    if len(ordered) > MAX_TOTAL_ANCHORS:
        # NO SILENT CAPS. A very broad commit produces more anchors than can be
        # swept inside a commit hook's budget, and bounding coverage without
        # saying so reads exactly like having covered everything. The dropped
        # count is logged and printed.
        bounded = len(ordered) - MAX_TOTAL_ANCHORS
        ordered = ordered[:MAX_TOTAL_ANCHORS]
    # For a retrospective range the reference set is read at the range's own tip,
    # never at today's working tree.
    grep_ref = rev_range.split("..")[-1] if rev_range else None
    hits = grep_references(cwd, ordered, remaining(), grep_ref)

    staged_set = set(staged_all)
    named = parse_named(message)
    pending: list[tuple[str, str, list[str]]] = []  # (symbol, definer, untouched)
    for symbol in ordered:
        rows = hits.get(symbol) or []
        if not rows:
            continue
        ref_files = sorted({path for path, _ in rows})
        if not (FANOUT_FLOOR <= len(ref_files) <= FANOUT_CEILING):
            continue
        patterns = _definition_patterns(symbol)
        def_files = {
            path for path, text in rows if any(pat.search(text) for pat in patterns)
        }
        # Exactly one definition site, and this is the sharpest control in the
        # file. A name defined in several places is a COMMON NAME, not a shared
        # thing: `QUEUE`, `HEADER`, `ARCHIVE` and `REQUIRED_FIELDS` are each
        # declared independently in unrelated modules, and counting them as one
        # symbol manufactures a consumer relationship that does not exist. This
        # gate has no notion of scope or import resolution, so uniqueness of
        # definition is what stands in for it.
        if len(def_files) != 1:
            continue
        # A file that only DEFINES the symbol is not a consumer of it. Where the
        # change edits callers and leaves the definition alone, pointing at the
        # definition is pointing at the file you already read to make the change,
        # and every such line spent is a line the reader learns to skip.
        untouched = [p for p in ref_files if p not in staged_set and p not in def_files]
        if not untouched:
            continue
        pending.append((symbol, next(iter(def_files)), untouched))

    # LINKAGE, the second grep and the sharpest control after uniqueness.
    #
    # A file that merely CONTAINS the word is not a consumer of the thing. It may
    # hold a local of the same name, or the word may be ordinary vocabulary in
    # that module. A real consumer names the DEFINING MODULE too: an import, a
    # require, or in Solidity the contract name it calls through. Measured on 45
    # real code-touching commits, the fire rate was 76% with neither control,
    # 53% with uniqueness alone, and the survivors were all of this shape:
    # `QUEUE` here, an unrelated `QUEUE` there, no relationship between them.
    linkage = module_linkage(
        cwd, sorted({definer for _, definer, _ in pending}), remaining(), grep_ref
    )

    findings = []
    for symbol, definer, untouched in pending:
        real = [p for p in untouched if p in linkage.get(definer, ())]
        if not real:
            continue
        unnamed = [p for p in real if not is_named(p, named)]
        if not unnamed:
            continue
        findings.append(
            {
                "symbol": symbol,
                "changed_in": sorted(origin.get(symbol, set())),
                "definer": definer,
                "untouched_consumers": unnamed,
                "named_consumers": [p for p in real if p not in unnamed],
            }
        )

    verdict = "refuse" if findings else "clean"
    return {
        "verdict": verdict,
        "bounded": bounded,
        "reason": "unswept consumers"
        if findings
        else "every consumer touched or named",
        "findings": findings,
        "named": named,
    }


def render_refusal(result: dict) -> str:
    findings = result["findings"]
    every: list[str] = []
    for finding in findings:
        for path in finding["untouched_consumers"]:
            if path not in every:
                every.append(path)

    out = [
        "[consumer-sweep] commit refused: this change edits something other modules read,",
        "[consumer-sweep] and those modules are not in the commit.",
        "",
    ]
    for finding in findings[:8]:
        out.append(f"  {finding['symbol']}")
        out.append(f"    changed in:  {', '.join(finding['changed_in'])}")
        out.append("    read by, and untouched here:")
        for path in finding["untouched_consumers"]:
            out.append(f"      {path}")
        out.append("")
    if len(findings) > 8:
        out.append(f"  ... and {len(findings) - 8} more symbol(s) in the same state.")
        out.append("")
    out += [
        "Two ways through, both honest.",
        "",
        "  1. Edit those files in THIS commit, if the change belongs on them too.",
        "  2. Look at each one, decide it is deliberately left alone, and say so by",
        "     pasting this line into the commit message:",
        "",
        "Consumers-considered: " + ", ".join(every),
        "",
        "The line is pre-filled because the work this gate wants is READING the list,",
        "not typing it. A reason in parentheses after a path is welcome and optional.",
        "",
        "Basis: blake-selection-the-consumer-sweep-becomes-a-mechanical-gate-because-the-",
        "fix-the-named-surface-and-miss-the-real-one-class-recurred-twice-in-one-session-2026-09-09",
    ]
    return "\n".join(out)


def log_event(payload: dict) -> None:
    try:
        base = os.path.join(
            os.environ.get("ALTER_LOG_DIR")
            or os.path.expanduser("~/.local/share/alter/cc"),
            "consumer-sweep-gate",
        )
        os.makedirs(base, exist_ok=True)
        payload = dict(payload)
        payload["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(os.path.join(base, "events.log"), "a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--message-file", help="path to the commit message being written"
    )
    parser.add_argument(
        "--message", default="", help="commit message text, instead of a file"
    )
    parser.add_argument(
        "--range",
        dest="rev_range",
        help="review an existing range, e.g. origin/staging..HEAD",
    )
    parser.add_argument("--repo", default=".", help="repository to read")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    args = parser.parse_args()

    if os.environ.get("ALTER_CONSUMER_SWEEP_SKIP") == "1":
        log_event({"event": "skip", "via": "ALTER_CONSUMER_SWEEP_SKIP"})
        print(
            "[consumer-sweep] skipped by ALTER_CONSUMER_SWEEP_SKIP; the skip is logged.",
            file=sys.stderr,
        )
        return 0

    message = args.message
    if args.message_file:
        try:
            with open(args.message_file, encoding="utf-8", errors="replace") as handle:
                message = handle.read()
        except OSError as exc:
            log_event(
                {"event": "fail-open", "reason": f"message file unreadable: {exc}"}
            )
            return 0

    # Carve-outs: a merge, a revert and an autosquash subject are not authored
    # changes and their consumer set is the original commit's problem.
    first = next((ln for ln in message.splitlines() if ln.strip()), "")
    if first.startswith(("Merge ", 'Revert "', "fixup! ", "squash! ", "amend! ")):
        return 0

    try:
        result = analyse(args.repo, message, args.rev_range, args.timeout)
    except Infrastructure as exc:
        log_event({"event": "fail-open", "reason": str(exc)})
        print(f"[consumer-sweep] not run ({exc}); commit allowed.", file=sys.stderr)
        return 0
    except Exception as exc:  # never wedge a commit on our own bug
        log_event(
            {
                "event": "fail-open",
                "reason": f"unexpected: {exc.__class__.__name__}: {exc}",
            }
        )
        print(
            f"[consumer-sweep] not run ({exc.__class__.__name__}); commit allowed.",
            file=sys.stderr,
        )
        return 0

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))

    if result.get("bounded"):
        log_event({"event": "bounded", "anchors_dropped": result["bounded"]})
        print(
            f"[consumer-sweep] this change is broad: {result['bounded']} symbol(s) went "
            f"unchecked past the {MAX_TOTAL_ANCHORS}-symbol budget.",
            file=sys.stderr,
        )

    if result["verdict"] == "refuse":
        log_event(
            {
                "event": "refuse",
                "symbols": [f["symbol"] for f in result["findings"]],
                "consumers": sorted(
                    {p for f in result["findings"] for p in f["untouched_consumers"]}
                ),
            }
        )
        if not args.json:
            print(render_refusal(result), file=sys.stderr)
        return 1

    if result.get("named"):
        log_event({"event": "discharge", "named": result["named"]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
