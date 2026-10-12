'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const a=html.indexOf('function turnJourneyData('),b=html.indexOf('\nfunction selectTurnJourneyStage(',a);
assert(a>=0&&b>a,'turn journey implementation missing');
const state={intentTree:{},turn:1,focus:null,focusKey:null};
const env={state,THINGREG:{model_count:46},CAPINDEX:{count:794},
 friendlyTurn:exec=>({title:'no device changed',detail:'not committed',blocked:false})};
vm.createContext(env);
const make=exec=>vm.runInContext(html.slice(a,b)+'\nturnJourneyData("hello",{op:"NO_OP"},exec,{})',Object.assign(env,{exec}));
const noWrite=make({route:'STATE_ONLY',nodes:[],outputs:[],worldDeltas:[]});
assert.equal(noWrite.at(-1).badge,'NO DEVICE WRITE');
const written=make({route:'THING_MODEL_EXECUTE',nodes:[],outputs:[],worldDeltas:[{key:'light',before:0,after:30}]});
assert.equal(written.at(-1).badge,'COMMITTED SIMULATION');
console.log('PASS journey labels distinguish zero device writes from simulated commit');
