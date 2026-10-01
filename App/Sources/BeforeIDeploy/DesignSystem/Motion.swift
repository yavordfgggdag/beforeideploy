import AppKit
import SwiftUI

// The "aurora" visual layer (V11 RC.2): living backgrounds, glowing surfaces, staggered entrances, counting
// numbers, pulsing live dots, shimmering skeletons and a celebration burst. Every animation is gated by
// System Settings → Accessibility → Reduce motion (`Motion.reduced`): with it on, the same views render
// statically. Nothing here changes what the app says — only how it moves.

// MARK: - Aurora background

/// Slow-drifting light pools behind every screen. The tint follows the selected project's state.
struct AuroraBackground: View {
    var tint: Color = Theme.accent

    var body: some View { AuroraFrame(tint: tint, t: 0) }
}

private struct AuroraFrame: View {
    let tint: Color
    let t: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                Theme.bg
                blob(color: tint, size: max(w, h) * 0.9, x: w * (0.82 + 0.06 * sin(t * 0.21)), y: h * (0.10 + 0.08 * cos(t * 0.17)), opacity: 0.06)
                blob(color: Color(hex: 0x7A3FD6), size: max(w, h) * 0.8, x: w * (0.12 + 0.07 * cos(t * 0.13)), y: h * (0.92 + 0.05 * sin(t * 0.19)), opacity: 0.04)
                blob(color: Color(hex: 0x1FA36A), size: max(w, h) * 0.55, x: w * (0.55 + 0.10 * sin(t * 0.11)), y: h * (0.55 + 0.10 * cos(t * 0.09)), opacity: 0.025)
                // fine grain so the gradients never band
                Rectangle().fill(Color.white.opacity(0.012)).blendMode(.plusLighter)
            }
        }
        .allowsHitTesting(false)
        .animation(Motion.gentle, value: tint)
    }

    private func blob(color: Color, size: CGFloat, x: CGFloat, y: CGFloat, opacity: Double) -> some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(opacity), color.opacity(opacity * 0.35), .clear], center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
            .position(x: x, y: y)
            .blur(radius: size * 0.08)
    }
}

// MARK: - Glow border

/// A soft, slowly rotating conic highlight along a rounded border — the "premium" edge of hero surfaces.
struct GlowBorder: ViewModifier {
    var tint: Color
    var radius: CGFloat = Theme.radius
    var strength: Double = 1

    func body(content: Content) -> some View {
        content.overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
            .strokeBorder(tint.opacity(0.25 * strength), lineWidth: 1).allowsHitTesting(false))
    }
}

// MARK: - Lift on hover

/// Cards and tiles rise toward the pointer: scale, shadow and a brighter edge; press pushes them back.
struct Lift: ViewModifier {
    var radius: CGFloat = Theme.radius
    var tint: Color = Theme.accent
    var amount: CGFloat = 1.012
    @Local private var hover = false

    func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(tint.opacity(hover ? 0.45 : 0), lineWidth: 1)
                    .allowsHitTesting(false)
            )

            .scaleEffect(hover && !Motion.reduced ? amount : 1)
            .onHover { hover = $0 }
            .animation(Motion.spring, value: hover)
    }
}

// MARK: - Staggered entrance

/// Fades and slides a view in after `index × 45 ms`; lists and grids ripple into place.
struct Entrance: ViewModifier {
    let index: Int
    var offset: CGFloat = 14
    @Local private var shown = false

    // Screen changes are immediate; transitions are reserved for user actions.
    func body(content: Content) -> some View { content }
}

// MARK: - Counting numbers

/// A number that counts from its previous value to the new one.
struct CountingText: View, Animatable {
    var value: Double
    var format: (Int) -> String = { Fmt.tokens($0) }
    var font: Font = .system(size: 28, weight: .bold, design: .rounded)
    var color: Color = Theme.text

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text(format(Int(value.rounded())))
            .font(font)
            .foregroundColor(color)
            .monospacedDigit()
    }
}

/// Wraps CountingText so the animation runs whenever the target changes.
struct CountUp: View {
    let target: Int
    var format: (Int) -> String = { Fmt.tokens($0) }
    var font: Font = .system(size: 28, weight: .bold, design: .rounded)
    var color: Color = Theme.text
    @Local private var shown: Double = 0

    var body: some View {
        CountingText(value: shown, format: format, font: font, color: color)
            .onAppear { withAnimation(Motion.reduced ? nil : .easeOut(duration: 0.9)) { shown = Double(target) } }
            .onChange(of: target) { v in withAnimation(Motion.reduced ? nil : .easeOut(duration: 0.7)) { shown = Double(v) } }
    }
}

// MARK: - Pulse

/// A live indicator: a dot with expanding rings — for monitoring, running checks, open incidents.
struct PulseDot: View {
    var color: Color = Theme.ready
    var size: CGFloat = 8
    var active = true
    @Local private var on = false

