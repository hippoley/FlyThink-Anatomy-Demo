"use strict";
const crypto=require("crypto");
const fs=require("fs");
const path=require("path");

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function nullMap(value={}){
  return Object.assign(Object.create(null),value||{});
}
function sha256Text(value){
  return crypto.createHash("sha256").update(String(value),"utf8").digest("hex");
}

class FileAuthorizationLedger{
  constructor(filePath){
    if(!filePath)throw new Error("authorization_ledger_path_required");
    this.filePath=filePath;
    this.lockPath=filePath+".lock";
    this.reservationsDir=filePath+".reservations";
    this.state=this._load();
  }

  _load(){
    if(!fs.existsSync(this.filePath)){
      return {version:1,consumed:nullMap()};
    }
    const parsed=JSON.parse(fs.readFileSync(this.filePath,"utf8"));
    if(!parsed||parsed.version!==1||!parsed.consumed||typeof parsed.consumed!=="object"||Array.isArray(parsed.consumed)){
      throw new Error("authorization_ledger_invalid");
    }
    return {version:1,consumed:nullMap(parsed.consumed)};
  }

  _reservationPath(id){
    return path.join(this.reservationsDir,sha256Text(id)+".json");
  }

  _reservationExists(id){
    return fs.existsSync(this._reservationPath(id));
  }

  _acquireLock(){
    const dir=path.dirname(this.filePath);
    fs.mkdirSync(dir,{recursive:true});
    let fd;
    try{
      fd=fs.openSync(this.lockPath,"wx",0o600);
      const owner=JSON.stringify({
        version:1,
        pid:process.pid,
        acquired_at:new Date().toISOString()
      })+"\n";
      fs.writeFileSync(fd,owner,{encoding:"utf8"});
      fs.fsyncSync(fd);
      return fd;
    }catch(err){
      if(fd!=null){
        try{fs.closeSync(fd)}catch(_){}
      }
      if(err&&err.code==="EEXIST"){
        throw new Error("authorization_ledger_locked");
      }
      throw err;
    }
  }

  _releaseLock(fd){
    try{if(fd!=null)fs.closeSync(fd)}finally{
      try{fs.unlinkSync(this.lockPath)}catch(err){
        if(!err||err.code!=="ENOENT")throw err;
      }
    }
  }

  _persistState(){
    const dir=path.dirname(this.filePath);
    fs.mkdirSync(dir,{recursive:true});
    const tmp=this.filePath+".tmp-"+process.pid+"-"+crypto.randomBytes(6).toString("hex");
    const payload=JSON.stringify({
      version:1,
      consumed:this.state.consumed
    },null,2)+"\n";
    let fd;
    try{
      fd=fs.openSync(tmp,"wx",0o600);
      fs.writeFileSync(fd,payload,{encoding:"utf8"});
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd=null;
      fs.renameSync(tmp,this.filePath);
      try{fs.chmodSync(this.filePath,0o600)}catch(_){}
    }finally{
      if(fd!=null){
        try{fs.closeSync(fd)}catch(_){}
      }
      try{fs.unlinkSync(tmp)}catch(err){
        if(!err||err.code!=="ENOENT")throw err;
      }
    }
  }

  has(id){
    if(!id)return false;
    if(this._reservationExists(id))return true;
    this.state=this._load();
    return Object.prototype.hasOwnProperty.call(this.state.consumed,String(id));
  }

  add(id,metadata={}){
    if(!id)throw new Error("authorization_id_required");
    const key=String(id);
    const lockFd=this._acquireLock();
    try{
      // Re-read only after exclusive acquisition. A stale in-memory snapshot
      // must never let two processes consume the same authorization.
      this.state=this._load();
      if(
        Object.prototype.hasOwnProperty.call(this.state.consumed,key)||
        this._reservationExists(key)
      ){
        return false;
      }

      fs.mkdirSync(this.reservationsDir,{recursive:true,mode:0o700});
      try{fs.chmodSync(this.reservationsDir,0o700)}catch(_){}

      const consumedAt=new Date().toISOString();
      const reservation={
        version:1,
        authorization_id:key,
        metadata:clone(metadata)||{},
        consumed_at:consumedAt
      };
      const reservationPath=this._reservationPath(key);
      let reservationFd;
      try{
        reservationFd=fs.openSync(reservationPath,"wx",0o600);
        fs.writeFileSync(
          reservationFd,
          JSON.stringify(reservation,null,2)+"\n",
          {encoding:"utf8"}
        );
        fs.fsyncSync(reservationFd);
      }catch(err){
        if(err&&err.code==="EEXIST")return false;
        throw err;
      }finally{
        if(reservationFd!=null){
          try{fs.closeSync(reservationFd)}catch(_){}
        }
      }

      // The O_EXCL reservation is the authoritative replay barrier. If the
      // process crashes after this point, the authorization remains consumed
      // (fail-closed) even if the human-readable snapshot was not updated.
      this.state.consumed[key]={
        ...(clone(metadata)||{}),
        consumed_at:consumedAt
      };
      this._persistState();
      return true;
    }finally{
      this._releaseLock(lockFd);
    }
  }
}

module.exports={FileAuthorizationLedger,sha256Text};
