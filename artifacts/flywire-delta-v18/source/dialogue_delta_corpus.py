"""Deterministic supervision for structured dialogue deltas.

The model input contains the utterance and previous committed state. Labels are
the requested mutation only: operation, target node/property and value.
"""
import copy
import random

ROOMS=['客厅','主卧','书房']
OBJECTS=['灯','窗户']
PROPERTIES=['power','level']
KEYS=[f'{r}/{e}/{p}' for r in ROOMS for e in OBJECTS for p in PROPERTIES]
VALUES=['none','off','on','30','70']
OPS=['add','revise','retract','clear','pause','resume','retain','ood']
NONE=len(KEYS)

TEMPLATES={
'train':{
 'add':['{r}的{e}{v}','请把{r}{e}{v}','帮我将{r}的{e}{v}一下','麻烦{r}{e}{v}','现在让{r}的{e}{v}','我想把{r}{e}{v}'],
 'multi':['{a}，同时{b}','{a}，然后{b}','{a}；{b}'],
 'revise':['把它改成{v}','刚才那个改为{v}','不对，它应该{v}','它还是调整为{v}','前一项替换成{v}','上一项改成{v}'],
 'revise_named':['{r}{e}改成{v}','把{r}的{e}调整为{v}','将{r}{e}改为{v}','{r}的{e}应当{v}'],
 'retract':['撤回刚才那项','取消它','刚才那个不要了','让上一个要求作废','删掉前一项','那项当我没说'],
 'retract_named':['撤回{r}{e}的要求','取消{r}的{e}','删掉{r}{e}那项','{r}的{e}要求作废','{r}{e}这项不用了'],
 'pause':['先暂停它','刚才那项先放一放','暂时挂起这一项','中止前面那个任务','先冻结前一项','搁置当前要求'],
 'resume':['恢复刚才那项','继续执行它','接着把上一项做完','恢复暂停的任务','让原来那个继续执行','恢复被冻结的任务','回到暂停的任务'],
 'clear':['全部撤回','清空所有意图','取消之前所有要求','全部任务清空','把所有任务都取消','撤销全部已挂载意图','所有家居任务作废'],
 'retain':['好的我知道了','先这样','聊点别的','嗯我收到了','嗯，已经收到','目前没有补充','接着说其他事情','那就先这样','我知道了','保持前面的要求','之前要求继续保留','收到，暂时保持不变','其余照旧','保持现状','已有要求别改','维持原有控制'],
 'ood':['帮我规划旅行','写一封求职信','讲个科幻故事','设计聚会流程','构思电影情节','构思一部科幻电影','分析一只股票','替我安排旅游计划','帮我写一首诗','写个生日派对方案','列一份读书清单','规划徒步行程','分析电影结构','撰写产品文案']},
'test':{
 'add':['麻烦将{r}里的{e}{v}吧','现在把{r}那边的{e}{v}','我想让{r}{e}{v}'],
 'multi':['{a}，另外{b}','{a}，并且{b}','一边{a}，一边{b}'],
 'revise':['它还是{v}好了','前面那个调整成{v}','上一项替换为{v}'],
 'revise_named':['请将{r}{e}变更为{v}','{r}那边的{e}改作{v}'],
 'retract':['上一个要求作废','把前一项删掉','那条当我没说'],
 'retract_named':['把{r}{e}那条删掉','{r}的{e}不用了'],
 'pause':['这项暂时挂起','先中止前面那个'],
 'resume':['接着处理前一项','把暂停的那个恢复'],
 'clear':['之前所有要求都取消','把全部任务一起清掉'],
 'retain':['嗯，收到','暂时没有补充','我接着说别的'],
 'ood':['设计生日派对流程','构思一部电影','分析今天的股票']}}

def empty_state():
 return {'values':[0]*12,'paused':[0]*12,'focus':NONE,'ood':0}

