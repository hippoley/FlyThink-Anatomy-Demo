"use strict";

/**
 * Produce a claim-scope-preserving report from FlyThink execution verification.
 *
 * This deliberately keeps four questions separate:
 * 1) was an execution record internally verified?
 * 2) was the exact action authorization bound and verified?
 * 3) did the downstream controller report success?
 * 4) was the intended physical effect independently witnessed?
 *
 * A stronger claim is never inferred from a weaker one.
 */

function allTrue(v, names){
  return names.every(k=>v&&v[k]===true);
}

function buildClaimScopeReport(verification={}){
  const executionRecordVerified=allTrue(verification,[
    "authorization_receipt_integrity_verified",
    "authorization_binding_verified",
    "logical_target_binding_verified"
  ]);

  const executionAuthorizationBindingVerified=allTrue(verification,[
    "authorization_receipt_integrity_verified",
    "authorization_receipt_patches_verified",
    "authorization_patch_digest_verified",
    "authorization_id_verified",
    "authorization_single_use_verified",
    "authorization_case_id_verified",
    "authorization_source_step_verified",
    "authorization_source_revision_verified",
    "authorization_binding_verified",
    "logical_target_binding_verified"
  ]);

  const authorizationIssuerAuthenticated=
    verification.authorization_issuer_authenticated_verified===true;

  const controllerReportVerified=allTrue(verification,[
    "target_binding_verified",
    "ack_verified"
  ]);

  const physicalEffectVerified=verification.physical_completion_verified===true;

  let physicalStatus="NOT_VERIFIED";
  if(physicalEffectVerified)physicalStatus="VERIFIED";
  else if(
    verification.physical_truth_verified===true||
    verification.ack_verified===true||
    verification.measured_readback_verified===true
  )physicalStatus="INDETERMINATE";

  return {
    schema_version:"claim-scope-report.v1",
    claims:{
      execution_record:{
        status:executionRecordVerified?"VERIFIED":"NOT_VERIFIED",
        proves:"the recorded execution evidence is internally bound under FlyThink verification semantics",
        does_not_prove:[
          "a named human approved the action",
          "a downstream controller succeeded",
          "the intended physical effect occurred"
        ]
      },
      execution_authorization:{
        status:executionAuthorizationBindingVerified?"VERIFIED":"NOT_VERIFIED",
        proves:"the exact action is internally bound to the retained SpatialRuntime authorization receipt under FlyThink validation semantics",
        does_not_prove:[
          "the authorization receipt was issued by a trusted external authority",
          "a named human approved the action",
          "a downstream controller succeeded",
          "the intended physical effect occurred"
        ]
      },
      authorization_issuer:{
        status:authorizationIssuerAuthenticated?"VERIFIED":"UNVERIFIED",
        proves:authorizationIssuerAuthenticated
          ?"the authorization issuer was authenticated by an external trust layer"
          :"no issuer-authenticity claim is established by execution-receipt.v1",
        does_not_prove:[
          "the action was safe, legal or beneficial",
          "the intended physical effect occurred"
        ]
      },
      controller_report:{
        status:controllerReportVerified?"VERIFIED":"NOT_VERIFIED",
        proves:"an identified execution path returned an ACK for the bound target",
        does_not_prove:[
          "the intended physical effect occurred",
          "the action was safe, legal or beneficial"
        ]
      },
      physical_effect:{
        status:physicalStatus,
        proves:physicalEffectVerified
          ?"the intended physical effect satisfied a precommitted criterion under identified fresh witness evidence"
          :"no physical-effect claim is established",
        does_not_prove:[
          "the action was safe, legal or beneficial",
          "a named human approved the action"
        ]
      }
    }
  };
}

module.exports={buildClaimScopeReport};

if(require.main===module){
  let data="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data",c=>data+=c);
  process.stdin.on("end",()=>{
    const input=JSON.parse(data||"{}");
    process.stdout.write(JSON.stringify(buildClaimScopeReport(input),null,2)+"\n");
  });
}
