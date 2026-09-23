"""Post-v13 freeze suite. Never import this module from training code."""
import copy
from dialogue_delta_corpus import empty_state,apply,delta

SPECS=[
 ('v4-cross-room',[
  ('请让客厅的灯开启',delta('add',[0],[2],'explicit')),
  ('再将书房窗户调整到70%',delta('add',[11],[4],'explicit')),
  ('把刚才那一项降到30%',delta('revise',[11],[3],'focus_coreference')),
  ('移除书房窗户的要求',delta('retract',[11],[],'explicit_named')),
  ('客厅原有设置继续保留',delta('retain'))]),
 ('v4-two-rooms',[
  ('客厅窗户关闭，另外主卧灯开启',delta('add',[2,4],[1,2],'explicit')),
  ('后一项改为关闭',delta('revise',[4],[1],'focus_coreference')),
  ('先冻结这个任务',delta('pause',[4],[],'focus_coreference')),
  ('把冻结的任务接着执行',delta('resume',[4],[],'focus_coreference')),
  ('把此前所有控制要求一并撤销',delta('clear'))]),
 ('v4-named-retract',[
  ('把书房的灯设置到70%',delta('add',[9],[4],'explicit')),
  ('主卧窗户打开',delta('add',[6],[2],'explicit')),
  ('去掉书房灯对应的控制',delta('retract',[9],[],'explicit_named')),
  ('刚才主卧的要求别改',delta('retain')),
  ('主卧窗户改成关闭',delta('revise',[6],[1],'explicit_named'))]),
 ('v4-ood-interrupt',[
  ('客厅灯设置到30%',delta('add',[1],[3],'explicit')),
  ('给我规划一份三日徒步路线',delta('ood')),
  ('家里的控制指令维持原样',delta('retain')),
  ('把当前灯光提高到70%',delta('revise',[1],[4],'focus_coreference')),
  ('清除全部已挂载任务',delta('clear'))]),
 ('v4-multi-window',[
  ('主卧窗户设置到30%，同时书房窗户设置到70%',delta('add',[7,11],[3,4],'explicit')),
  ('刚才最后那个窗口改为30%',delta('revise',[11],[3],'focus_coreference')),
  ('暂时停下这一项',delta('pause',[11],[],'focus_coreference')),
  ('继续被停下的那项',delta('resume',[11],[],'focus_coreference')),
  ('主卧窗户那条控制删去',delta('retract',[7],[],'explicit_named'))]),
 ('v4-power-pair',[
  ('开启客厅灯，并且关闭书房灯',delta('add',[0,8],[2,1],'explicit')),
  ('把最后提到的灯打开',delta('revise',[8],[2],'focus_coreference')),
  ('取消客厅灯对应的要求',delta('retract',[0],[],'explicit_named')),
  ('其余任务照旧',delta('retain')),
  ('所有家居任务全部作废',delta('clear'))]),
 ('v4-level-pair',[
  ('书房灯设成30%；客厅窗户设成70%',delta('add',[9,3],[3,4],'explicit')),
  ('这个窗户数值换成30%',delta('revise',[3],[3],'focus_coreference')),
  ('先搁置该项',delta('pause',[3],[],'focus_coreference')),
  ('恢复该项的执行',delta('resume',[3],[],'focus_coreference')),
  ('写一段产品发布文案',delta('ood'))]),
 ('v4-correction',[
  ('主卧灯关闭',delta('add',[4],[1],'explicit')),
  ('不对，上一项应当打开',delta('revise',[4],[2],'focus_coreference')),
  ('书房窗户关闭',delta('add',[10],[1],'explicit')),
  ('撤掉刚提到的要求',delta('retract',[10],[],'focus_coreference')),
  ('现有意图先不要变化',delta('retain'))]),
 ('v4-clear-after-ood',[
  ('客厅窗户开启',delta('add',[2],[2],'explicit')),
  ('分析一下这部电影的叙事结构',delta('ood')),
  ('主卧灯设成70%',delta('add',[5],[4],'explicit')),
  ('两个家居要求都先保留',delta('retain')),
  ('撤销当前全部意图',delta('clear'))]),
 ('v4-three-room-sequence',[
  ('书房灯打开',delta('add',[8],[2],'explicit')),
  ('客厅窗户设成30%',delta('add',[3],[3],'explicit')),
  ('主卧灯关掉',delta('add',[4],[1],'explicit')),
  ('把主卧灯那条删除',delta('retract',[4],[],'explicit_named')),
  ('前两项保持有效',delta('retain'))]),
 ('v4-interruption-resume',[
  ('主卧窗户打开',delta('add',[6],[2],'explicit')),
  ('暂停当前窗口任务',delta('pause',[6],[],'focus_coreference')),
  ('帮我列出五本历史书',delta('ood')),
  ('回到先前暂停的控制',delta('resume',[6],[],'focus_coreference')),
  ('然后改成关闭',delta('revise',[6],[1],'focus_coreference'))]),
 ('v4-two-values',[
  ('客厅灯设置为70%，并且主卧窗户设置为30%',delta('add',[1,7],[4,3],'explicit')),
  ('将最后一项提高到70%',delta('revise',[7],[4],'focus_coreference')),
  ('删除客厅灯这项设置',delta('retract',[1],[],'explicit_named')),
  ('当前剩余要求不变',delta('retain')),
  ('全部清零',delta('clear'))]),
]

def blind_v4():
 out=[]
 for name,items in SPECS:
  state=empty_state();turns=[]
  for text,d in items:
   before=copy.deepcopy(state);state=apply(state,d)
   turns.append({'text':text,'before':before,'delta':d,'after':copy.deepcopy(state)})
  out.append({'id':name,'turns':turns})
 return out