VALUE_WORDS={'train':{1:['关掉','关闭'],2:['打开','开启'],3:['调到30%','设成30%'],4:['调到70%','设成70%']},
             'test':{1:['关上','设为关闭'],2:['开着','设为开启'],3:['开到30%','调整为30%'],4:['开到70%','调整为70%']}}
def value_word(v,split='train',rng=None): return (rng or random).choice(VALUE_WORDS[split][v])
def key_for(room,obj,value): return (room*2+obj)*2+int(value>=3)

def apply(state,delta):
 s=copy.deepcopy(state); op=delta['op']; targets=delta['targets']; values=delta['values']
 if op=='clear': return empty_state()
 if op in {'add','revise'}:
  for k,v in zip(targets,values):
   if k<NONE:s['values'][k]=v;s['paused'][k]=0;s['focus']=k
 elif op=='retract':
  for k in targets:
   if k<NONE:s['values'][k]=0;s['paused'][k]=0
  if s['focus'] in targets:s['focus']=NONE
 elif op in {'pause','resume'}:
  for k in targets:
   if k<NONE:s['paused'][k]=int(op=='pause')
 elif op=='ood':s['ood']=1
 return s

def delta(op,targets=(),values=(),reference='none'):
 t=list(targets)[:2]+[NONE,NONE];v=list(values)[:2]+[0,0]
 return {'op':op,'targets':t[:2],'values':v[:2],'reference':reference,'count':min(2,len(targets))}

def action_text(template,room,obj,value,split,rng):
 return template.format(r=ROOMS[room],e=OBJECTS[obj],v=value_word(value,split,rng))

