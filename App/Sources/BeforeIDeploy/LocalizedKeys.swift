import Foundation

/// Catalog keys for values the engine sends as enums (severity, release state, …). Kept as literal
/// switches so `scripts/i18n-check.mjs` can prove every key exists in both languages; an unknown value
/// shows an explicitly unknown value instead of pretending it is translated.
enum K {
    static func severity(_ v: String) -> String {
        switch v {
        case "blocker": return L("issue.severity.blocker")
        case "high": return L("issue.severity.high")
        case "medium": return L("issue.severity.medium")
        case "low": return L("issue.severity.low")
        case "info": return L("issue.severity.info")
        default: return other(v)
        }
    }

    static func kind(_ v: String) -> String {
        switch v {
        case "defect": return L("issue.kind.defect")
        case "recommendation": return L("issue.kind.recommendation")
        case "signal": return L("issue.kind.signal")
        default: return other(v)
        }
    }

    static func confidence(_ v: String) -> String {
        switch v {
        case "confirmed": return L("issue.confidence.confirmed")
        case "likely": return L("issue.confidence.likely")
        case "heuristic": return L("issue.confidence.heuristic")
        default: return other(v)
        }
    }

    static func risk(_ v: String) -> String {
        switch v {
        case "low": return L("issue.risk.low")
        case "medium": return L("issue.risk.medium")
        case "high": return L("issue.risk.high")
        default: return other(v)
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
        default: return other(v)
        }
    }

    static func releaseStage(_ v: String) -> String {
        switch v {
        case "check": return L("release.stage.check")
        case "preview": return L("release.stage.preview")
        case "smoke": return L("release.stage.smoke")
        case "promote": return L("release.stage.promote")
        case "verify": return L("release.stage.verify")
        default: return other(v)
        }
    }

    static func capability(_ v: String) -> String {
        switch v {
        case "preview": return L("release.cap.preview")
        case "production": return L("release.cap.production")
        case "status": return L("release.cap.status")
        case "rollback": return L("release.cap.rollback")
        case "publishArtifact": return L("release.cap.publishArtifact")
        default: return other(v)
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
        default: return other(v)
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
        default: return other(v)
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
        default: return other(v)
        }
    }

    static func usageStatus(_ v: String) -> String {
        switch v {
        case "ok": return L("usage.op.ok")
        case "pending": return L("usage.op.pending")
        case "orphaned": return L("usage.op.orphaned")
        case "truncated": return L("usage.op.truncated")
        case "refused": return L("usage.op.refused")
        case "error", "failed": return L("usage.op.error")
        case "unknown": return L("usage.op.unknown")
        default: return other(v)
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
        default: return other(v)
        }
    }

    static func bucket(_ v: String) -> String {
        switch v {
        case "plan": return L("usage.bucket.plan")
        case "topup": return L("usage.bucket.topup")
        case "hold": return L("usage.bucket.hold")
        default: return other(v)
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
        default: return other(v)
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
        default: return v.map(other)
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
        default: return other(v)
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
        default: return other(v)
        }
    }
}


extension K {
    static func assistantStatus(_ value: String) -> String {
        switch value {
        case "confirmed": return L("assistant.status.confirmed")
        case "likely": return L("assistant.status.likely")
        case "unverified": return L("assistant.status.unverified")
        default: return other(value)
        }
    }
    static func aiSkipReason(_ value: String) -> String {
        switch value {
        case "changed_since": return L("assistant.skip.changed")
        case "config_approval", "needs_approval": return L("assistant.skip.config")
        case "not_applicable": return L("assistant.skip.invalid")
        default: return L("assistant.skip.other", value)
        }
    }
}

extension K {
    static func other(_ value: String) -> String {
        AppLog.ui.debug("unmapped display value: \(value, privacy: .private)")
        return L("k.other", value)
    }
    static func role(_ value: String) -> String {
        switch value {
        case "normal": return L("k.role.normal")
        case "vip": return L("k.role.vip")
        case "admin": return L("k.role.admin")
        default: return other(value)
        }
    }
    static func plan(_ value: String) -> String {
        switch value {
        case "free": return L("k.plan.free")
        case "flash": return "Flash"
        case "high": return "High"
        case "knight": return "Knight"
        default: return other(value)
        }
    }
    static func provider(_ value: String) -> String {
        switch value {
        case "cloud": return L("k.provider.cloud")
        case "local": return L("k.provider.local")
        case "anthropic": return "Anthropic"
        case "apple": return "Apple"
        case "email": return L("auth.email")
        case "openai": return "OpenAI"
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "chatgpt": return "ChatGPT"
        case "netlify": return "Netlify"
        case "vercel": return "Vercel"
        case "cloudflare": return "Cloudflare Pages"
        case "ghpages": return "GitHub Pages"
        case "github": return "GitHub"
        case "spaceship": return "Spaceship"
        case "paddle": return "Paddle"
        case "manual": return L("k.provider.manual")
        case "trial": return L("usage.status.trial")
        default: return other(value)
        }
    }
    /// Short single-line label for compact places (project tabs, health tiles, mini stats); full name stays in `step`.
    static func stepShort(_ value: String) -> String {
        switch value {
        case "git": return L("k.stepShort.git")
        case "secrets": return L("k.stepShort.secrets")
        case "lint": return L("k.stepShort.lint")
        case "typecheck": return L("k.stepShort.typecheck")
        case "site": return L("k.stepShort.site")
        default: return step(value)
        }
    }
    static func step(_ value: String) -> String {
        switch value {
        case "git": return L("k.step.git")
        case "secrets": return L("k.step.secrets")
        case "deps": return L("common.dependencies")
        case "lint": return L("k.step.lint")
        case "typecheck": return L("k.step.typecheck")
        case "build": return L("k.step.build")
        case "site": return L("launch.site.title")
        case "hosting": return L("k.step.hosting")
        case "assistant:ask": return L("assistant.nav")
        case "assistant:diagnose": return L("assistant.field.findings")
        case "assistant:propose", "assistant:fix": return L("issue.fix.ai")
        case "node": return "Node.js"
        case "npm": return "npm"
        case "pnpm": return "pnpm"
        case "netlify": return "Netlify"
        case "vercel": return "Vercel"
        case "cloudflare": return "Cloudflare Pages"
        case "gh": return "GitHub"
        case "cloud": return L("k.provider.cloud")
        default: return other(value)
        }
    }
    static func auditAction(_ value: String) -> String {
        switch value {
        case "set_role": return L("k.audit.set_role")
        case "set_plan": return L("k.audit.set_plan")
        case "grant": return L("k.audit.grant")
        case "set_ai_disabled": return L("k.audit.set_ai_disabled")
        case "pause_site": return L("k.audit.pause_site")
        case "set_settings": return L("k.audit.set_settings")
        case "invite": return L("k.audit.invite")
        case "delete_account": return L("k.audit.delete_account")
        default: return other(value)
        }
    }
}
