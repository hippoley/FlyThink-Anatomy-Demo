"use strict";
const assert=require("assert");
const {
  AsrEventSequenceGuard,
  toStreamingSessionEvent
}=require("../scripts/asr_event_bridge.cjs");

function e(kind,text,segment_id,revision){
  return {type:"asr_hypothesis",kind,text,segment_id,revision,source:"test"};
}

{
  const g=new AsrEventSequenceGuard();
  g.accept(e("partial","把客厅",1,1));
  g.accept(e("stable","把客厅",1,1));
  g.accept(e("partial","把主卧",1,2));
  const f=g.accept(e("final","把主卧空调调到24度",1,3));
  assert.equal(f.kind,"final");
  const next=g.accept(e("partial","打开窗户",2,1));
  assert.equal(next.segment_id,2);
}

{
  const g=new AsrEventSequenceGuard();
  g.accept(e("partial","开",1,1));
  assert.throws(
    ()=>g.accept(e("partial","关",2,1)),
    /advanced_before_final/
  );
}

{
  const g=new AsrEventSequenceGuard();
  g.accept(e("partial","开窗",1,2));
  assert.throws(
    ()=>g.accept(e("partial","开",1,1)),
    /revision_rollback/
  );
}

{
  const g=new AsrEventSequenceGuard();
  g.accept(e("partial","开窗",1,1));
  g.accept(e("final","开窗",1,1));
  assert.throws(
    ()=>g.accept(e("partial","旧结果",1,2)),
    /after_segment_final/
  );
}

{
  const x=toStreamingSessionEvent(e("stable","客厅空调26度",3,4));
  assert.equal(x.kind,"stable");
  assert.equal(x.turn_id,"asr:3");
  assert.equal(x.asr_meta.revision,4);
}

console.log(JSON.stringify({ok:true,contract:"ordered revision-aware ASR event bridge"}));