def make_dialogues(split,count,seed,augment=False):
 rng=random.Random(seed);tpl=copy.deepcopy(TEMPLATES[split]);rows=[]
 if augment:
  assert split=='train'
  additions={
   'retract':['这条指令不要保留','把刚说的要求移除','不要执行上一项了','刚提出的那项撤销','撤回那条要求','取消那条要求','那条撤掉','那条不用了','那条要求收回'],
   'retract_named':['不要执行{r}{e}这条了','移除{r}{e}这条设置','{r}{e}这项要求撤销'],
   'retain':['现有任务依然有效','现有设置保持原状','所有已有设置保持原样','仍按之前安排做','剩下的照常','不需要调整了'],
   'pause':['先把它挂起','这条指令中止一下','暂停当前设置','目前这条任务先停一停'],
   'resume':['让被中止的任务接着执行','恢复刚暂停的设置','继续那条挂起的要求'],
   'revise':['当前设置换成{v}','将它变更为{v}','这个数值调整为{v}'],
   'revise_named':['请将{r}{e}更改成{v}','{r}{e}的设置换成{v}'],
   'multi':['{a}，{b}']}
  for op,phrases in additions.items():tpl[op].extend(phrases)
 for i in range(count):
  state=empty_state(); turns=[]
  for turn in range(10):
   active=[k for k,v in enumerate(state['values']) if v]
   named=[k for k in active if (k^1) not in active]
   choices=['add']*3+['retain','ood','clear']
   # A missing focus cannot supervise an implicit reference to a random device.
   if state['focus']<NONE and state['values'][state['focus']]:
    choices+=['revise']*2+['retract']
    choices+=['resume'] if state['paused'][state['focus']] else ['pause']
   if named:choices+=['retract_named','revise_named']
   op='add' if turn==0 else rng.choice(choices)
   before=copy.deepcopy(state)
   if op=='add':
    n=2 if rng.random()<.65 else 1; targets=[];values=[];parts=[]
    for _ in range(n):
     value=rng.randrange(1,5);room=rng.randrange(3);obj=rng.randrange(2);k=key_for(room,obj,value)
     if k in targets:continue
     targets.append(k);values.append(value);parts.append(action_text(rng.choice(tpl['add']),room,obj,value,split,rng))
    text=(rng.choice(tpl['multi']).format(a=parts[0],b=parts[1]) if len(parts)==2 else parts[0])
    if augment and len(parts)==1 and rng.random()<.2:
     values[0]={1:2,2:1,3:4,4:3}[values[0]]
     text+='，不，应该'+value_word(values[0],split,rng)
    d=delta('add',targets,values,'explicit')
   elif op=='revise':
    k=state['focus'];value=rng.randrange(1,5);k=(k//2)*2+int(value>=3)
    text=rng.choice(tpl['revise']).format(v=value_word(value,split,rng));d=delta(op,[k],[value],'focus_coreference')
   elif op=='retract_named':
    k=rng.choice(named);room=k//4;obj=(k%4)//2
    text=rng.choice(tpl['retract_named']).format(r=ROOMS[room],e=OBJECTS[obj]);d=delta('retract',[k],[], 'explicit_named')
   elif op=='revise_named':
    k=rng.choice(named);room=k//4;obj=(k%4)//2;value=rng.randrange(1,5);k=key_for(room,obj,value)
    text=rng.choice(tpl['revise_named']).format(r=ROOMS[room],e=OBJECTS[obj],v=value_word(value,split,rng));d=delta('revise',[k],[value],'explicit_named')
   elif op in {'retract','pause','resume'}:
    k=state['focus']
    text=rng.choice(tpl[op]);d=delta(op,[k],[], 'focus_coreference')
   else:
    text=rng.choice(tpl[op]);d=delta(op)
   state=apply(state,d);turns.append({'text':text,'before':before,'delta':d,'after':copy.deepcopy(state)})
  rows.append({'id':f'{split}-{i:04}','turns':turns})
 return rows

def sealed_dialogues():
 """Fixed acceptance cases authored before the delta model is trained."""
 specs=[
 ('reference-change',[('打开客厅灯',delta('add',[0],[2],'explicit')),('主卧窗户调到70%',delta('add',[7],[4],'explicit')),('刚刚那个改成30%',delta('revise',[7],[3],'focus_coreference')),('收到',delta('retain'))]),
 ('named-retract',[('打开客厅灯',delta('add',[0],[2],'explicit')),('打开主卧灯',delta('add',[4],[2],'explicit')),('客厅灯那项撤掉',delta('retract',[0],[],'explicit_named')),('先这样',delta('retain'))]),
 ('interrupt',[('书房窗户打开',delta('add',[10],[2],'explicit')),('这个先暂停',delta('pause',[10],[],'focus_coreference')),('帮我写首诗',delta('ood')),('继续原来那个',delta('resume',[10],[],'focus_coreference'))]),
      ('multi-clear',[('客厅灯关掉，主卧窗户打开',delta('add',[0,6],[1,2],'explicit')),('主卧窗户改成关掉',delta('revise',[6],[1],'explicit_named')),('我知道了',delta('retain')),('所有指令全部取消',delta('clear'))]),
 ('slot-reference',[('主卧灯调到70%',delta('add',[5],[4],'explicit')),('这个数值降到30%',delta('revise',[5],[3],'focus_coreference')),('书房灯打开',delta('add',[8],[2],'explicit')),('那就这样',delta('retain'))]),
      ('ood-retain',[('客厅窗户调到30%',delta('add',[3],[3],'explicit')),('替我写个旅游计划',delta('ood')),('嗯，收到',delta('retain')),('撤回刚才窗户那条',delta('retract',[3],[],'explicit_named'))])]
 out=[]
 for name,items in specs:
  state=empty_state();turns=[]
  for text,d in items:
   before=copy.deepcopy(state);state=apply(state,d);turns.append({'text':text,'before':before,'delta':d,'after':copy.deepcopy(state)})
  out.append({'id':name,'turns':turns})
 return out

def corpus(augment=False):
 for op in TEMPLATES['train']:
  assert set(TEMPLATES['train'][op]).isdisjoint(TEMPLATES['test'][op])
 return {'train':make_dialogues('train',900,1783,augment),'test':make_dialogues('test',180,1784),'sealed':sealed_dialogues()}
