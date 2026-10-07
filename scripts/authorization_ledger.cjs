"use strict";
const fs=require("fs");
const path=require("path");

class FileAuthorizationLedger{
  constructor(filePath){
    if(!filePath)throw new Error("authorization_ledger_path_required");
    this.filePath=filePath;
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
    const tmp=this.filePath+".tmp-"+process.pid+"-"+Date.now();
    fs.writeFileSync(tmp,JSON.stringify(this.state,null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
    fs.renameSync(tmp,this.filePath);
  }
  status(id){this._refresh();return this.state.authorizations[id]?.status||"fresh";}
  has(id){return this.status(id)!=="fresh";}
  reserve(id,metadata={}){
    if(!id)throw new Error("authorization_id_required");
    this._refresh();
    if(this.state.authorizations[id])return false;
    this.state.authorizations[id]={status:"reserved",...metadata,reserved_at:new Date().toISOString()};
    this._persist();
    return true;
  }
  consume(id,metadata={}){
    this._refresh();
    const current=this.state.authorizations[id];
    if(!current||current.status!=="reserved")return false;
    this.state.authorizations[id]={...current,...metadata,status:"consumed",consumed_at:new Date().toISOString()};
    this._persist();
    return true;
  }
  release(id,reason="commit_failed"){
    this._refresh();
    const current=this.state.authorizations[id];
    if(!current||current.status!=="reserved")return false;
    delete this.state.authorizations[id];
    this._persist();
    return true;
  }
}
module.exports={FileAuthorizationLedger};
