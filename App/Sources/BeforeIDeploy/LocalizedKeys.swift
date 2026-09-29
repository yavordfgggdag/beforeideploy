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
}
