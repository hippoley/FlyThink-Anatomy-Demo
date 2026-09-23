"""Fail closed on missing or sub-target evaluation metrics; never train on reports."""
import argparse
import json
import math
from pathlib import Path

REQUIRED = (
    'operation_accuracy', 'reference_accuracy', 'target_accuracy',
    'room_accuracy', 'object_accuracy', 'property_accuracy', 'value_accuracy',
    'delta_exact', 'coreference_target_accuracy', 'retraction_delta_exact',
    'multi_intent_exact', 'ood_route_accuracy', 'count_accuracy',
)


def assess(metrics, threshold=0.9):
    failures = {}
    for key in REQUIRED:
        value = metrics.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            failures[key] = {'value': value, 'reason': 'missing_or_invalid'}
        elif value < threshold:
            failures[key] = {'value': value, 'reason': 'below_target', 'gap': round(threshold - value, 6)}
    return {'threshold': threshold, 'passed': not failures, 'failures': failures,
            'scope': 'reported bounded task metrics only; excludes whole-brain and generative OOD'}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--threshold', type=float, default=.9)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    if not 0 < args.threshold <= 1:
        parser.error('threshold must be in (0, 1]')
    report = json.loads(args.report.read_text())
    views = {
        'resolved_with_gold_history': assess(report.get('metrics', {}), args.threshold),
        'raw_network_with_gold_history': assess(report.get('raw_model_metrics', {}), args.threshold),
        'sequential_predicted_history': assess(report.get('rollout', {}).get('metrics', {}), args.threshold),
    }
    state_exact = report.get('rollout', {}).get('state_exact')
    state_passed = isinstance(state_exact, (float, int)) and not isinstance(state_exact, bool) and args.threshold <= state_exact <= 1
    result = {'threshold': args.threshold, 'passed': all(v['passed'] for v in views.values()) and state_passed,
              'views': views, 'rollout_state_exact': state_exact, 'rollout_state_passed': state_passed,
              'claim_scope': 'bounded subgraph benchmark; whole-brain and generative OOD remain unevaluated'}
    result['source_report'] = str(args.report)
    text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + '\n')
    print(text)
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
