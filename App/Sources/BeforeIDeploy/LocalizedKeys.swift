import Foundation

/// Catalog keys for values the engine sends as enums (severity, release state, …). Kept as literal
/// switches so `scripts/i18n-check.mjs` can prove every key exists in both languages; an unknown value
/// falls back to the value itself rather than showing a raw key.
enum K {
    static func severity(_ v: String) -> String {
        switch v {
        case "blocker": return L("issue.severity.blocker")
        case "high": return L("issue.severity.high")
        case "medium": return L("issue.severity.medium")
        case "low": return L("issue.severity.low")
        case "info": return L("issue.severity.info")
        default: return v
        }
    }

    static func kind(_ v: String) -> String {
        switch v {
        case "defect": return L("issue.kind.defect")
        case "recommendation": return L("issue.kind.recommendation")
        case "signal": return L("issue.kind.signal")
        default: return v
        }
    }

    static func confidence(_ v: String) -> String {
        switch v {
        case "confirmed": return L("issue.confidence.confirmed")
        case "likely": return L("issue.confidence.likely")
        case "heuristic": return L("issue.confidence.heuristic")
        default: return v
        }
    }

    static func risk(_ v: String) -> String {
        switch v {
        case "low": return L("issue.risk.low")
        case "medium": return L("issue.risk.medium")
        case "high": return L("issue.risk.high")
        default: return v
        }
    }

    static func fixUI(_ v: String) -> String {
        switch v {
        case "commit": return L("issue.fix.ui.commit")
        case "netlify-setup": return L("issue.fix.ui.netlify-setup")
        case "hosting-chooser": return L("issue.fix.ui.hosting-chooser")
        default: return L("issue.fix.ui.setup")
        }
    }

    static func releaseState(_ v: String) -> String {
        switch v {
        case "created": return L("release.state.created")
        case "preview_running": return L("release.state.preview_running")
        case "awaiting_confirmation": return L("release.state.awaiting_confirmation")
        case "promoting": return L("release.state.promoting")
        case "verifying": return L("release.state.verifying")
        case "succeeded": return L("release.state.succeeded")
        case "failed": return L("release.state.failed")
        case "verify_failed": return L("release.state.verify_failed")
        case "cancelled": return L("release.state.cancelled")
        case "stale": return L("release.state.stale")
        case "interrupted": return L("release.state.interrupted")
        default: return v
        }
    }

    static func releaseStage(_ v: String) -> String {
        switch v {
        case "check": return L("release.stage.check")
        case "preview": return L("release.stage.preview")
        case "smoke": return L("release.stage.smoke")
        case "promote": return L("release.stage.promote")
        case "verify": return L("release.stage.verify")
        default: return v
        }
    }

    static func capability(_ v: String) -> String {
        switch v {
        case "preview": return L("release.cap.preview")
        case "production": return L("release.cap.production")
        case "status": return L("release.cap.status")
        case "rollback": return L("release.cap.rollback")
        case "publishArtifact": return L("release.cap.publishArtifact")
        default: return v
        }
    }

    static func rollbackReason(_ v: String?) -> String {
        switch v {
        case "no_previous": return L("release.rollback.reason.no_previous")
        default: return L("release.rollback.reason.unsupported")
        }
    }

    static func actor(_ v: String) -> String {
        switch v {
        case "app": return L("release.actor.app")
        case "cli": return L("release.actor.cli")
        default: return v
        }
    }

    static func deployContext(_ v: String?) -> String {
        v == "production" ? L("release.deploy.production") : L("release.deploy.preview")
    }

    static func signalState(_ v: String) -> String {
        switch v {
        case "healthy": return L("signal.healthy")
        case "problem": return L("signal.problem")
        case "stale": return L("signal.stale")
        case "unsupported": return L("signal.unsupported")
        default: return L("signal.unchecked")
        }
    }

    static func incidentKind(_ v: String) -> String {
        switch v {
        case "down": return L("incident.kind.down")
        case "ssl": return L("incident.kind.ssl")
        case "domain": return L("incident.kind.domain")
        default: return v
        }
    }

    // MARK: V11 RC — usage / billing / assistant enums

    static func subscriptionStatus(_ v: String) -> String {
        switch v {
        case "active": return L("usage.status.active")
        case "trial": return L("usage.status.trial")
        case "past_due": return L("usage.status.past_due")
        case "canceled": return L("usage.status.canceled")
        case "expired": return L("usage.status.expired")
        default: return v
        }
    }

