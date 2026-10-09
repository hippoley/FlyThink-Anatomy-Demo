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
    this.reservationsDir=filePath+".reservations";
    this.state=this._load();
  }

  _loadSnapshot(){
    if(!fs.existsSync(this.filePath)){
      return {version:1,consumed:nullMap()};
    }
    const parsed=JSON.parse(fs.readFileSync(this.filePath,"utf8"));
    if(!parsed||parsed.version!==1||!parsed.consumed||typeof parsed.consumed!=="object"||Array.isArray(parsed.consumed)){
      throw new Error("authorization_ledger_invalid");
    }
    return {version:1,consumed:nullMap(parsed.consumed)};
  }

  _load(){
    const state=this._loadSnapshot();
    if(!fs.existsSync(this.reservationsDir))return state;
    for(const name of fs.readdirSync(this.reservationsDir)){
      if(!name.endsWith(".json"))continue;
      const markerPath=path.join(this.reservationsDir,name);
      let marker;
      try{
        marker=JSON.parse(fs.readFileSync(markerPath,"utf8"));
      }catch(_){
        throw new Error("authorization_ledger_reservation_invalid");
      }
      if(
        !marker||marker.version!==1||
        typeof marker.authorization_id!=="string"||
        marker.authorization_id.length===0||
        sha256Text(marker.authorization_id)+".json"!==name||
        typeof marker.consumed_at!=="string"
      ){
        throw new Error("authorization_ledger_reservation_invalid");
      }
      state.consumed[marker.authorization_id]={
        ...(clone(marker.metadata)||{}),
        consumed_at:marker.consumed_at
      };
    }
    return state;
  }

  _reservationPath(id){
    return path.join(this.reservationsDir,sha256Text(id)+".json");
  }

  _reservationExists(id){
    return fs.existsSync(this._reservationPath(id));
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

    // Refresh from the append-only reservation journal. The JSON file is only a
    // reconstructable snapshot and is never the single-use authority.
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
      // O_EXCL is the linearization point. Across processes, exactly one
      // contender can reserve this authorization ID.
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

    // Reservation is authoritative. If snapshot persistence fails or the
    // process crashes after this point, future readers reconstruct consumption
    // from the marker and fail closed. Concurrent different IDs need no global
    // writer lock: later reads merge every durable marker.
    this.state=this._load();
    this._persistState();
    return true;
  }
}

module.exports={FileAuthorizationLedger,sha256Text};
