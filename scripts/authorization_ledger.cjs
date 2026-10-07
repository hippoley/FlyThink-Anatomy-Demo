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
    if(!fs.existsSync(this.filePath))return {version:1,consumed:{}};
    const parsed=JSON.parse(fs.readFileSync(this.filePath,"utf8"));
    if(!parsed||parsed.version!==1||typeof parsed.consumed!=="object")
      throw new Error("authorization_ledger_invalid");
    return parsed;
  }
  has(id){return !!this.state.consumed[id];}
  add(id,metadata={}){
    if(!id)throw new Error("authorization_id_required");
    if(this.has(id))return false;
    this.state.consumed[id]={...metadata,consumed_at:new Date().toISOString()};
    const dir=path.dirname(this.filePath);
    fs.mkdirSync(dir,{recursive:true});
    const tmp=this.filePath+".tmp-"+process.pid;
    fs.writeFileSync(tmp,JSON.stringify(this.state,null,2)+"\n",{encoding:"utf8",mode:0o600});
    fs.renameSync(tmp,this.filePath);
    return true;
  }
}
module.exports={FileAuthorizationLedger};
