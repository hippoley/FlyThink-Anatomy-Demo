"""Export frozen evaluation failures without silently turning probes into training data."""
import argparse
import hashlib
import json
from pathlib import Path


def export(report):
    raw_rows = [{**row, 'predicted': row['raw_predicted'], 'exact': row['raw_exact']} for row in report['trace'] if 'raw_exact' in row]
    for mode, rows in (('raw_network', raw_rows), ('gold_previous_state', report['trace']), ('predicted_previous_state', report['rollout']['trace'])):
        for index, trace in enumerate(rows):
            failed = not trace.get('exact', trace.get('state_exact', True))
            if not failed:
                continue
            key = f"{report['checkpoint_sha256']}:{report['suite']}:{mode}:{index}"
            yield {'failure_id': hashlib.sha256(key.encode()).hexdigest(),
                   'checkpoint_sha256': report['checkpoint_sha256'], 'suite': report['suite'],
                   'mode': mode, 'turn_index': index, 'observed': trace,
                   'label_source': 'frozen_evaluation_specification',
                   'human_review_status': 'not_reviewed', 'training_eligible': False}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('reports', nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    rows = [row for path in args.reports for row in export(json.loads(path.read_text()))]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    print(json.dumps({'failure_records': len(rows), 'training_eligible': 0}))


if __name__ == '__main__':
    main()
