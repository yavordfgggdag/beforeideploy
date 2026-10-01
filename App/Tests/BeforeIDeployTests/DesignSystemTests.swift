import AppKit
import XCTest
@testable import BeforeIDeploy

final class DesignSystemTests: XCTestCase {
    @MainActor
    func testErrorsSurviveCopyAndSuccessNotifications() {
        _ = NSApplication.shared
        let center = ToastCenter()
        let error = Toast(text: "Failure", isError: true)
        center.enqueue(error)
        center.enqueue(Toast(text: "Copied"))
        center.enqueue(Toast(text: "Saved"))
        center.enqueue(Toast(text: "Refreshed"))
        XCTAssertEqual(center.current?.id, error.id)
        XCTAssertEqual(center.queue.count, 3)
        center.dismiss()
        XCTAssertFalse(center.current?.isError ?? true)
        center.enqueue(center.current!)
        XCTAssertEqual(center.queue.count, 2)
    }

    func testSolidStatusColoursMeetWhiteTextContrast() {
        // Correspond to the fill tokens; test resolved colours rather than duplicating hex literals.
        for tone in [Tone.accent, .success, .warning, .danger, .info, .neutral] {
            let rgb = NSColor(tone.fill).usingColorSpace(.sRGB)!
            func linear(_ x: CGFloat) -> Double { let v = Double(x); return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
            let luminance = 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent) + 0.0722 * linear(rgb.blueComponent)
            XCTAssertGreaterThanOrEqual(1.05 / (luminance + 0.05), 4.5, "\(tone) white text contrast")
        }
    }

    func testAdaptiveSurfacesAndTextResolveInBothAppearances() {
        for name in [NSAppearance.Name.aqua, .darkAqua] {
            NSAppearance(named: name)!.performAsCurrentDrawingAppearance {
                let foreground = NSColor(Theme.text).usingColorSpace(.sRGB)!
                let background = NSColor(Theme.panel).usingColorSpace(.sRGB)!
                XCTAssertGreaterThan(abs(foreground.redComponent - background.redComponent), 0.7)
            }
        }
    }
}
