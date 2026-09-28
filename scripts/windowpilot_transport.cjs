"use strict";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class WindowPilotTransport {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || process.env.WINDOWPILOT_BASE_URL || "").replace(/\/+$/,"");
    this.expectedIdentitySha = String(
      options.expectedIdentitySha ||
      process.env.WINDOWPILOT_HARDWARE_IDENTITY_SHA256 ||
      ""
    ).trim();
    this.allowPhysicalWrite = options.allowPhysicalWrite != null
      ? !!options.allowPhysicalWrite
      : process.env.WINDOWPILOT_ALLOW_PHYSICAL_WRITE === "1";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.nowFn = options.nowFn || (() => Date.now() / 1000);
    this.sleepFn = options.sleepFn || sleepMs;
    this.maxFeedbackAgeS = Number(options.maxFeedbackAgeS ?? 10);
    this.maxFutureSkewS = Number(options.maxFutureSkewS ?? 2);
    this.pollAttempts = Number(options.pollAttempts ?? 6);
    this.pollIntervalMs = Number(options.pollIntervalMs ?? 500);
    this.positionTolerance = Number(options.positionTolerance ?? 1);
    this.authHeader = options.authHeader || process.env.WINDOWPILOT_AUTH_HEADER || null;
    this.authValue = options.authValue || process.env.WINDOWPILOT_AUTH_VALUE || null;
  }

  _assertConfig() {
    if (!this.baseUrl) throw new Error("windowpilot_base_url_missing");
    if (typeof this.fetchImpl !== "function") throw new Error("windowpilot_fetch_unavailable");
    if (!this.allowPhysicalWrite) throw new Error("physical_write_not_explicitly_enabled");
    if (!this.expectedIdentitySha) throw new Error("windowpilot_hardware_identity_sha256_missing");
    if (Boolean(this.authHeader) !== Boolean(this.authValue)) {
      throw new Error("windowpilot_auth_header_value_mismatch");
    }
  }

  async _json(method, path, body) {
    const headers = {"Content-Type":"application/json"};
    if (this.authHeader && this.authValue) headers[this.authHeader] = this.authValue;
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    if (!response || response.ok !== true) {
      const status = response && response.status != null ? response.status : "unknown";
      throw new Error("windowpilot_http_error:" + status + ":" + path);
    }
    return await response.json();
  }

  _validateMeasuredFeedback(feedback) {
    if (!feedback || feedback.measured !== true) {
      throw new Error("windowpilot_feedback_not_measured");
    }
    const ts = Number(feedback.timestamp);
    const pct = Number(feedback.position_pct);
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error("windowpilot_feedback_timestamp_missing");
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error("windowpilot_feedback_position_invalid");
    }
    const age = this.nowFn() - ts;
    if (age > this.maxFeedbackAgeS) {
      throw new Error("windowpilot_feedback_stale:" + age.toFixed(3));
    }
    if (age < -this.maxFutureSkewS) {
      throw new Error("windowpilot_feedback_future:" + (-age).toFixed(3));
    }
    return pct;
  }

  async preflight() {
    this._assertConfig();
    const report = await this._json("GET","/api/physical-readiness");

    if (report.physical_write_ready !== true) {
      const blockers = Array.isArray(report.write_blockers)
        ? report.write_blockers.join(";")
        : "not_ready";
      throw new Error("windowpilot_physical_write_not_ready:" + blockers);
    }

    const caps = report.backend || {};
    if (caps.simulated !== false) throw new Error("windowpilot_backend_is_simulated");
    if (caps.measured_position !== true) throw new Error("windowpilot_measured_position_not_declared");
    if (caps.stop_supported !== true) throw new Error("windowpilot_stop_not_supported");

    const identity = report.hardware_identity || {};
    if (identity.identity_sha256 !== this.expectedIdentitySha) {
      throw new Error("windowpilot_hardware_identity_mismatch");
    }
    const model = identity.product_model || identity.thingmodel_product_model;
    if (model && model !== "CWDS-CA01") {
      throw new Error("windowpilot_unexpected_product_model:" + model);
    }

    this._validateMeasuredFeedback(report.latest_position_feedback);
    return clone(report);
  }

  _translate(command) {
    if (!command || command.product_model !== "CWDS-CA01") {
      throw new Error("windowpilot_unsupported_product_model");
    }
    if (command.module !== "motor_1") {
      throw new Error("windowpilot_unsupported_module");
    }

    if (command.code === "motorTargetPosition") {
      const target = Number(command.value);
      if (!Number.isFinite(target) || target < 0 || target > 100) {
        throw new Error("windowpilot_target_position_invalid");
      }
      return {path:"/api/window/open", body:{target_pct:target}};
    }

    if (command.code === "motorControl") {
      if (command.value === 0) return {path:"/api/window/open", body:{target_pct:100}};
      if (command.value === 1) return {path:"/api/window/close", body:{}};
      if (command.value === 2) return {path:"/api/window/stop", body:{}};
      throw new Error("windowpilot_motor_control_value_invalid");
    }

    throw new Error("windowpilot_unsupported_command:" + command.code);
  }

  async write(command) {
    const readiness = await this.preflight();
    const translated = this._translate(command);
    const response = await this._json("POST",translated.path,translated.body);
    if (response.ok !== true) throw new Error("windowpilot_command_rejected");
    return {
      accepted:true,
      service:"WindowPilot",
      path:translated.path,
      request:clone(translated.body),
      response:clone(response),
      hardware_identity:clone(readiness.hardware_identity)
    };
  }

  async _positionFeedback() {
    const payload = await this._json("GET","/api/capabilities");
    const feedback = payload && payload.position_feedback;
    const pct = this._validateMeasuredFeedback(feedback);
    return {pct,feedback:clone(feedback)};
  }

  async read(descriptor, context = {}) {
    if (!descriptor || descriptor.code !== "motorCurrentPosition") {
      throw new Error("windowpilot_unsupported_feedback_descriptor");
    }

    const expected = context.expectation && context.expectation.slot === "opening"
      ? Number(context.expectation.value)
      : null;

    let last = null;
    for (let attempt=1; attempt<=this.pollAttempts; attempt++) {
      last = await this._positionFeedback();
      if (!Number.isFinite(expected) || Math.abs(last.pct - expected) <= this.positionTolerance) {
        return last.pct;
      }
      if (attempt < this.pollAttempts) await this.sleepFn(this.pollIntervalMs);
    }

    // A valid measured value that has not reached the requested target is still
    // evidence. Return it so the runtime records MISMATCH instead of inventing success.
    return last.pct;
  }
}

module.exports = {WindowPilotTransport};