    var body: some View {
        ZStack {
            if active && !Motion.reduced {
                Circle().stroke(color.opacity(0.55), lineWidth: 1.5)
                    .frame(width: size, height: size)
                    .scaleEffect(on ? 2.6 : 1)
                    .opacity(on ? 0 : 0.9)
                Circle().stroke(color.opacity(0.35), lineWidth: 1)
                    .frame(width: size, height: size)
                    .scaleEffect(on ? 3.6 : 1)
                    .opacity(on ? 0 : 0.6)
            }
            Circle().fill(color).frame(width: size, height: size)
                .shadow(color: color.opacity(0.8), radius: active ? 6 : 2)
        }
        .frame(width: size * 4, height: size * 4)
        .onAppear {
            guard active, !Motion.reduced else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { on = true }
        }
        .accessibilityHidden(true)
    }
}

/// A gentle breathing glow behind a status symbol (ready = calm green breath, blocked = red heartbeat).
struct Breath: ViewModifier {
    var color: Color
    var strong = false
    @Local private var up = false

    func body(content: Content) -> some View { content }
}

// MARK: - Shimmer

/// A moving highlight over placeholders and progress bars.
struct Shimmer: ViewModifier {
    var active = true
    @Local private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { geo in
                if active && !Motion.reduced {
                    LinearGradient(colors: [.clear, Color.white.opacity(0.10), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width)
                        .blendMode(.plusLighter)
                        .onAppear {
                            withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1.4 }
                        }
                }
            }
            .allowsHitTesting(false)
            .clipped()
        )
    }
}

// MARK: - Orbit spinner

/// Three dots orbiting — the assistant thinking, a check running.
struct Orbit: View {
    var size: CGFloat = 18
    var color: Color = Theme.accent
    @Local private var spin = false

    var body: some View { Spinner(size: size, color: color) }
}

/// "typing" dots for the assistant while the answer streams.
struct TypingDots: View {
    var color: Color = Theme.secondary
    @Local private var up = false
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(color).frame(width: 5, height: 5)
                    .offset(y: up && !Motion.reduced ? -3 : 0)
                    .animation(Motion.reduced ? nil : .easeInOut(duration: 0.45).repeatForever(autoreverses: true).delay(Double(i) * 0.15), value: up)
            }
        }
        .onAppear { up = true }
        .accessibilityHidden(true)
    }
}

// MARK: - Gradient text

/// Headline text painted with the accent gradient (titles, big numbers that deserve it).
struct GradientText: View {
    let text: String
    var font: Font = .system(size: 26, weight: .bold)
    var colors: [Color] = [Theme.text, Theme.text]
    var body: some View {
        Text(text)
            .font(font)
            .foregroundColor(.clear)
            .overlay(
                LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                    .mask(Text(text).font(font))
            )
    }
}

// MARK: - Celebration

/// A short burst of coloured particles — a release published, a project ready, a verified fix.
struct Celebration: View {
    var colors: [Color] = [Theme.ready, Theme.accent, Color(hex: 0xB57BFF), Color(hex: 0xFFD35A), Color(hex: 0xFF7EB6)]
    var duration: Double = 1.8
    @Local private var start = Date()

    private struct Particle {
        let angle: Double
        let speed: Double
        let size: Double
        let spin: Double
        let color: Int
    }

    private var particles: [Particle] {
        var g = SystemRandomNumberGenerator()
        return (0..<90).map { i in
            Particle(angle: Double.random(in: 0..<(2 * .pi), using: &g), speed: Double.random(in: 120...420, using: &g), size: Double.random(in: 3...7, using: &g), spin: Double.random(in: -6...6, using: &g), color: i % colors.count)
        }
    }

    var body: some View {
        if Motion.reduced {
            EmptyView()
        } else {
            let parts = particles
            TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { ctx in
                Canvas { context, size in
                    let t = ctx.date.timeIntervalSince(start)
                    guard t < duration else { return }
                    let fade = max(0, 1 - t / duration)
                    let origin = CGPoint(x: size.width / 2, y: size.height * 0.42)
                    for p in parts {
                        let d = p.speed * t * (1 - 0.35 * t / duration)
                        let x = origin.x + cos(p.angle) * d
                        let y = origin.y + sin(p.angle) * d + 160 * t * t
                        var rect = CGRect(x: x, y: y, width: p.size, height: p.size * 1.6)
                        rect = rect.offsetBy(dx: -p.size / 2, dy: -p.size / 2)
                        var ctxCopy = context
                        ctxCopy.translateBy(x: rect.midX, y: rect.midY)
                        ctxCopy.rotate(by: .radians(p.spin * t))
                        ctxCopy.translateBy(x: -rect.midX, y: -rect.midY)
                        ctxCopy.opacity = fade
                        ctxCopy.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(colors[p.color]))
                    }
                }
            }
            .allowsHitTesting(false)
            .onAppear { start = Date() }
        }
    }
}

