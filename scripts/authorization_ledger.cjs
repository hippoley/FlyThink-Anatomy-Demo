"use strict";
const fs=require("fs");
const path=require("path");

function sleepMs(ms){
  const end=Date.now()+ms;
  while(Date.now()<end){}
}
class FileAuthorizationLedger{
  constructor(filePath,{lockTimeoutMs=5000,lockRetryMs=5}={}){
    if(!filePath)throw new Error("authorization_ledger_path_required");
    this.filePath=filePath;
    this.lockPath=filePath+".lock";
    this.lockTimeoutMs=lockTimeoutMs;
    this.lockRetryMs=lockRetryMs;
    this.state=this._load();
  }
  _load(){
    if(!fs.existsSync(this.filePath))return {version:2,authorizations:{}};
    const parsed=JSON.parse(fs.readFileSync(this.filePath,"utf8"));
    if(!parsed||parsed.version!==2||typeof parsed.authorizations!=="object")
      throw new Error("authorization_ledger_invalid");
    return parsed;
  }
  _refresh(){this.state=this._load();}
  _persist(){
    const dir=path.dirname(this.filePath);
    fs.mkdirSync(dir,{recursive:true});
    const tmp=this.filePath+".tmp-"+process.pid+"-"+Date.now()+"-"+Math.random().toString(16).slice(2);
    fs.writeFileSync(tmp,JSON.stringify(this.state,null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
    fs.renameSync(tmp,this.filePath);
  }
  _ownerAlive(pid){\n    if(!Number.isInteger(pid)||pid<=0)return false;\n    try{process.kill(pid,0);return true;}catch(e){return e.code==="EPERM";}\n  }\n  _recoverDeadOwnerLock(){\n    try{\n      const owner=JSON.parse(fs.readFileSync(this.lockPath,"utf8"));\n      if(this._ownerAlive(owner.pid))return false;\n      fs.unlinkSync(this.lockPath);\n      return true;\n    }catch(e){\n      if(e.code==="ENOENT")return true;\n      return false;\n    }\n  }\n  _withLock(fn){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    const deadline=Date.now()+this.lockTimeoutMs;
    let fd;
    while(true){
      try{
        fd=fs.openSync(this.lockPath,"wx",0o600);
        fs.writeFileSync(fd,JSON.stringify({pid:process.pid,acquired_at:new Date().toISOString()})+"\n");
        break;
      }catch(e){
        if(e.code!=="EEXIST")throw e;
        if(Date.now()>=deadline)throw new Error("authorization_ledger_lock_timeout");
        sleepMs(this.lockRetryMs);
      }
    }
    try{
      this._refresh();
      return fn();
    }finally{
      try{fs.closeSync(fd);}finally{
        try{fs.unlinkSync(this.lockPath);}catch(e){if(e.code!=="ENOENT")throw e;}
      }
    }
  }
  status(id){this._refresh();return this.state.authorizations[id]?.status||"fresh";}
  has(id){return this.status(id)!=="fresh";}
  reserve(id,metadata={}){
    if(!id)throw new Error("authorization_id_required");
    return this._withLock(()=>{
      if(this.state.authorizations[id])return false;
      this.state.authorizations[id]={status:"reserved",...metadata,reserved_at:new Date().toISOString()};
      this._persist();
      return true;
    });
  }
  consume(id,metadata={}){
    return this._withLock(()=>{
      const current=this.state.authorizations[id];
      if(!current||current.status!=="reserved")return false;
      this.state.authorizations[id]={...current,...metadata,status:"consumed",consumed_at:new Date().toISOString()};
      this._persist();
      return true;
    });
  }
  release(id,reason="commit_failed"){
    return this._withLock(()=>{
      const current=this.state.authorizations[id];
      if(!current||current.status!=="reserved")return false;
      delete this.state.authorizations[id];
      this._persist();
      return true;
    });
  }
}
module.exports={FileAuthorizationLedger};
