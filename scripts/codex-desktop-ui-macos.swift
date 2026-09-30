import AppKit
import ApplicationServices
import Foundation

let codexBundleIdentifier = "com.openai.codex"
let maximumTreeNodes = 20_000

struct Arguments {
    var mode = "probe"
    var preferredWindowId = ""
    var expectedText = ""
    var targetTaskTitle = ""
    var targetTaskRuntimeId = ""
}

struct FrameInfo {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
}

struct TaskIdentity {
    let title: String
    let runtimeId: String
    let element: AXUIElement
}

struct CodexCandidate {
    let app: NSRunningApplication
    let window: AXUIElement
    let windowId: String
    let composer: AXUIElement
    let composerRuntimeId: String
    let task: TaskIdentity?
    let taskTitleMatchCount: Int
    let draftText: String
}

func parseArguments() -> Arguments {
    var result = Arguments()
    var index = 1
    while index < CommandLine.arguments.count {
        let key = CommandLine.arguments[index]
        let value = index + 1 < CommandLine.arguments.count ? CommandLine.arguments[index + 1] : ""
        switch key {
        case "--mode": result.mode = value
        case "--preferred-window-id": result.preferredWindowId = value
        case "--expected-text-base64":
            result.expectedText = Data(base64Encoded: value).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        case "--target-task-title-base64":
            result.targetTaskTitle = Data(base64Encoded: value).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        case "--target-task-runtime-id": result.targetTaskRuntimeId = value
        default:
            index -= 1
        }
        index += 2
    }
    return result
}

func emit(_ ok: Bool, _ code: String, _ extra: [String: Any] = [:], exitCode: Int32? = nil) -> Never {
    var payload = extra
    payload["ok"] = ok
    payload["code"] = code
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
    exit(exitCode ?? (ok ? 0 : 2))
}

func copyAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String {
    guard let value = copyAttribute(element, name) else { return "" }
    if let text = value as? String { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
    if let texts = value as? [String] { return texts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines) }
    if let attributed = value as? NSAttributedString {
        return attributed.string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return ""
}

func boolAttribute(_ element: AXUIElement, _ name: String) -> Bool {
    guard let value = copyAttribute(element, name) else { return false }
    if let flag = value as? Bool { return flag }
    if let number = value as? NSNumber { return number.boolValue }
    return false
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = copyAttribute(element, name),
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

func axValueAttribute(_ element: AXUIElement, _ name: String) -> AXValue? {
    guard let value = copyAttribute(element, name),
          CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXValue.self)
}

func frameOf(_ element: AXUIElement) -> FrameInfo? {
    guard let positionValue = axValueAttribute(element, kAXPositionAttribute),
          let sizeValue = axValueAttribute(element, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue, .cgPoint, &point),
          AXValueGetValue(sizeValue, .cgSize, &size) else { return nil }
    return FrameInfo(x: point.x, y: point.y, width: size.width, height: size.height)
}

func runtimeId(_ element: AXUIElement, prefix: String = "ax") -> String {
    let identifier = stringAttribute(element, "AXIdentifier")
    if !identifier.isEmpty { return "\(prefix):id:\(identifier)" }
    let domIdentifier = stringAttribute(element, "AXDOMIdentifier")
    if !domIdentifier.isEmpty { return "\(prefix):dom:\(domIdentifier)" }
    return "\(prefix):hash:\(CFHash(element))"
}

func sameElement(_ left: AXUIElement, _ right: AXUIElement) -> Bool {
    CFEqual(left, right)
}

func descendants(of root: AXUIElement, includeRoot: Bool = true) -> [AXUIElement] {
    var queue = [root]
    var result: [AXUIElement] = []
    var seen = Set<CFHashCode>()
    var index = 0
    while index < queue.count && result.count < maximumTreeNodes {
        let element = queue[index]
        index += 1
        let hash = CFHash(element)
        if seen.contains(hash) { continue }
        seen.insert(hash)
        if includeRoot || !sameElement(element, root) { result.append(element) }
        if let children = copyAttribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children)
        }
    }
    return result
}

