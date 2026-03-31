#!/usr/bin/env python3
"""
Morphology-aware OCR tuner for ``run_test_image.py``.

This is a sibling of ``tuner.py`` that adds two extra pre-alignment variables:

- ``SCAN_PRE_ERODE``  : 0..7 square erosion kernel width
- ``SCAN_PRE_DILATE`` : 0..7 square dilation kernel width

Both are now consumed by the real scanner pipeline, so the best block printed by
this tuner can be pasted into ``.env`` and used by production / camera runs.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, List

from tuner import (
    APP_ROOT,
    RUN_TEST_IMAGE,
    TuneResult,
    _float_values,
    _int_values,
    _iter_combinations,
    _load_base_env,
    _pick_default_image,
    _print_top_results,
    _read_float,
    _read_int,
    _run_one,
    _write_csv,
)


DEFAULT_RESULTS_CSV = APP_ROOT / "tuner_morph_results.csv"
TARGET_NAME_DEFAULT = "SARAH MARTIN"
TARGET_PASSPORT_DEFAULT = "P123456AA"


def _build_morph_grid(base_env: Dict[str, str], preset: str) -> Dict[str, List[str]]:
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
            "SCAN_PRE_ERODE": _int_values([0], 0, 7),
            "SCAN_PRE_DILATE": _int_values([0], 0, 7),
        }

    if preset == "wide":
        return {
            "SCAN_GAMMA": _float_values([gamma - 0.05, gamma, gamma + 0.05], 0.50, 1.50),
            "SCAN_CONTRAST": _int_values([contrast - 25, contrast - 10, contrast], 50, 200),
            "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp // 2, pre_sharp], 0, 100),
            "SCAN_CLAHE_CLIP": _float_values([clahe - 0.60, clahe - 0.30, clahe], 0.10, 5.00),
            "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.40, master_clahe, master_clahe + 0.30], 0.10, 5.00),
            "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 20), variant_sharp], 0, 125),
            "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight], 0.05, 1.50),
            "SCAN_PRE_ERODE": _int_values([0, 1, 2], 0, 7),
            "SCAN_PRE_DILATE": _int_values([0, 1, 2], 0, 7),
        }

    if preset == "standard":
        return {
            "SCAN_GAMMA": _float_values([gamma - 0.05, gamma], 0.50, 1.50),
            "SCAN_CONTRAST": _int_values([contrast - 25, contrast], 50, 200),
            "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp], 0, 100),
            "SCAN_CLAHE_CLIP": _float_values([clahe - 0.60, clahe], 0.10, 5.00),
            "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.30, master_clahe, master_clahe + 0.20], 0.10, 5.00),
            "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 20), variant_sharp], 0, 125),
            "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight], 0.05, 1.50),
            "SCAN_PRE_ERODE": _int_values([0, 1, 2], 0, 7),
            "SCAN_PRE_DILATE": _int_values([0, 1, 2], 0, 7),
        }

    return {
        "SCAN_GAMMA": _float_values([gamma - 0.05, gamma], 0.50, 1.50),
        "SCAN_CONTRAST": _int_values([contrast - 20, contrast], 50, 200),
        "SCAN_PRE_SHARPNESS": _int_values([0, pre_sharp], 0, 100),
        "SCAN_CLAHE_CLIP": _float_values([clahe - 0.50, clahe], 0.10, 5.00),
        "SCAN_CLAHE_MASTER_CLIP": _float_values([master_clahe - 0.30, master_clahe], 0.10, 5.00),
        "SCAN_VARIANT_SHARPNESS": _int_values([max(0, variant_sharp - 15), variant_sharp], 0, 125),
        "SCAN_MRZ_LAB_POOL_WEIGHT": _float_values([0.05, lab_weight], 0.05, 1.50),
        "SCAN_PRE_ERODE": _int_values([0, 1], 0, 7),
        "SCAN_PRE_DILATE": _int_values([0, 1, 2], 0, 7),
    }


def _print_grid_summary(grid: Dict[str, List[str]]) -> int:
    print("Sweep grid:")
    total = 1
    for key, values in grid.items():
        print(f"  - {key}: {', '.join(values)}")
        total *= max(1, len(values))
    print(f"  -> total combinations: {total}\n")
    return total


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grid-search OCR settings with erosion / dilation included.")
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
        help="Search size. 'fine' stays close to the current .env values; 'wide' is much larger.",
    )
    parser.add_argument("--top", type=int, default=8, help="How many top results to print.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-run timeout in seconds.")
    parser.add_argument("--max-runs", type=int, default=0, help="Optional safety cap. 0 = full sweep.")
    parser.add_argument("--csv", default=str(DEFAULT_RESULTS_CSV), help="Where to write the ranked CSV results.")
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
    grid = _build_morph_grid(base_env, args.preset)
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
    print("Note          : This tuner adds SCAN_PRE_ERODE and SCAN_PRE_DILATE to the same pre-alignment chain used by the scanner.")
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
