import SwiftUI

/// Pairs of panels stack at compact widths; measurements use the actual available content width.
struct AdaptiveColumns: Layout {
    var breakpoint: CGFloat = 760
    var spacing: CGFloat = Space.l
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? breakpoint
        let horizontal = width >= breakpoint
        let column = horizontal ? max(0, (width - spacing * CGFloat(max(0, subviews.count - 1))) / CGFloat(max(1, subviews.count))) : width
        let heights = subviews.map { $0.sizeThatFits(.init(width: column, height: nil)).height }
        return CGSize(width: width, height: horizontal ? heights.max() ?? 0 : heights.reduce(0, +) + spacing * CGFloat(max(0, subviews.count - 1)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let horizontal = bounds.width >= breakpoint
        let column = horizontal ? max(0, (bounds.width - spacing * CGFloat(max(0, subviews.count - 1))) / CGFloat(max(1, subviews.count))) : bounds.width
        var point = bounds.origin
        for view in subviews {
            let size = view.sizeThatFits(.init(width: column, height: nil))
            view.place(at: point, proposal: .init(width: column, height: size.height))
            if horizontal { point.x += column + spacing } else { point.y += size.height + spacing }
        }
    }
}
