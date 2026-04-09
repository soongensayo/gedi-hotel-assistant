#!/usr/bin/env python3
"""
Two-stage OCR tuner for ``run_test_image.py``.

Stage 1:
- Run the existing non-morph search from ``tuner.py``.

Stage 2:
- Freeze the best Stage-1 settings.
- Run a small erosion / dilation refinement around that result.

This keeps the search practical while still testing the new morphology knobs.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

from tuner import (
    APP_ROOT,
    DEFAULT_RESULTS_CSV,
    RUN_TEST_IMAGE,
    TARGET_NAME_DEFAULT,
    TARGET_PASSPORT_DEFAULT,
    TuneResult,
    _build_search_grid,
    _format_env_block,
    _int_values,
    _iter_combinations,
    _load_base_env,
    _pick_default_image,
    _print_top_results,
    _read_int,
    _run_one,
    _write_csv,
)


STAGE2_DEFAULT_RESULTS_CSV = APP_ROOT / "tuner_two_stage_morph_results.csv"


def _print_grid_summary(grid: Dict[str, List[str]]) -> int:
    print("Sweep grid:")
    total = 1
    for key, values in grid.items():
        print(f"  - {key}: {', '.join(values)}")
        total *= max(1, len(values))
    print(f"  -> total combinations: {total}\n")
    return total


def _centered_kernel_values(center: int, preset: str) -> List[str]:
    if preset == "wide":
        values = [center - 2, center - 1, center, center + 1, center + 2]
    elif preset == "fine":
        values = [center - 1, center, center + 1]
    elif preset == "standard":
        values = [center - 1, center, center + 1]
    else:
        values = [center, center + 1]
    return _int_values(values, 0, 7)


def _build_morph_refinement_grid(base_env: Dict[str, str], best_stage1: TuneResult, preset: str) -> Dict[str, List[str]]:
    merged = dict(base_env)
    merged.update(best_stage1.overrides)
    erode_center = _read_int(merged, ("SCAN_PRE_ERODE", "SCAN_ERODE"), 0, 0, 7)
    dilate_center = _read_int(merged, ("SCAN_PRE_DILATE", "SCAN_DILATE"), 0, 0, 7)
    return {
        "SCAN_PRE_ERODE": _centered_kernel_values(erode_center, preset),
        "SCAN_PRE_DILATE": _centered_kernel_values(dilate_center, preset),
    }


def _run_sweep(
    *,
    label: str,
    image_path: Path,
    base_env: Dict[str, str],
    combos: Sequence[Dict[str, str]],
    target_name: str,
    target_passport: str,
    timeout_s: float,
) -> List[TuneResult]:
    results: List[TuneResult] = []
    best_so_far: TuneResult | None = None
    total = len(combos)

    print(f"## {label}")
    for index, overrides in enumerate(combos, start=1):
        result = _run_one(
            index=index,
            total=total,
            image_path=image_path,
            base_env=base_env,
            overrides=overrides,
            target_name=target_name,
            target_passport=target_passport,
            timeout_s=timeout_s,
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
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Two-stage OCR tuner: non-morph search, then morph refinement.")
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
        help="Controls Stage-1 breadth and Stage-2 morph radius. 'fine' stays close to the current .env values.",
    )
    parser.add_argument("--top", type=int, default=8, help="How many top results to print.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-run timeout in seconds.")
    parser.add_argument("--max-stage1-runs", type=int, default=0, help="Optional cap for Stage 1. 0 = full Stage 1 sweep.")
    parser.add_argument("--max-stage2-runs", type=int, default=0, help="Optional cap for Stage 2. 0 = full Stage 2 sweep.")
    parser.add_argument(
        "--stage1-csv",
        default=str(DEFAULT_RESULTS_CSV.with_name("tuner_two_stage_stage1_results.csv")),
        help="Where to write ranked Stage-1 results.",
    )
    parser.add_argument(
        "--stage2-csv",
        default=str(STAGE2_DEFAULT_RESULTS_CSV),
        help="Where to write ranked Stage-2 results.",
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
    stage1_grid = _build_search_grid(base_env, args.preset)
    stage1_combos = list(_iter_combinations(stage1_grid))
    if args.max_stage1_runs > 0:
        stage1_combos = stage1_combos[: args.max_stage1_runs]
    if not stage1_combos:
        print("No Stage-1 combinations to run.")
        return 1

    print(f"Image          : {image_path}")
    print(f"Target name    : {args.target_name}")
    print(f"Target passport: {args.target_passport}")
    print(f"Preset         : {args.preset}")
    print("Plan           : Stage 1 searches non-morph settings; Stage 2 refines only erosion / dilation around the Stage-1 winner.\n")

    print("Stage 1: non-morph search")
    _print_grid_summary(stage1_grid)
    stage1_results = _run_sweep(
        label="Stage 1 results",
        image_path=image_path,
        base_env=base_env,
        combos=stage1_combos,
        target_name=args.target_name,
        target_passport=args.target_passport,
        timeout_s=args.timeout,
    )
    best_stage1 = stage1_results[0]
    _write_csv(Path(args.stage1_csv).resolve(), stage1_results, list(stage1_grid.keys()))

    print("\nStage-1 winner")
    print(f"  score      : {best_stage1.overall_score:.4f}")
    print(f"  guest      : {best_stage1.guest_name or '-'}")
    print(f"  passport   : {best_stage1.passport_id or '-'}")
    print("  env block:")
    print(_format_env_block(base_env, best_stage1.overrides))

    stage2_grid = _build_morph_refinement_grid(base_env, best_stage1, args.preset)
    stage2_combos = []
    for morph_overrides in _iter_combinations(stage2_grid):
        merged = dict(best_stage1.overrides)
        merged.update(morph_overrides)
        stage2_combos.append(merged)
    if args.max_stage2_runs > 0:
        stage2_combos = stage2_combos[: args.max_stage2_runs]
    if not stage2_combos:
        print("No Stage-2 combinations to run.")
        return 1

    print("\nStage 2: morph refinement")
    _print_grid_summary(stage2_grid)
    stage2_results = _run_sweep(
        label="Stage 2 results",
        image_path=image_path,
        base_env=base_env,
        combos=stage2_combos,
        target_name=args.target_name,
        target_passport=args.target_passport,
        timeout_s=args.timeout,
    )
    best_stage2 = stage2_results[0]
    _write_csv(Path(args.stage2_csv).resolve(), stage2_results, list(stage2_combos[0].keys()))

    print("\nFinal winner after morph refinement")
    print(f"  score      : {best_stage2.overall_score:.4f}")
    print(f"  guest      : {best_stage2.guest_name or '-'}")
    print(f"  passport   : {best_stage2.passport_id or '-'}")
    print("  env block:")
    print(_format_env_block(base_env, best_stage2.overrides))

    print("\nTop Stage-2 results")
    _print_top_results(base_env, stage2_results, args.top)
    print(f"\nStage-1 CSV written to: {Path(args.stage1_csv).resolve()}")
    print(f"Stage-2 CSV written to: {Path(args.stage2_csv).resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