    static func usageStatus(_ v: String) -> String {
        switch v {
        case "ok": return L("usage.op.ok")
        case "pending": return L("usage.op.pending")
        case "orphaned": return L("usage.op.orphaned")
        case "truncated": return L("usage.op.truncated")
        case "refused": return L("usage.op.refused")
        case "error": return L("usage.op.error")
        default: return v
        }
    }

    static func ledgerReason(_ v: String) -> String {
        switch v {
        case "plan_grant": return L("usage.reason.plan_grant")
        case "trial_grant": return L("usage.reason.trial_grant")
        case "topup": return L("usage.reason.topup")
        case "ai_fix": return L("usage.reason.ai_fix")
        case "hold": return L("usage.reason.hold")
        case "admin_grant": return L("usage.reason.admin_grant")
        case "refund": return L("usage.reason.refund")
        case "expiry": return L("usage.reason.expiry")
        default: return v
        }
    }

    static func bucket(_ v: String) -> String {
        switch v {
        case "plan": return L("usage.bucket.plan")
        case "topup": return L("usage.bucket.topup")
        case "hold": return L("usage.bucket.hold")
        default: return v
        }
    }

    static func assistantAction(_ v: String) -> String {
        switch v {
        case "ask": return L("assistant.action.ask")
        case "diagnose": return L("assistant.action.diagnose")
        case "propose": return L("assistant.action.propose")
        case "fix": return L("assistant.action.fix")
        case "review": return L("assistant.action.review")
        case "explain": return L("assistant.action.explain")
        case "readiness": return L("assistant.action.readiness")
        case "triage": return L("assistant.action.triage")
        default: return v
        }
    }

    static func assistantStopped(_ v: String?) -> String? {
        switch v {
        case nil: return nil
        case "invalid_output": return L("assistant.stopped.invalid_output")
        case "needs_input": return L("assistant.stopped.needs_input")
        case "no_change": return L("assistant.stopped.no_change")
        case "stale_base_hash": return L("assistant.stopped.stale_base_hash")
        case "needs_confirmation": return L("assistant.stopped.needs_confirmation")
        case "not_applicable": return L("assistant.stopped.not_applicable")
        case "no_progress": return L("assistant.stopped.no_progress")
        case "regression": return L("assistant.stopped.regression")
        case "max_iterations": return L("assistant.stopped.max_iterations")
        case "budget": return L("assistant.stopped.budget")
        case "cancelled": return L("assistant.cancelled")
        default: return v
        }
    }

    static func evidenceKind(_ v: String) -> String {
        switch v {
        case "issue": return L("assistant.evidence.issue")
        case "log": return L("assistant.evidence.log")
        case "file": return L("assistant.evidence.file")
        case "git": return L("assistant.evidence.git")
        case "diff": return L("assistant.evidence.diff")
        case "incident": return L("assistant.evidence.incident")
        default: return v
        }
    }

    /// Field labels of the assistant's structured answers (engine/prompts/*.json output schemas).
    static func outputField(_ v: String) -> String {
        switch v {
        case "status": return L("assistant.field.status")
        case "engine_status", "engine_gate_status": return L("assistant.field.engine_status")
        case "observations": return L("assistant.field.observations")
        case "hypotheses": return L("assistant.field.hypotheses")
        case "impact": return L("assistant.field.impact")
        case "next_steps", "next_action", "proposed_next_action": return L("assistant.field.next_steps")
        case "missing_context", "missing_evidence": return L("assistant.field.missing_context")
        case "findings": return L("assistant.field.findings")
        case "required_checks", "recommended_checks", "completed_checks": return L("assistant.field.checks")
        case "remaining_uncertainties", "uncertainties": return L("assistant.field.uncertainties")
        case "blockers": return L("assistant.field.blockers")
        case "warnings": return L("assistant.field.warnings")
        case "unresolved": return L("assistant.field.unresolved")
        case "recovery_options": return L("assistant.field.recovery_options")
        case "timeline_summary": return L("assistant.field.timeline")
        case "evidence_ids": return L("assistant.field.evidence")
        default: return v.replacingOccurrences(of: "_", with: " ")
        }
    }
}
