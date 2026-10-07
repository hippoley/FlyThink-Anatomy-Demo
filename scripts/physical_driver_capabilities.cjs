"use strict";

const PHYSICAL_CAPABILITIES=Object.freeze({
  ATOMIC_MULTI_TARGET_SET:"atomic_multi_target_set",
  READBACK:"readback"
});

function declaredCapabilities(driver){
  if(!driver||typeof driver.capabilities!=="function") return new Set();
  const value=driver.capabilities();
  if(!Array.isArray(value)) throw new Error("physical_driver_invalid_capabilities");
  return new Set(value);
}

function requireCapability(driver,capability){
  let caps;
  try{caps=declaredCapabilities(driver);}
  catch(e){return {ok:false,reason:String(e.message||e)};}
  if(!caps.has(capability))
    return {ok:false,reason:"physical_capability_not_declared:"+capability};
  return {ok:true,reason:null};
}

module.exports={PHYSICAL_CAPABILITIES,declaredCapabilities,requireCapability};