func isDescendant(_ element: AXUIElement, of ancestor: AXUIElement) -> Bool {
    var current: AXUIElement? = element
    for _ in 0..<32 {
        guard let node = current else { return false }
        if sameElement(node, ancestor) { return true }
        current = elementAttribute(node, kAXParentAttribute)
    }
    return false
}

func normalized(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func elementName(_ element: AXUIElement) -> String {
    for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, "AXTitleUIElement", kAXHelpAttribute] {
        let value = stringAttribute(element, attribute)
        if !value.isEmpty { return value }
    }
    return ""
}

func classText(_ element: AXUIElement) -> String {
    [stringAttribute(element, "AXDOMClassList"), stringAttribute(element, "AXClassName")]
        .filter { !$0.isEmpty }
        .joined(separator: " ")
        .lowercased()
}

func hasClassToken(_ classes: String, _ token: String) -> Bool {
    let expected = token.lowercased()
    return classes.split(whereSeparator: { $0.isWhitespace })
        .contains { String($0).lowercased() == expected }
}

func isPlaceholder(_ value: String) -> Bool {
    let text = normalized(value).lowercased()
    if text.isEmpty { return true }
    if text == "消息" { return true }
    let prefixes = [
        "describe your task", "message codex", "ask codex", "what do you want",
        "work with chatgpt", "work with codex", "send a message",
        "描述你的任务", "与 chatgpt 协作", "与 codex 协作", "随心输入"
    ]
    return prefixes.contains { text.hasPrefix($0) }
}

