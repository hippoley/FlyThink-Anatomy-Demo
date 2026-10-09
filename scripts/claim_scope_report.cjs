"use strict";

/**
 * Produce a claim-scope-preserving report from FlyThink execution verification.
 *
 * This deliberately keeps seven questions separate:
 * 1) was an execution record internally verified?
 * 2) was the exact action bound to the retained authorization receipt?
 * 3) was the authorization Trust Domain / signing-key source externally verified?
 * 4) when an issuer identity is part of the profile, was that issuer authenticated?
 * 5) did the downstream controller report success?
 * 6) did identified fresh readback satisfy the precommitted completion criterion?
 * 7) was the object-level outcome independently observed outside that control path?
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

  // claim-scope-report.v1 is a projection over FlyThink's current verifier.
  // No trusted external Transaction Token/workload-identity adapter is wired
  // into that verifier yet, so caller-supplied JSON must never mint either
  // external authorization-trust claim.
  const authorizationTrustDomainKeySourceVerified=false;
  const authorizationIssuerAuthenticated=false;

  const controllerReportVerified=allTrue(verification,[
    "target_binding_verified",
    "ack_verified"
  ]);

  const physicalEffectVerified=verification.physical_completion_verified===true;

  // Current execution-receipt.v1 has no external trust adapter capable of
  // establishing failure-domain / observer independence. Caller-supplied JSON
  // must never promote an integrated controller readback into this stronger claim.
  const independentObjectOutcomeVerified=false;

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
          "the authorization trust domain or configured signing-key source was externally verified",
          "an optional authorization issuer identity was authenticated",
          "a named human approved the action",
          "a downstream controller succeeded",
          "the intended physical effect occurred"
        ]
      },
      authorization_trust_domain:{
        status:authorizationTrustDomainKeySourceVerified?"VERIFIED":"UNVERIFIED",
        proves:authorizationTrustDomainKeySourceVerified
          ?"the authorization token was verified against a configured Trust Domain and signing-key source"
          :"no external Trust Domain/signing-key-source claim is established by execution-receipt.v1",
        does_not_prove:[
          "an optional issuer identity was authenticated unless separately established",
          "the action was safe, legal or beneficial",
          "the intended physical effect occurred"
        ]
      },
      authorization_issuer:{
        status:authorizationIssuerAuthenticated?"VERIFIED":"UNVERIFIED",
        proves:authorizationIssuerAuthenticated
          ?"an optional issuer identity configured by the authorization profile was authenticated"
          :"no optional issuer-authenticity claim is established by execution-receipt.v1",
        does_not_prove:[
          "the authorization Trust Domain or signing-key source was verified unless separately established",
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
          "a named human approved the action",
          "the object-level outcome was independently observed outside the controller/readback path"
        ]
      },
      independent_object_outcome:{
        status:independentObjectOutcomeVerified?"VERIFIED":"UNVERIFIED",
        proves:independentObjectOutcomeVerified
          ?"an independently separated object-level observer verified the intended outcome"
          :"no independent object-level observer claim is established by execution-receipt.v1",
        does_not_prove:[
          "the action was safe, legal or beneficial",
          "the authorization trust domain or issuer was trusted"
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