// MARK: - Progress with a sweep

/// A progress bar whose fill carries a moving light — for checks, releases, budgets.
struct SweepBar: View {
    let fraction: Double
    var tint: Color = Theme.accent
    var height: CGFloat = 6

    var body: some View { Meter(value: fraction, size: height, tint: tint) }
}

// MARK: - View helpers

// MARK: - Welcome sky

/// The onboarding backdrop: the brand gradient with slowly drifting light and a soft sweep — alive, never busy.
struct WelcomeSky: View {
    var body: some View {
        if Motion.reduced {
            WelcomeSkyFrame(t: 0)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { ctx in
                WelcomeSkyFrame(t: ctx.date.timeIntervalSinceReferenceDate)
            }
        }
    }
}

private struct WelcomeSkyFrame: View {
    let t: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                LinearGradient(colors: [Color(hex: 0x0B3D91), Color(hex: 0x0A6EF0), Color(hex: 0x3B9CFF)],
                               startPoint: .bottomLeading, endPoint: .topTrailing)
                glow(size: max(w, h) * 0.9, x: w * (0.85 + 0.05 * sin(t * 0.19)), y: h * (0.05 + 0.06 * cos(t * 0.23)), opacity: 0.22)
                glow(size: max(w, h) * 0.7, x: w * (0.05 + 0.06 * cos(t * 0.15)), y: h * (0.95 + 0.04 * sin(t * 0.21)), opacity: 0.16)
                glow(size: max(w, h) * 0.45, x: w * (0.5 + 0.12 * sin(t * 0.11)), y: h * (0.5 + 0.10 * cos(t * 0.13)), opacity: 0.10, color: Color(hex: 0x9BE7FF))
                // a light sweep every ~12 s, like sun on water
                let sweep = (t * 0.085).truncatingRemainder(dividingBy: 1)
                LinearGradient(colors: [.clear, Color.white.opacity(0.10), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(width: w * 1.6, height: h * 0.5)
                    .rotationEffect(.degrees(-28))
                    .offset(y: -h * 0.9 + h * 1.8 * sweep)
                    .blendMode(.plusLighter)
            }
        }
        .allowsHitTesting(false)
    }

    private func glow(size: CGFloat, x: CGFloat, y: CGFloat, opacity: Double, color: Color = .white) -> some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(opacity), color.opacity(opacity * 0.3), .clear], center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
            .position(x: x, y: y)
    }
}

// MARK: - Floating

/// A slow vertical bob — logos and hero glyphs hover instead of sitting still.
struct Floating: ViewModifier {
    var amplitude: CGFloat = 4
    var period: Double = 3.2
    @Local private var up = false

    func body(content: Content) -> some View {
        content
            .offset(y: up && !Motion.reduced ? -amplitude : amplitude)
            .onAppear {
                guard !Motion.reduced else { return }
                withAnimation(.easeInOut(duration: period).repeatForever(autoreverses: true)) { up = true }
            }
    }
}

// MARK: - Progress ring

/// A ring that draws itself from empty to `fraction` on appear and re-draws on every change.
struct ProgressRing: View {
    var fraction: Double
    var lineWidth: CGFloat = 7
    var tint: LinearGradient = Theme.accentGradient
    @Local private var shown: Double = 0

    var body: some View {
        GeometryReader { geo in
            Meter(value: fraction, style: .ring, size: min(geo.size.width, geo.size.height))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

extension View {
    func glowBorder(_ tint: Color, radius: CGFloat = Theme.radius, strength: Double = 1) -> some View {
        modifier(GlowBorder(tint: tint, radius: radius, strength: strength))
    }
    func lift(radius: CGFloat = Theme.radius, tint: Color = Theme.accent, amount: CGFloat = 1.012) -> some View {
        modifier(Lift(radius: radius, tint: tint, amount: amount))
    }
    func entrance(_ index: Int, offset: CGFloat = 14) -> some View {
        modifier(Entrance(index: index, offset: offset))
    }
    func breath(_ color: Color, strong: Bool = false) -> some View {
        modifier(Breath(color: color, strong: strong))
    }
    func shimmer(active: Bool = true) -> some View {
        modifier(Shimmer(active: active))
    }
    /// Optional bounded movement for onboarding illustrations.
    func floating(amplitude: CGFloat = 4, period: Double = 3.2) -> some View {
        modifier(Floating(amplitude: amplitude, period: period))
    }
    func screenTransition() -> some View {
        transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 12)).combined(with: .scale(scale: 0.995)), removal: .opacity))
    }
}
