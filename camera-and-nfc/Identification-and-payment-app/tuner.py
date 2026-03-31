#!/usr/bin/env python3
"""
Standalone OCR tuner for ``run_test_image.py``.

It sweeps a curated set of ``SCAN_*`` image-processing variables around the current
``.env`` values, launches ``python run_test_image.py`` for each combination, scores the
result against the target guest name / passport number, then prints the best
parameter block to paste into ``.env``.

This script does not rewrite ``.env`` during the sweep. Instead it overrides the same
variables in each subprocess environment; ``run_test_image.py`` still loads the
project ``.env`` for all other settings.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

try:
    from dotenv import dotenv_values
except ImportError:  # pragma: no cover - python-dotenv is already in requirements.txt
    dotenv_values = None


APP_ROOT = Path(__file__).resolve().parent
RUN_TEST_IMAGE = APP_ROOT / "run_test_image.py"
ENV_PATH = APP_ROOT / ".env"
DEFAULT_RESULTS_CSV = APP_ROOT / "tuner_results.csv"

TARGET_NAME_DEFAULT = "SARAH MARTIN"
TARGET_PASSPORT_DEFAULT = "P123456AA"

ENV_PRINT_ORDER = [
    "SCAN_GAMMA",
    "SCAN_BRIGHTNESS",
    "SCAN_CONTRAST",
    "SCAN_PRE_SATURATION",
    "SCAN_PRE_DENOISE",
    "SCAN_PRE_ERODE",
    "SCAN_PRE_DILATE",
    "SCAN_PRE_SHARPNESS",
    "SCAN_CLAHE_CLIP",
    "SCAN_CLAHE_MASTER_CLIP",
    "SCAN_VARIANT_SHARPNESS",
    "SCAN_VARIANT_SECOND_SHARPNESS",
    "SCAN_MRZ_LAB_POOL_WEIGHT",
    "OCR_USE_V3_BASE",
    "SCAN_FULL_FRAME",
]


@dataclass
class TuneResult:
    index: int
    total: int
    elapsed_s: float
    returncode: int
    timed_out: bool
    overrides: Dict[str, str]
    passport_id: str
    guest_name: str
    line1: str
    line2: str
    passport_score: float
    name_score: float
    overall_score: float
    output_path: str
    output_excerpt: str


def _pick_default_image() -> Path:
    candidates = [
        APP_ROOT / "test_images" / "test.png",
        APP_ROOT / "test_images" / "test.jpg",
        APP_ROOT / "test_images" / "last_capture.png",
    ]
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def _load_base_env() -> Dict[str, str]:
    if dotenv_values is not None and ENV_PATH.exists():
        data = dotenv_values(ENV_PATH)
        return {k: str(v) for k, v in data.items() if v is not None}

    base: Dict[str, str] = {}
    if not ENV_PATH.exists():
        return base
    for raw_line in ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        base[key.strip()] = value.strip()
    return base


def _read_float(base_env: Dict[str, str], keys: Sequence[str], default: float, lo: float, hi: float) -> float:
    for key in keys:
        raw = base_env.get(key)
        if raw is None or not str(raw).strip():
            continue
        try:
            value = float(str(raw).strip())
            return max(lo, min(hi, value))
        except ValueError:
            continue
    return max(lo, min(hi, default))


def _read_int(base_env: Dict[str, str], keys: Sequence[str], default: int, lo: int, hi: int) -> int:
    for key in keys:
        raw = base_env.get(key)
        if raw is None or not str(raw).strip():
            continue
        try:
            value = int(float(str(raw).strip()))
            return max(lo, min(hi, value))
        except ValueError:
            continue
    return max(lo, min(hi, default))


def _read_bool_as_int(base_env: Dict[str, str], key: str, default: int = 0) -> int:
    raw = str(base_env.get(key, str(default))).strip().lower()
    return 1 if raw in {"1", "true", "yes", "on"} else 0


def _float_values(values: Iterable[float], lo: float, hi: float, digits: int = 2) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        clipped = max(lo, min(hi, float(value)))
        token = f"{round(clipped, digits):.{digits}f}"
        if token not in seen:
            seen.add(token)
            out.append(token)
    return out


def _int_values(values: Iterable[int], lo: int, hi: int) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        clipped = max(lo, min(hi, int(round(value))))
        token = str(clipped)
        if token not in seen:
            seen.add(token)
            out.append(token)
    return out


def _build_search_grid(base_env: Dict[str, str], preset: str) -> Dict[str, List[str]]:
    gamma = _read_float(base_env, ("SCAN_GAMMA",), 0.95, 0.50, 1.50)
    contrast = _read_int(base_env, ("SCAN_CONTRAST", "SCAN_GLOBAL_CONTRAST", "ADJUST_CONTRAST"), 170, 50, 200)
    pre_sharp = _read_int(base_env, ("SCAN_PRE_SHARPNESS", "SCAN_PREPROCESS_SHARPNESS"), 15, 0, 100)
    clahe = _read_float(base_env, ("SCAN_CLAHE_CLIP",), 2.2, 0.10, 5.00)
    master_clahe = _read_float(base_env, ("SCAN_CLAHE_MASTER_CLIP",), 1.8, 0.10, 5.00)
    variant_sharp = _read_int(
        base_env,
        ("SCAN_VARIANT_SHARPNESS", "SCAN_SHARPNESS_VARIANT", "ADJUST_SHARPNESS"),
        50,
        0,
        125,
    )
    lab_weight = _read_float(base_env, ("SCAN_MRZ_LAB_POOL_WEIGHT",), 0.10, 0.05, 1.50)

    if preset == "fine":
        return {
            "SCAN_GAMMA": _float_values([gamma - 0.02, gamma, gamma + 0.02], 0.50, 1.50),
            "SCAN_CONTRAST": _int_values([contrast - 5, contrast, contrast + 5], 50, 200),
            "SCAN_PRE_SHARPNESS": _int_values([0, 2, 4], 0, 100),
            "SCAN_CLAHE_CLIP": _float_values([clahe - 0.10, clahe, clahe + 0.10], 0.10, 5.00),
            "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.10, master_clahe, master_clahe + 0.10], 0.10, 5.00),
            "SCAN_VARIANT_SHARPNESS": _int_values([0, 4, 8], 0, 125),
            "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05], 0.05, 1.50),
        }

    if preset == "quick":
        return {
            "SCAN_GAMMA": _float_values([gamma - 0.05, gamma], 0.50, 1.50),
            "SCAN_CONTRAST": _int_values([contrast - 25, contrast], 50, 200),
            "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp // 2, pre_sharp], 0, 100),
            "SCAN_CLAHE_CLIP": _float_values([clahe - 0.60, clahe], 0.10, 5.00),
            "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.30, master_clahe], 0.10, 5.00),
            "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 20), variant_sharp], 0, 125),
            "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight], 0.05, 1.50),
        }

    if preset == "wide":
        return {
            "SCAN_GAMMA": _float_values([gamma - 0.08, gamma - 0.04, gamma, gamma + 0.04], 0.50, 1.50),
            "SCAN_CONTRAST": _int_values([contrast - 35, contrast - 20, contrast - 10, contrast], 50, 200),
            "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp // 3, pre_sharp // 2, pre_sharp], 0, 100),
            "SCAN_CLAHE_CLIP": _float_values([clahe - 0.80, clahe - 0.40, clahe], 0.10, 5.00),
            "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.40, master_clahe, master_clahe + 0.30], 0.10, 5.00),
            "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 30), max(0, variant_sharp - 15), variant_sharp], 0, 125),
            "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight, max(0.15, lab_weight * 2.0)], 0.05, 1.50),
        }

    return {
        "SCAN_GAMMA": _float_values([gamma - 0.05, gamma, gamma + 0.05], 0.50, 1.50),
        "SCAN_CONTRAST": _int_values([contrast - 30, contrast - 15, contrast], 50, 200),
        "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp // 2, pre_sharp], 0, 100),
        "SCAN_CLAHE_CLIP": _float_values([clahe - 0.80, clahe - 0.40, clahe], 0.10, 5.00),
        "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.30, master_clahe, master_clahe + 0.20], 0.10, 5.00),
        "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 30), max(0, variant_sharp - 15), variant_sharp], 0, 125),
        "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight], 0.05, 1.50),
    }


def _normalize_passport(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", (value or "").upper())


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", (value or "").upper())).strip()


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _prefix_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    common = 0
    for left, right in zip(a, b):
        if left != right:
            break
        common += 1
    return common / max(len(b), 1)


def _passport_score(candidate: str, target: str) -> float:
    cand = _normalize_passport(candidate)
    tgt = _normalize_passport(target)
    if not cand:
        return 0.0
    return max(0.0, min(1.0, 0.75 * _sim(cand, tgt) + 0.25 * _prefix_ratio(cand, tgt)))


def _name_score(candidate: str, target: str) -> float:
    cand = _normalize_name(candidate)
    tgt = _normalize_name(target)
    if not cand:
        return 0.0

    tgt_tokens = [tok for tok in tgt.split(" ") if tok]
    cand_tokens = [tok for tok in cand.split(" ") if tok]
    exact_score = _sim(cand, tgt)
    reversed_score = 0.0
    if len(tgt_tokens) >= 2:
        reversed_score = _sim(cand, " ".join(reversed(tgt_tokens)))

    if cand_tokens and tgt_tokens:
        best_first = max(_sim(tok, tgt_tokens[0]) for tok in cand_tokens)
        best_last = max(_sim(tok, tgt_tokens[-1]) for tok in cand_tokens)
        token_presence_score = (best_first + best_last) / 2.0

        cand_first = cand_tokens[0]
        cand_last = cand_tokens[-1]
        forward_order_score = (_sim(cand_first, tgt_tokens[0]) + _sim(cand_last, tgt_tokens[-1])) / 2.0
        reverse_order_score = (_sim(cand_first, tgt_tokens[-1]) + _sim(cand_last, tgt_tokens[0])) / 2.0
    else:
        token_presence_score = 0.0
        forward_order_score = 0.0
        reverse_order_score = 0.0

    digit_penalty = min(0.20, 0.05 * sum(ch.isdigit() for ch in cand))
    # Prefer the TD3 order actually produced by the parser: given-name first, surname last.
    # Reversed order still gets some credit via token presence, but should not rank above the
    # same tokens in the correct order.
    score = (
        (0.45 * exact_score)
        + (0.25 * token_presence_score)
        + (0.25 * forward_order_score)
        - (0.15 * reversed_score)
        - (0.10 * reverse_order_score)
        - digit_penalty
    )
    return max(0.0, min(1.0, score))


def _extract_last(pattern: str, text: str) -> str:
    matches = re.findall(pattern, text, flags=re.MULTILINE)
    if not matches:
        return ""
    value = matches[-1]
    if isinstance(value, tuple):
        value = value[0]
    return str(value).strip()


def _excerpt_tail(text: str, lines: int = 12) -> str:
    tail = [line.rstrip() for line in text.splitlines() if line.strip()]
    return "\n".join(tail[-lines:])


def _run_one(
    index: int,
    total: int,
    image_path: Path,
    base_env: Dict[str, str],
    overrides: Dict[str, str],
    target_name: str,
    target_passport: str,
    timeout_s: float,
) -> TuneResult:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.update(base_env)
    env.update(overrides)

    started = time.perf_counter()
    timed_out = False
    returncode = -1
    combined_output = ""
    try:
        proc = subprocess.run(
            [sys.executable, str(RUN_TEST_IMAGE), str(image_path)],
            cwd=str(APP_ROOT),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
        returncode = int(proc.returncode)
        combined_output = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        combined_output = (stdout or "") + (("\n" + stderr) if stderr else "")

    elapsed_s = time.perf_counter() - started
    passport_id = _extract_last(r"^Passport ID:\s*(.+?)\s*$", combined_output)
    guest_name = _extract_last(r"^Guest name:\s*(.+?)\s*$", combined_output)
    if not passport_id:
        passport_id = _extract_last(r"^Passport number\s*:\s*(.+?)\s*(?:\(|$)", combined_output)
    if not guest_name:
        guest_name = _extract_last(r"^Guest name \(MRZ\)\s*:\s*(.+?)\s*$", combined_output)
    line1 = _extract_last(r"^L1:\s*(.+?)\s*$", combined_output)
    line2 = _extract_last(r"^L2:\s*(.+?)\s*$", combined_output)

    passport_score = _passport_score(passport_id, target_passport)
    name_score = _name_score(guest_name, target_name)
    overall_score = (passport_score + name_score) / 2.0
    if timed_out or returncode != 0:
        overall_score *= 0.80

    return TuneResult(
        index=index,
        total=total,
        elapsed_s=elapsed_s,
        returncode=returncode,
        timed_out=timed_out,
        overrides=dict(overrides),
        passport_id=passport_id,
        guest_name=guest_name,
        line1=line1,
        line2=line2,
        passport_score=passport_score,
        name_score=name_score,
        overall_score=overall_score,
        output_path=str(image_path),
        output_excerpt=_excerpt_tail(combined_output),
    )


def _iter_combinations(grid: Dict[str, List[str]]) -> Iterable[Dict[str, str]]:
    keys = list(grid.keys())
    values = [grid[key] for key in keys]
    for combo in itertools.product(*values):
        yield {key: value for key, value in zip(keys, combo)}


def _effective_env(base_env: Dict[str, str], overrides: Dict[str, str]) -> Dict[str, str]:
    merged = dict(base_env)
    merged.update(overrides)
    merged.setdefault("SCAN_BRIGHTNESS", base_env.get("SCAN_BRIGHTNESS", "128"))
    merged.setdefault("SCAN_PRE_SATURATION", base_env.get("SCAN_PRE_SATURATION", "100"))
    merged.setdefault("SCAN_PRE_DENOISE", base_env.get("SCAN_PRE_DENOISE", "0"))
    merged.setdefault("SCAN_PRE_ERODE", base_env.get("SCAN_PRE_ERODE", "0"))
    merged.setdefault("SCAN_PRE_DILATE", base_env.get("SCAN_PRE_DILATE", "0"))
    merged.setdefault("SCAN_VARIANT_SECOND_SHARPNESS", base_env.get("SCAN_VARIANT_SECOND_SHARPNESS", "0"))
    merged.setdefault("OCR_USE_V3_BASE", str(_read_bool_as_int(base_env, "OCR_USE_V3_BASE", 0)))
    merged.setdefault("SCAN_FULL_FRAME", base_env.get("SCAN_FULL_FRAME", "0"))
    return merged


def _write_csv(path: Path, results: Sequence[TuneResult], grid_keys: Sequence[str]) -> None:
    fieldnames = [
        "rank",
        "index",
        "total",
        "overall_score",
        "name_score",
        "passport_score",
        "elapsed_s",
        "returncode",
        "timed_out",
        "passport_id",
        "guest_name",
        "line1",
        "line2",
        "output_path",
        "output_excerpt",
    ] + list(grid_keys)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for rank, result in enumerate(results, start=1):
            row = {
                "rank": rank,
                "index": result.index,
                "total": result.total,
                "overall_score": f"{result.overall_score:.4f}",
                "name_score": f"{result.name_score:.4f}",
                "passport_score": f"{result.passport_score:.4f}",
                "elapsed_s": f"{result.elapsed_s:.2f}",
                "returncode": result.returncode,
                "timed_out": int(result.timed_out),
                "passport_id": result.passport_id,
                "guest_name": result.guest_name,
                "line1": result.line1,
                "line2": result.line2,
                "output_path": result.output_path,
                "output_excerpt": result.output_excerpt,
            }
            for key in grid_keys:
                row[key] = result.overrides.get(key, "")
            writer.writerow(row)


def _format_env_block(base_env: Dict[str, str], overrides: Dict[str, str]) -> str:
    merged = _effective_env(base_env, overrides)
    lines: List[str] = []
    for key in ENV_PRINT_ORDER:
        if key not in merged:
            continue
        marker = "  # tuned" if merged.get(key) != base_env.get(key) else ""
        lines.append(f"{key}={merged[key]}{marker}")
    return "\n".join(lines)


def _print_grid_summary(grid: Dict[str, List[str]]) -> None:
    print("Sweep grid:")
    for key, values in grid.items():
        print(f"  - {key}: {', '.join(values)}")
    total = 1
    for values in grid.values():
        total *= max(1, len(values))
    print(f"  -> total combinations: {total}\n")


def _print_top_results(base_env: Dict[str, str], results: Sequence[TuneResult], top_n: int) -> None:
    if not results:
        print("No results to print.")
        return

    best_overall = results[0]
    best_name = max(results, key=lambda item: item.name_score)
    best_passport = max(results, key=lambda item: item.passport_score)

    print("\nBest overall")
    print(f"  score      : {best_overall.overall_score:.4f}")
    print(f"  guest      : {best_overall.guest_name or '-'}")
    print(f"  passport   : {best_overall.passport_id or '-'}")
    print(f"  name score : {best_overall.name_score:.4f}")
    print(f"  pass score : {best_overall.passport_score:.4f}")
    print("  best .env block:")
    print(_format_env_block(base_env, best_overall.overrides))

    print("\nBest guest-name match")
    print(f"  guest      : {best_name.guest_name or '-'}")
    print(f"  passport   : {best_name.passport_id or '-'}")
    print(f"  name score : {best_name.name_score:.4f}")
    print(f"  pass score : {best_name.passport_score:.4f}")

    print("\nBest passport match")
    print(f"  guest      : {best_passport.guest_name or '-'}")
    print(f"  passport   : {best_passport.passport_id or '-'}")
    print(f"  name score : {best_passport.name_score:.4f}")
    print(f"  pass score : {best_passport.passport_score:.4f}")

    print(f"\nTop {min(top_n, len(results))} runs")
    for i, result in enumerate(results[:top_n], start=1):
        tuned = ", ".join(f"{k}={v}" for k, v in result.overrides.items())
        print(
            f"  {i}. score={result.overall_score:.4f} "
            f"name={result.name_score:.4f} passport={result.passport_score:.4f} "
            f"guest='{result.guest_name or '-'}' passport_id='{result.passport_id or '-'}'"
        )
        print(f"     {tuned}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grid-search image-processing settings for run_test_image.py")
    parser.add_argument(
        "--image",
        default=str(_pick_default_image()),
        help="Image to test (defaults to test_images/test.png, then test.jpg, then last_capture.png).",
    )
    parser.add_argument("--target-name", default=TARGET_NAME_DEFAULT, help="Target guest name for scoring.")
    parser.add_argument("--target-passport", default=TARGET_PASSPORT_DEFAULT, help="Target passport number for scoring.")
    parser.add_argument(
        "--preset",
        choices=("quick", "fine", "standard", "wide"),
        default="quick",
        help="How many combinations to sweep. 'fine' stays close to the current .env values.",
    )
    parser.add_argument("--top", type=int, default=8, help="How many top results to print.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-run timeout in seconds.")
    parser.add_argument(
        "--max-runs",
        type=int,
        default=0,
        help="Optional safety cap for development/smoke tests. 0 = run full sweep.",
    )
    parser.add_argument(
        "--csv",
        default=str(DEFAULT_RESULTS_CSV),
        help="Where to write the ranked CSV results.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    image_path = Path(args.image).resolve()
    if not image_path.exists():
        print(f"Image not found: {image_path}")
        return 1
    if not RUN_TEST_IMAGE.exists():
        print(f"Missing script: {RUN_TEST_IMAGE}")
        return 1

    base_env = _load_base_env()
    grid = _build_search_grid(base_env, args.preset)
    all_overrides = list(_iter_combinations(grid))
    if args.max_runs > 0:
        all_overrides = all_overrides[: args.max_runs]

    total = len(all_overrides)
    if total == 0:
        print("No combinations to run.")
        return 1

    print(f"Image         : {image_path}")
    print(f"Target name   : {args.target_name}")
    print(f"Target passport: {args.target_passport}")
    print(f"Preset        : {args.preset}")
    print("Note          : SHARPNESS_THRESHOLD is not swept here because run_test_image.py uses saved images, not the poll gate.")
    _print_grid_summary(grid)

    results: List[TuneResult] = []
    best_so_far: TuneResult | None = None

    for index, overrides in enumerate(all_overrides, start=1):
        result = _run_one(
            index=index,
            total=total,
            image_path=image_path,
            base_env=base_env,
            overrides=overrides,
            target_name=args.target_name,
            target_passport=args.target_passport,
            timeout_s=args.timeout,
        )
        results.append(result)

        improved = best_so_far is None or result.overall_score > best_so_far.overall_score
        status = "BEST" if improved else "    "
        print(
            f"[{index:>4}/{total}] {status} score={result.overall_score:.4f} "
            f"name={result.name_score:.4f} passport={result.passport_score:.4f} "
            f"guest='{result.guest_name or '-'}' passport='{result.passport_id or '-'}' "
            f"{result.elapsed_s:.1f}s"
        )
        if improved:
            best_so_far = result

    results.sort(key=lambda item: item.overall_score, reverse=True)
    csv_path = Path(args.csv).resolve()
    _write_csv(csv_path, results, list(grid.keys()))

    _print_top_results(base_env, results, args.top)
    print(f"\nCSV written to: {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