func composerText(_ composer: AXUIElement) -> String {
    let value = stringAttribute(composer, kAXValueAttribute)
    if !value.isEmpty && !isPlaceholder(value) { return value }

    var parts: [String] = []
    for element in descendants(of: composer, includeRoot: false) {
        let role = stringAttribute(element, kAXRoleAttribute)
        guard role == kAXStaticTextRole || role == kAXTextAreaRole || role == kAXTextFieldRole else { continue }
        let text = stringAttribute(element, kAXValueAttribute).isEmpty
            ? elementName(element)
            : stringAttribute(element, kAXValueAttribute)
        if !text.isEmpty && !isPlaceholder(text) && !parts.contains(text) { parts.append(text) }
    }
    return parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

func findComposer(in nodes: [AXUIElement], windowFrame: FrameInfo?) -> AXUIElement? {
    var scored: [(Int, AXUIElement)] = []
    for element in nodes {
        let role = stringAttribute(element, kAXRoleAttribute)
        let classes = classText(element)
        let placeholder = stringAttribute(element, "AXPlaceholderValue")
        let title = elementName(element).lowercased()
        let name = "\(title) \(placeholder)".lowercased()
        let frame = frameOf(element)
        let roleMatches = role == kAXTextAreaRole || role == kAXTextFieldRole || role == "AXGroup"
        let classMatches = classes.contains("prosemirror")
        let promptMatches = name.contains("message codex") || name.contains("ask codex") ||
            name.contains("describe your task") || name.contains("描述你的任务") ||
            name.contains("与 codex 协作") ||
            (role == kAXTextAreaRole && (title == "消息" || placeholder == "消息"))
        if !classMatches && !(roleMatches && promptMatches) { continue }
        if boolAttribute(element, kAXHiddenAttribute) || !boolAttribute(element, kAXEnabledAttribute) && roleMatches { continue }
        if let frame, (frame.width < 20 || frame.height < 20) { continue }

        var score = classMatches ? 120 : 0
        if role == kAXTextAreaRole { score += 35 }
        if role == kAXTextFieldRole { score += 15 }
        if promptMatches { score += 30 }
        if let frame, let windowFrame {
            if frame.width > 240 { score += 10 }
            if frame.y > windowFrame.y + windowFrame.height * 0.45 { score += 10 }
        }
        scored.append((score, element))
    }
    return scored.sorted { $0.0 > $1.0 }.first?.1
}

func isGenericDocumentTitle(_ title: String) -> Bool {
    let value = normalized(title).lowercased()
    if value.isEmpty { return true }
    return ["codex", "chatgpt", "new tab", "新标签页", "主页", "home"].contains(value)
}

/// Returns titles exposed by the active document area rather than by hidden
/// sidebar rows or browser tabs. The current desktop app exposes the active
/// conversation/project as a focused AXWebArea (with a large fallback area
/// when focus is in the composer). Keeping this separate from findTask makes
/// the title match an explicit, reviewable signal instead of guessing from a
/// CSS class that is present on every sidebar row.
func activeDocumentTitles(in nodes: [AXUIElement], windowFrame: FrameInfo?) -> Set<String> {
    var areas: [(String, AXUIElement, CGFloat)] = []
    for element in nodes where stringAttribute(element, kAXRoleAttribute) == "AXWebArea" {
        let title = normalized(elementName(element))
        guard !isGenericDocumentTitle(title) else { continue }
        let area: CGFloat
        if let frame = frameOf(element) {
            area = max(0, frame.width) * max(0, frame.height)
            if let windowFrame,
               (frame.width < max(180, windowFrame.width * 0.20) ||
                frame.height < max(120, windowFrame.height * 0.20)) {
                continue
            }
        } else {
            area = 0
        }
        areas.append((title, element, area))
    }
    guard !areas.isEmpty else { return [] }

    // Focus is the strongest signal. A composer can take focus, so retain the
    // largest visible area as a fallback when no AXWebArea is focused.
    let focused = areas.filter { boolAttribute($0.1, kAXFocusedAttribute) }
    if !focused.isEmpty { return Set(focused.map { $0.0 }) }

    let largestArea = areas.map { $0.2 }.max() ?? 0
    guard largestArea > 0 else { return Set(areas.map { $0.0 }) }
    return Set(areas.filter { $0.2 >= largestArea * 0.60 }.map { $0.0 })
}

func findTask(in nodes: [AXUIElement], windowFrame: FrameInfo?, windowTitle: String = "") -> TaskIdentity? {
    let documentTitles = activeDocumentTitles(in: nodes, windowFrame: windowFrame)
    let normalizedWindowTitle = normalized(windowTitle)
    var matches: [(Int, TaskIdentity)] = []
    for element in nodes {
        let role = stringAttribute(element, kAXRoleAttribute)
        guard role == kAXButtonRole || role == "AXRow" || role == "AXLink" else { continue }
        let title = normalized(elementName(element))
        if title.isEmpty { continue }
        let classes = classText(element)
        if classes.contains("folder-row") { continue }
        let selected = boolAttribute(element, kAXSelectedAttribute)
        // The `data-[app-action-sidebar-thread-selected=true]` Tailwind
        // variant is currently included in every sidebar row's class list;
        // it becomes a reliable signal only when AX also reports selected.
        let selectedMarker = classes.contains("data-[app-action-sidebar-thread-selected=true]")
        // Match the complete utility token. `contains` would also match the
        // variant token (`data-[...]:bg-primary-ghost-hover`) that is present
        // on every row in the current ChatGPT shell.
        let threadRowShape = hasClassToken(classes, "group") || selectedMarker
        let activeClass = hasClassToken(classes, "bg-token-list-hover-background") ||
            (hasClassToken(classes, "bg-primary-ghost-hover") && threadRowShape) ||
            (selectedMarker && selected)
        let sidebarClass = classes.contains("sidebar-item")
        let documentTitleMatch = documentTitles.contains(title)
        let windowTitleMatch = !normalizedWindowTitle.isEmpty && title == normalizedWindowTitle
        let frame = frameOf(element)
        let visibleSidebarRow: Bool
        if let frame {
            visibleSidebarRow = frame.width >= 120 && frame.height >= 18 && frame.height <= 60
        } else {
            visibleSidebarRow = false
        }
        let leftSidebarGeometry: Bool
        if let frame, let windowFrame {
            leftSidebarGeometry = frame.x < windowFrame.x + windowFrame.width * 0.45 &&
                frame.width >= 150 && frame.height >= 18 && frame.height <= 54
        } else {
            leftSidebarGeometry = false
        }
        guard activeClass || (documentTitleMatch && visibleSidebarRow) ||
            (windowTitleMatch && visibleSidebarRow) ||
            (selected && (sidebarClass || leftSidebarGeometry)) else { continue }
        var score = activeClass ? 100 : 0
        if sidebarClass { score += 50 }
        if selected { score += 30 }
        if leftSidebarGeometry { score += 10 }
        if documentTitleMatch { score += 240 }
        if windowTitleMatch { score += 220 }
        matches.append((score, TaskIdentity(
            title: title,
            runtimeId: runtimeId(element, prefix: "task"),
            element: element
        )))
    }
    guard let bestScore = matches.map({ $0.0 }).max() else { return nil }
    let bestMatches = matches.filter { $0.0 == bestScore }
    // Do not guess if two nodes claim to be the active task. This protects
    // delivery when a new UI exposes duplicate accessibility representations.
    guard bestMatches.count == 1 else { return nil }
    return bestMatches[0].1
}

func taskTitleMatchCount(in nodes: [AXUIElement], title: String) -> Int {
    guard !title.isEmpty else { return 0 }
    var ids = Set<String>()
    for element in nodes {
        let classes = classText(element)
        guard classes.contains("sidebar-item"), !classes.contains("folder-row") else { continue }
        if normalized(elementName(element)) == title { ids.insert(runtimeId(element, prefix: "task")) }
    }
    return ids.count
}

func analyzeWindow(_ window: AXUIElement, app: NSRunningApplication, targetTitle: String) -> CodexCandidate? {
    if boolAttribute(window, kAXMinimizedAttribute) { return nil }
    let nodes = descendants(of: window)
    guard let composer = findComposer(in: nodes, windowFrame: frameOf(window)) else { return nil }
    let webAreas = nodes.filter { stringAttribute($0, kAXRoleAttribute) == "AXWebArea" }
    let hasCodexDocument = webAreas.contains {
        let name = "\(elementName($0)) \(stringAttribute($0, kAXValueAttribute))".lowercased()
        return name == "codex" || name.contains("codex")
    }
    // Recent Codex builds expose the conversation as a localized AXWebArea
    // (for example “你的 dot”) rather than a document named “Codex”. The
    // composer is still a strong identity signal, including when it is a
    // plain AXTextArea named “消息” without the old prosemirror class.
    let composerPlaceholder = stringAttribute(composer, "AXPlaceholderValue")
    let composerLooksLikeCodex = classText(composer).contains("prosemirror") ||
        (stringAttribute(composer, kAXRoleAttribute) == kAXTextAreaRole &&
            (elementName(composer) == "消息" || composerPlaceholder == "消息"))
    if !hasCodexDocument && !composerLooksLikeCodex { return nil }

    let task = findTask(
        in: nodes,
        windowFrame: frameOf(window),
        windowTitle: elementName(window)
    )
    let titleForCount = targetTitle.isEmpty ? (task?.title ?? "") : targetTitle
    return CodexCandidate(
        app: app,
        window: window,
        windowId: runtimeId(window, prefix: "window"),
        composer: composer,
        composerRuntimeId: runtimeId(composer, prefix: "composer"),
        task: task,
        taskTitleMatchCount: taskTitleMatchCount(in: nodes, title: titleForCount),
        draftText: composerText(composer)
    )
}

func allCandidates(app: NSRunningApplication, targetTitle: String) -> [CodexCandidate] {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    guard let windows = copyAttribute(appElement, kAXWindowsAttribute) as? [AXUIElement] else { return [] }
    return windows.compactMap { analyzeWindow($0, app: app, targetTitle: targetTitle) }
}

func selectCandidate(_ candidates: [CodexCandidate], arguments: Arguments) -> CodexCandidate? {
    if let focused = candidates.first(where: {
        boolAttribute($0.window, kAXFocusedAttribute) || boolAttribute($0.window, kAXMainAttribute)
    }) { return focused }
    if !arguments.preferredWindowId.isEmpty,
       let preferred = candidates.first(where: { $0.windowId == arguments.preferredWindowId }) {
        return preferred
    }
    return candidates.count == 1 ? candidates[0] : nil
}

func sameTask(_ candidate: CodexCandidate, as task: TaskIdentity?) -> Bool {
    guard let expected = task, let current = candidate.task else { return false }
    return current.runtimeId == expected.runtimeId || current.title == expected.title
}

func candidateForTask(_ candidates: [CodexCandidate], windowId: String, task: TaskIdentity?) -> CodexCandidate? {
    candidates.first(where: { $0.windowId == windowId }) ??
        candidates.first(where: { sameTask($0, as: task) })
}

func verifyIdentity(_ candidate: CodexCandidate, arguments: Arguments) {
    guard let task = candidate.task else {
        emit(false, "TASK_ID_NOT_FOUND", ["hwnd": candidate.windowId, "processId": candidate.app.processIdentifier])
    }
    if (!arguments.targetTaskTitle.isEmpty && task.title != arguments.targetTaskTitle) ||
       (!arguments.targetTaskRuntimeId.isEmpty && task.runtimeId != arguments.targetTaskRuntimeId) {
        emit(false, "TARGET_SESSION_MISMATCH", [
            "hwnd": candidate.windowId,
            "processId": candidate.app.processIdentifier,
            "currentTaskTitle": task.title,
            "targetTaskTitle": arguments.targetTaskTitle,
        ])
    }
}

func activate(_ app: NSRunningApplication) -> Bool {
    if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == codexBundleIdentifier { return true }
    _ = app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
    for _ in 0..<20 {
        usleep(60_000)
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == codexBundleIdentifier {
            return true
        }
    }
    return false
}

func raiseWindow(_ window: AXUIElement) {
    _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
}

func focusComposer(_ composer: AXUIElement) -> Bool {
    for _ in 0..<6 {
        _ = AXUIElementSetAttributeValue(composer, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        usleep(80_000)
        let system = AXUIElementCreateSystemWide()
        if let focused = elementAttribute(system, kAXFocusedUIElementAttribute),
           isDescendant(focused, of: composer) {
            return true
        }
    }
    return false
}

func setComposerText(_ text: String, composer: AXUIElement, pid: pid_t) -> String? {
    if AXUIElementSetAttributeValue(composer, kAXValueAttribute as CFString, text as CFString) == .success {
        return "AXValue"
    }

    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { return nil }
    var units = Array(text.utf16)
    units.withUnsafeMutableBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
        up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
    }
    down.postToPid(pid)
    up.postToPid(pid)
    return "CGEventUnicode"
}

func pressEnter(pid: pid_t) -> Bool {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: false) else { return false }
    down.postToPid(pid)
    up.postToPid(pid)
    return true
}

