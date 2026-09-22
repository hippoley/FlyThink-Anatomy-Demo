"""Persistent intent commit boundary; this module is not a language model.

Neural snapshots are proposals, never authoritative replacement state. Destructive
operations require explicit command authorization in addition to a neural proposal.
No device action is performed here.
"""
from copy import deepcopy
from dialogue_state_corpus import KEYS, VALUES

CLEAR_COMMANDS = {'全部撤回','全部取消','清空所有意图','清空所有任务','把所有任务一起撤回','之前所有要求都取消掉'}
RETRACT_COMMANDS = {'撤回刚才那一项','取消刚才的那条指令','刚才那条当我没说','撤掉上一个要求吧'}


def empty_tree():
    return {'goals':{},'paused':[],'focus':None,'ood_pending':False,'pending_ood':[],'revision':0}


def commit(tree, proposal, utterance):
    after = deepcopy(tree)
    op = proposal.get('operation')
    text = utterance.strip().rstrip('。！!')
    focus = tree.get('focus')
    valid = {k:v for k,v in proposal.get('goals',{}).items() if k in KEYS and v in VALUES[1:]}
    changes = []
    if op == 'clear':
        if text not in CLEAR_COMMANDS:
            return after, {'status':'clarify','reason':'clear_not_explicitly_authorized','changes':[]}
        after = empty_tree(); changes = [{'op':'clear'}]
    elif op == 'retract':
        if text not in RETRACT_COMMANDS or focus not in after['goals']:
            return after, {'status':'clarify','reason':'retraction_target_or_authorization_unresolved','changes':[]}
        del after['goals'][focus]
        after['paused'] = [k for k in after['paused'] if k != focus]
        after['focus'] = None; changes = [{'op':'remove','key':focus}]
    elif op == 'add':
        for key,value in valid.items():
            if key not in after['goals']:
                after['goals'][key]=value; changes.append({'op':'add','key':key,'value':value})
            elif after['goals'][key] != value:
                # Only the proposed focused slot may revise an existing value.
                if key == proposal.get('focus'):
                    after['goals'][key]=value; changes.append({'op':'patch','key':key,'value':value})
        if proposal.get('focus') in valid:
            after['focus']=proposal['focus']
    elif op == 'revise':
        if focus is None or proposal.get('focus') != focus or focus not in valid:
            return after, {'status':'clarify','reason':'revision_reference_unresolved','changes':[]}
        after['goals'][focus]=valid[focus]; changes=[{'op':'patch','key':focus,'value':valid[focus]}]
    elif op in {'pause','resume'}:
        if focus not in after['goals']:
            return after, {'status':'clarify','reason':'task_reference_unresolved','changes':[]}
        after['paused']=[k for k in after['paused'] if k!=focus]
        if op=='pause': after['paused'].append(focus)
        changes=[{'op':op,'key':focus}]
    elif op=='ood':
        after['ood_pending']=True
        after['pending_ood'].append({'id':'ood:'+str(tree['revision']+1),'text':utterance,'status':'pending'})
        changes=[{'op':'mount_pending_ood'}]
    elif op!='retain':
        return after, {'status':'clarify','reason':'unknown_operation','changes':[]}
    after['revision']=tree['revision']+1
    return after, {'status':'accepted_proposal_not_device_execution','changes':changes}
