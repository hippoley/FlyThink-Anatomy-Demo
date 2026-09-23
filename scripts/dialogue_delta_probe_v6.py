"""Post-training probe: never imported by training or checkpoint selection.

Authored during v18 training, after its training corpus was fixed. This is
not an independently authored blind benchmark. Includes user's short commands.
"""
import copy
from dialogue_delta_corpus import empty_state, apply, delta, ROOMS


def probe_v6():
    dialogues = []
    for room in range(3):
        other = (room + 1) % 3
        for obj, name in enumerate(('灯', '窗户')):
            first, second = room * 4 + obj * 2, other * 4 + obj * 2
            specs = [
                (f'把{ROOMS[room]}{name}打开', delta('add', [first], [2], 'explicit')),
                ('关掉', delta('revise', [first], [1], 'focus_coreference')),
                ('调到30%', delta('revise', [first + 1], [3], 'focus_coreference')),
                (f'{ROOMS[other]}{name}设成70%', delta('add', [second + 1], [4], 'explicit')),
                ('刚才那项先挂起来', delta('pause', [second + 1], [], 'focus_coreference')),
                ('帮忙写一份博物馆参观攻略', delta('ood')),
                ('把暂停的那项继续执行', delta('resume', [second + 1], [], 'focus_coreference')),
                (f'{ROOMS[other]}{name}那条要求撤销掉', delta('retract', [second + 1], [], 'explicit_named')),
                ('其余已有要求保持不动', delta('retain')),
                (f'请把{ROOMS[room]}{name}关闭，同时把{ROOMS[other]}{name}打开', delta('add', [first, second], [1, 2], 'explicit')),
                ('所有要求一并取消', delta('clear')),
            ]
            state = empty_state()
            turns = []
            for text, change in specs:
                before = copy.deepcopy(state)
                state = apply(state, change)
                turns.append({'text': text, 'before': before, 'delta': change, 'after': copy.deepcopy(state)})
            dialogues.append({'id': f'probe-v6-{room}-{obj}', 'turns': turns})
    return dialogues