func matchingTextRuntimeIds(in window: AXUIElement, text: String, excluding composer: AXUIElement? = nil) -> Set<String> {
    var matches = Set<String>()
    for element in descendants(of: window) {
        if let composer, isDescendant(element, of: composer) { continue }
        let value = normalized(stringAttribute(element, kAXValueAttribute))
        let name = normalized(elementName(element))
        if value == text || name == text { matches.insert(runtimeId(element, prefix: "message")) }
    }
    return matches
}

func dumpTree(app: NSRunningApplication) -> Never {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    guard let windows = copyAttribute(appElement, kAXWindowsAttribute) as? [AXUIElement] else {
        emit(false, "CODEX_MODE_NOT_FOUND")
    }
    var output: [[String: Any]] = []
    for window in windows {
        for element in descendants(of: window) {
            let role = stringAttribute(element, kAXRoleAttribute)
            let classes = classText(element)
            let selected = boolAttribute(element, kAXSelectedAttribute)
            let focused = boolAttribute(element, kAXFocusedAttribute)
            let name = elementName(element)
            let placeholder = stringAttribute(element, "AXPlaceholderValue")
            let interesting = role == "AXWebArea" || role == kAXTextAreaRole || role == kAXTextFieldRole ||
                selected || focused || classes.contains("sidebar") || classes.contains("prosemirror") ||
                name.lowercased().contains("codex") || !placeholder.isEmpty
            if !interesting { continue }
            var item: [String: Any] = [
                "runtimeId": runtimeId(element),
                "role": role,
                "subrole": stringAttribute(element, kAXSubroleAttribute),
                "name": name,
                "value": stringAttribute(element, kAXValueAttribute),
                "placeholder": placeholder,
                "identifier": stringAttribute(element, "AXIdentifier"),
                "domIdentifier": stringAttribute(element, "AXDOMIdentifier"),
                "classes": classes,
                "selected": selected,
                "focused": focused,
            ]
            if let frame = frameOf(element) {
                item["frame"] = ["x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height]
            }
            output.append(item)
        }
    }
    emit(true, "DUMP", ["processId": app.processIdentifier, "nodes": output])
}

let arguments = parseArguments()
guard ["probe", "send", "dump"].contains(arguments.mode) else {
    emit(false, "HELPER_FAILURE", ["detail": "Unsupported mode"])
}
guard AXIsProcessTrusted() else {
    emit(false, "ACCESSIBILITY_PERMISSION_REQUIRED")
}

let apps = NSRunningApplication.runningApplications(withBundleIdentifier: codexBundleIdentifier)
    .filter { !$0.isTerminated }
guard apps.count == 1, let codexApp = apps.first else {
    emit(false, apps.isEmpty ? "APP_NOT_RUNNING" : "AMBIGUOUS_WINDOWS", ["appCount": apps.count])
}
if arguments.mode == "dump" { dumpTree(app: codexApp) }

var candidates = allCandidates(app: codexApp, targetTitle: arguments.targetTaskTitle)
guard !candidates.isEmpty else { emit(false, "CODEX_MODE_NOT_FOUND") }
guard var selected = selectCandidate(candidates, arguments: arguments) else {
    emit(false, "AMBIGUOUS_WINDOWS", ["candidateCount": candidates.count])
}

if !arguments.targetTaskTitle.isEmpty || !arguments.targetTaskRuntimeId.isEmpty {
    verifyIdentity(selected, arguments: arguments)
}

if arguments.mode == "probe" {
    guard let task = selected.task else {
        emit(false, "TASK_ID_NOT_FOUND", ["hwnd": selected.windowId, "processId": codexApp.processIdentifier])
    }
    emit(true, "READY", [
        "hwnd": selected.windowId,
        "processId": codexApp.processIdentifier,
        "hasDraft": !selected.draftText.isEmpty,
        "hasKeyboardFocus": boolAttribute(selected.composer, kAXFocusedAttribute),
        "composerName": elementName(selected.composer),
        "draftTextLength": selected.draftText.count,
        "taskTitle": task.title,
        "taskRuntimeId": task.runtimeId,
        "taskTitleMatchCount": selected.taskTitleMatchCount,
    ])
}

guard !arguments.expectedText.isEmpty else { emit(false, "SUBMIT_TEXT_NOT_FOUND") }
if !selected.draftText.isEmpty {
    emit(false, "DRAFT_PRESENT", ["hwnd": selected.windowId, "processId": codexApp.processIdentifier])
}
let initialWindowId = selected.windowId
let initialComposerRuntimeId = selected.composerRuntimeId
let beforeMessageIds = matchingTextRuntimeIds(
    in: selected.window,
    text: arguments.expectedText,
    excluding: selected.composer
)

guard activate(codexApp) else {
    emit(false, "TARGET_WINDOW_NOT_ACTIVE", ["hwnd": initialWindowId])
}
raiseWindow(selected.window)
usleep(120_000)

candidates = allCandidates(app: codexApp, targetTitle: arguments.targetTaskTitle)
guard let activated = candidates.first(where: { $0.windowId == initialWindowId }) ??
    candidates.first(where: { sameTask($0, as: selected.task) }) ??
    selectCandidate(candidates, arguments: arguments) else {
    emit(false, "TARGET_WINDOW_NOT_ACTIVE", ["hwnd": initialWindowId])
}
selected = activated
verifyIdentity(selected, arguments: arguments)
guard selected.composerRuntimeId == initialComposerRuntimeId else {
    emit(false, "COMPOSER_CHANGED", ["hwnd": selected.windowId])
}
guard selected.draftText.isEmpty else {
    emit(false, "DRAFT_PRESENT", ["hwnd": selected.windowId])
}
guard focusComposer(selected.composer) else {
    emit(false, "FOCUS_FAILED", ["hwnd": selected.windowId])
}
guard let inputMethod = setComposerText(
    arguments.expectedText,
    composer: selected.composer,
    pid: codexApp.processIdentifier
) else {
    emit(false, "SUBMIT_TEXT_NOT_FOUND", ["hwnd": selected.windowId])
}
usleep(100_000)

candidates = allCandidates(app: codexApp, targetTitle: arguments.targetTaskTitle)
guard let beforeSubmit = candidateForTask(candidates, windowId: initialWindowId, task: selected.task) else {
    emit(false, "TARGET_WINDOW_NOT_ACTIVE", ["hwnd": initialWindowId])
}
verifyIdentity(beforeSubmit, arguments: arguments)
guard beforeSubmit.composerRuntimeId == initialComposerRuntimeId else {
    emit(false, "COMPOSER_CHANGED", ["hwnd": beforeSubmit.windowId])
}
guard composerText(beforeSubmit.composer) == arguments.expectedText else {
    emit(false, "DRAFT_CHANGED", ["hwnd": beforeSubmit.windowId])
}
guard activate(codexApp),
      focusComposer(beforeSubmit.composer) else {
    emit(false, "FOCUS_FAILED", ["hwnd": beforeSubmit.windowId])
}
guard pressEnter(pid: codexApp.processIdentifier) else {
    emit(false, "SUBMIT_FAILED", ["hwnd": beforeSubmit.windowId])
}

var finalDraft = arguments.expectedText
for _ in 0..<25 {
    usleep(100_000)
    let currentCandidates = allCandidates(app: codexApp, targetTitle: arguments.targetTaskTitle)
    guard let current = candidateForTask(currentCandidates, windowId: initialWindowId, task: selected.task) else { continue }
    verifyIdentity(current, arguments: arguments)
    if current.composerRuntimeId != initialComposerRuntimeId {
        emit(false, "COMPOSER_CHANGED", ["hwnd": current.windowId])
    }
    finalDraft = current.draftText
    let afterIds = matchingTextRuntimeIds(in: current.window, text: arguments.expectedText, excluding: current.composer)
    let newIds = afterIds.subtracting(beforeMessageIds)
    if newIds.count > 1 {
        emit(false, "DELIVERY_AMBIGUOUS", ["hwnd": current.windowId, "candidateCount": newIds.count])
    }
    if finalDraft.isEmpty, let messageRuntimeId = newIds.first {
        emit(true, "DIRECT_STEERED", [
            "hwnd": current.windowId,
            "processId": codexApp.processIdentifier,
            "inputMethod": inputMethod,
            "draftVerification": "EMPTY_AFTER_SUBMIT",
            "messageRuntimeId": messageRuntimeId,
        ])
    }
}

if !finalDraft.isEmpty {
    emit(false, "SUBMIT_FAILED", ["hwnd": initialWindowId])
}
emit(false, "DELIVERY_UNCONFIRMED", ["hwnd": initialWindowId])
