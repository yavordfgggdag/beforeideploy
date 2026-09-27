import SwiftUI

/// Drop-in replacement for `@State`.
/// Newer SDKs implement `@State` as a macro whose plugin ships only with full Xcode;
/// this wrapper is built on `@StateObject`, so the app compiles with Command Line Tools alone.
final class LocalBox<Value>: ObservableObject {
    @Published var value: Value
    init(_ value: Value) { self.value = value }
}

@propertyWrapper
struct Local<Value>: DynamicProperty {
    @StateObject private var box: LocalBox<Value>

    init(wrappedValue: Value) {
        _box = StateObject(wrappedValue: LocalBox(wrappedValue))
    }

    var wrappedValue: Value {
        get { box.value }
        nonmutating set { box.value = newValue }
    }

    var projectedValue: Binding<Value> {
        Binding(get: { box.value }, set: { box.value = $0 })
    }
}
