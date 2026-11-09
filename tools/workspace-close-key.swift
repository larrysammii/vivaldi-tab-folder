// Optional native Command-W QA. Requires already-granted event/AX access.
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.vivaldi.Vivaldi",
      CGPreflightPostEventAccess(), AXIsProcessTrusted() else {
    fputs("Existing event-post/AX access and owned QA browser required; no key sent.\n", stderr); exit(1)
}
let expectedProfile = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL.path
let check = Process(), output = Pipe()
check.executableURL = URL(fileURLWithPath: "/bin/ps")
check.arguments = ["-p", String(pid), "-o", "args="]
check.standardOutput = output
try check.run()
let args = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
check.waitUntilExit()
guard expectedProfile.hasSuffix("/.local/workspace-qa-profile"), check.terminationStatus == 0,
      args.split(separator: " ").contains(Substring("--user-data-dir=" + expectedProfile)) else {
    fputs("QA profile/PID identity mismatch; no key sent.\n", stderr); exit(1)
}
let accessibleApp = AXUIElementCreateApplication(pid)
var values: CFTypeRef?
AXUIElementCopyAttributeValue(accessibleApp, kAXWindowsAttribute as CFString, &values)
let windows = (values as? [AXUIElement] ?? []).filter { window in
    var title: CFTypeRef?
    AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title)
    return (title as? String)?.contains("Folder lifecycle QA") == true
}
guard windows.count == 1 else {
    fputs("One owned lifecycle fixture window required; no key sent.\n", stderr); exit(1)
}
app.activate(options: [])
AXUIElementPerformAction(windows[0], kAXRaiseAction as CFString)
AXUIElementSetAttributeValue(windows[0], kAXMainAttribute as CFString, kCFBooleanTrue)
for _ in 0..<30 {
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { break }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
}
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
    fputs("QA browser not frontmost; no key sent.\n", stderr); exit(1)
}
let source = CGEventSource(stateID: .hidSystemState)
func post(_ key: CGKeyCode, _ down: Bool, _ flags: CGEventFlags) {
    let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)!
    event.flags = flags
    event.postToPid(pid)
}
defer { post(55, false, []) }
post(55, true, .maskCommand); usleep(40_000)
post(13, true, .maskCommand); usleep(40_000)
post(13, false, .maskCommand); usleep(40_000)
post(55, false, [])
