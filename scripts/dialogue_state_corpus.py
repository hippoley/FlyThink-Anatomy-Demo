"""Bounded, explicit state supervision. Oracle edits are never model inputs."""
import copy
import hashlib
import json
import random

ROOMS = ['客厅', '主卧', '书房']
OBJECTS = ['灯', '窗户']
KEYS = [f'{r}/{e}/{p}' for r in ROOMS for e in OBJECTS for p in ['power', 'level']]
VALUES = ['absent', 'off', 'on', '30', '70']
OPS = ['add', 'revise', 'retract', 'clear', 'pause', 'resume', 'retain', 'ood']
PHRASES = {
 'train': {
  'add': ['请把{r}的{e}{v}', '{r}{e}{v}'],
  'revise': ['把它改成{v}', '不对，刚才那个要{v}'],
  'retract': ['撤回刚才那一项', '取消刚才的那条指令'],
  'clear': ['全部撤回', '清空所有意图'],
  'pause': ['暂停刚才那项任务', '先暂停它'],
  'resume': ['恢复刚才那项任务', '继续执行它'],
  'retain': ['好的我知道了', '先聊点别的'],
  'ood': ['帮我规划一次旅行', '帮我写一篇故事']},
 'test': {
  'add': ['帮忙将{r}的{e}{v}一下', '麻烦把{r}{e}{v}吧'],
  'revise': ['刚才那个，修改为{v}吧', '它还是{v}好了'],
  'retract': ['刚才那条当我没说', '撤掉上一个要求吧'],
  'clear': ['之前所有要求都取消掉', '把所有任务一起撤回'],
  'pause': ['这项先放一放，稍后再执行', '当前这个任务先暂停一下'],
  'resume': ['把暂停的那一项接着执行', '刚才暂停的任务恢复一下'],
  'retain': ['嗯，听到了', '我接着说别的事情'],
  'ood': ['给我写一封求职信', '帮我构思一段电影剧情']}}


def initial():
    return {'values': [0]*12, 'paused': [0]*12, 'focus': 12, 'ood': 0}


def transition(state, op, edits=()):
    """Supervision oracle, not a language parser or production execution path."""
    s = copy.deepcopy(state)
    if op == 'clear':
        return initial()
    if op in {'add', 'revise'}:
        for key, value in edits:
            s['values'][key] = value
            s['paused'][key] = 0
            s['focus'] = key
    elif op == 'retract' and s['focus'] < 12:
        k = s['focus']; s['values'][k] = 0; s['paused'][k] = 0; s['focus'] = 12
    elif op in {'pause', 'resume'} and s['focus'] < 12:
        s['paused'][s['focus']] = int(op == 'pause')
    elif op == 'ood':
        s['ood'] = 1
    return s


def wording(value):
    return {1: '关掉', 2: '打开', 3: '调到30%', 4: '调到70%'}[value]


def make_split(split, count, seed):
    rng = random.Random(seed)
    phrases = PHRASES[split]
    result = []
    for i in range(count):
        s = initial(); turns = []
        for t in range(8):
            choices = ['add']*4 + ['retain', 'clear', 'ood']
            if s['focus'] < 12:
                choices += ['revise']*3 + ['retract', 'pause', 'resume']
            op = rng.choice(choices) if t else 'add'
            edits = []
            if op == 'add':
                clauses = []
                for _ in range(2 if rng.random() < .35 else 1):
                    r, e = rng.randrange(3), rng.randrange(2)
                    value = rng.randrange(1, 5)
                    key = (r*2+e)*2 + int(value >= 3)
                    if any(k == key for k, _ in edits):
                        continue
                    edits.append((key, value))
                    clauses.append(rng.choice(phrases[op]).format(r=ROOMS[r], e=OBJECTS[e], v=wording(value)))
                text = '，同时'.join(clauses)
            elif op == 'revise':
                key = s['focus']; value = rng.choice([3, 4] if key % 2 else [1, 2])
                edits = [(key, value)]
                text = rng.choice(phrases[op]).format(v=wording(value))
            else:
                text = rng.choice(phrases[op])
            s = transition(s, op, edits)
            turns.append({'text': text, 'operation': op, 'state': copy.deepcopy(s)})
        result.append({'id': f'{split}-{i:04}', 'turns': turns})
    return result


def independent():
    """Manually authored acceptance sequences, fixed before training this model."""
    specs = [
      ('retain-two-rooms', [('打开客厅的灯', 'add', [(0,2)]), ('主卧窗户打开', 'add', [(6,2)]), ('嗯，先这样', 'retain', []), ('客厅的灯调到30%', 'add', [(1,3)])]),
      ('multi-intent', [('客厅灯打开，书房窗户关掉', 'add', [(0,2),(10,1)]), ('那个改成打开', 'revise', [(10,2)]), ('天气真不错', 'retain', []), ('全部撤回', 'clear', [])]),
      ('retract-scope', [('客厅灯打开', 'add', [(0,2)]), ('主卧灯打开', 'add', [(4,2)]), ('刚才主卧那条当我没说', 'retract', []), ('好', 'retain', [])]),
      ('pause-resume', [('书房窗户调到70%', 'add', [(11,4)]), ('先暂停它', 'pause', []), ('我们先聊别的', 'retain', []), ('继续执行刚才的', 'resume', [])]),
      ('ood-persists', [('客厅灯打开', 'add', [(0,2)]), ('帮我设计一个生日派对', 'ood', []), ('主卧灯关掉', 'add', [(4,1)]), ('全部撤回', 'clear', [])]),
      ('level-reference', [('主卧灯调到70%', 'add', [(5,4)]), ('改成30%', 'revise', [(5,3)]), ('打开客厅灯', 'add', [(0,2)]), ('知道了', 'retain', [])]),
    ]
    out = []
    for name, spec in specs:
        s = initial(); turns = []
        for text, op, edits in spec:
            s = transition(s, op, edits)
            turns.append({'text': text, 'operation': op, 'state': copy.deepcopy(s)})
        out.append({'id': name, 'turns': turns})
    return out


def corpus():
    assert all(set(PHRASES['train'][op]).isdisjoint(PHRASES['test'][op]) for op in OPS)
    data = {'train': make_split('train', 480, 783), 'test': make_split('test', 96, 784), 'independent': independent()}
    hashes = [{hashlib.sha256(json.dumps(s['turns'], ensure_ascii=False, sort_keys=True).encode()).hexdigest() for s in data[k]} for k in ['train', 'test']]
    assert hashes[0].isdisjoint(hashes[1])
    return data
